import crypto from "node:crypto";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { WebSocketServer } from "ws";

import { Time } from "./custom_modules/time.js";
import { TempMap } from "./custom_modules/temp-map.js";

const CALLBACK_RATE_LIMIT_WINDOW = Time.minutes(1);
if (CALLBACK_RATE_LIMIT_WINDOW <= 0 || !Number.isFinite(CALLBACK_RATE_LIMIT_WINDOW))
    throw new Error("Callback rate limit window must be a positive finite number");

const CALLBACK_RATE_LIMIT_MAX = 3; // max /callback requests per client IP, per window
if (CALLBACK_RATE_LIMIT_MAX <= 0 || !Number.isFinite(CALLBACK_RATE_LIMIT_MAX))
    throw new Error("Callback rate limit max must be a positive finite number");

// caches
const callbackRateLimitCache = new TempMap(CALLBACK_RATE_LIMIT_WINDOW);
const OAuthCallbackCache = new TempMap(Time.minutes(5)); // cache state callbacks with a 5-minute timeout

// main
const base64url = str => str.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const isCallbackRateLimited = (function(ip) {
    let entry = callbackRateLimitCache.get(ip);
    if (!entry) {
        entry = { count: 0 };
        callbackRateLimitCache.set(ip, entry); // starts the fixed window for this IP
    }

    return ++entry.count > CALLBACK_RATE_LIMIT_MAX;
});

// site matrix
const sitematrix = { };
let siteMatrixJson = JSON.stringify(sitematrix);

const updateSiteMatrix = (function() { // gets a list of all mediawiki sites
    fetch(`https://www.mediawiki.org/w/api.php`, {
        method: "POST",
        headers: {
            "Api-User-Agent": "Acorns-Server/1.0 (https://github.com/LuniZunie/Acorns)",
        },
        body: new URLSearchParams({ action: "sitematrix", format: "json", formatversion: "2" })
    })
        .then(response => response.json())
        .then(data => {
            const temp = { };

            const matrix = data.sitematrix ?? { };
            delete matrix.count;
            for (const sites of Object.values(matrix))
                for (const site of Array.isArray(sites) ? sites : (sites.site || [ ])) {
                    if (site.private) continue;
                    temp[new URL(site.url).hostname] = site.dbname;
                }

            Object.assign(sitematrix, temp);
            siteMatrixJson = JSON.stringify(sitematrix);
        })
        .catch(error => console.error(error));
});

updateSiteMatrix();
setInterval(updateSiteMatrix, Time.minutes(30)); // update every 30 minutes

// server
const PORT = parseInt(process.env.PORT, 10) || 8000;
const CLIENT = process.env.CLIENT;
if (!CLIENT) throw new Error("CLIENT environment variable is not set");

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "src");
const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
};

const server = createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        return res.end("Method Not Allowed");
    }

    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, `http://0.0.0.0:${PORT}`).pathname); }
    catch {
        res.writeHead(400);
        return res.end("Bad Request");
    }

    switch (pathname) { // for custom handlers
        case "/sitematrix": {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(siteMatrixJson);
        } break;
        case "/callback": {
            const ip = req.socket.remoteAddress ?? "unknown";
            if (isCallbackRateLimited(ip)) {
                res.writeHead(429, { "Retry-After": Math.ceil(CALLBACK_RATE_LIMIT_WINDOW / 1000).toString() });
                return res.end("Too Many Requests");
            }

            const url = new URL(req.url, `http://0.0.0.0:${PORT}`);

            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");

            if (code && state && OAuthCallbackCache.has(state)) {
                const callback = OAuthCallbackCache.get(state);
                callback({ code });

                res.writeHead(200);
                return res.end("You may close this window now.");
            } else {
                res.writeHead(400);
                return res.end("Bad Request");
            }
        } break;
        default: {
            let relative;
            switch (pathname) { // for static file routing
                case "/":
                case "": {
                    relative = join("view", "index.html");
                } break;
                default: {
                    relative = pathname.slice(1);
                } break;
            }

            const filePath = resolve(SRC_DIR, relative);
            if (filePath !== SRC_DIR && !filePath.startsWith(SRC_DIR + sep)) {
                res.writeHead(403);
                return res.end("Forbidden");
            }

            try {
                const file = await readFile(filePath);
                res.writeHead(200, {
                    "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
                    "Content-Length": file.length
                });
                res.end(req.method === "HEAD" ? undefined : file);
            } catch (error) {
                if (error.code === "ENOENT" || error.code === "EISDIR") {
                    res.writeHead(404);
                    res.end("Not Found");
                } else {
                    console.error(error);
                    res.writeHead(500);
                    res.end("Internal Server Error");
                }
            }
        } break;
    }
});

const wss = new WebSocketServer({ server });
wss.on("connection", ws => {
    const state = crypto.randomUUID();
    ws.on("message", data => {
        const str = data.toString().trim();
        if (!str.startsWith("#")) return;

        const [ cmd ] = str.slice(1).split(/\s(.*)/s);
        switch (cmd) {
            case "ping": {
                ws.send("pong");
            } break;
            case "client": {
                ws.send(JSON.stringify({ event: "client", data: CLIENT }));
            } break;
            case "auth": {
                if (OAuthCallbackCache.has(state)) return;

                const verifier = base64url(crypto.randomBytes(32));
                const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());

                OAuthCallbackCache.set(state, ({ code }) => {
                    OAuthCallbackCache.delete(state);
                    if (!code) return ws.send(JSON.stringify({ event: "denied" }));

                    ws.send(JSON.stringify({ event: "success", data: { code, verifier } }));
                });
                OAuthCallbackCache.addTimeoutListener(state, () => { ws.send(JSON.stringify({ event: "timeout" })); });

                ws.send(JSON.stringify({ event: "ready", data: { state, challenge } }));
                ws.addEventListener("close", () => { OAuthCallbackCache.delete(state); });
            } break;
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP server running on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket server running on ws://0.0.0.0:${PORT}`);
});
