import { createServer } from "node:http";

import { WebSocketServer } from "ws";

import fetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";

import { Time } from "./custom_modules/time.js";
import { TempMap } from "./custom_modules/temp-map.js";

const RATE_LIMIT = Time.minutes(1) / 2000;
if (RATE_LIMIT < 0 || !Number.isFinite(RATE_LIMIT))
    throw new Error("Rate limit must be a non-negative finite number");

// caches
const hostnameCache = new TempMap(Time.minutes(30)); // cache hostnames with a 30-minute timeout

// makes sure we never undershoot the wait even slightly
const waitUntil = async time => {
    let wait = 0;
    do {
        if (wait > 0)
            await new Promise(resolve => { setTimeout(resolve, wait); });
        wait = time - performance.now();
    } while (wait > 0);
};

// returns a Promise resolving to the fetch response
const mwFetch = (function(token, wiki, params = { }) {
    if (typeof token !== "string")
        throw new Error("(mwFetch) Argument[0] must be a string");
    if (typeof wiki !== "string")
        throw new Error("(mwFetch) Argument[1] must be a string");
    if (typeof params !== "object" || params === null)
        throw new Error("(mwFetch) Argument[2] must be a non-null object");

    return this.sessionFetch(`https://${wiki}/w/api.php`, {
        method: "POST",
        headers: {
            "User-Agent": "Acorns/1.0 (https://github.com/LuniZunie/Acorns)",
            "Authorization": `Bearer ${token}`,
        },
        body: new URLSearchParams({
            ...params,
            format: "json",
            formatversion: "2"
        })
    });
}).bind({ sessionFetch: fetchCookie(fetch, new CookieJar()) });

const enqueueMwFetch = (function(dataList) {
    for (const data of dataList)
        this.queue.push(data);

    if (dataList.length > 0 && !this.active) {
        const id = ++this.id;
        this.active = true;

        this.idle = false;

        waitUntil(this.last + RATE_LIMIT)
            .then(() => {
                const call = async ([ wiki, params, response = () => { }, reject = () => { } ]) => {
                    this.last = performance.now();
                    this.ongoing.push(
                        mwFetch(this.token, wiki, params)
                            .then(response => response.json())
                            .then(response)
                            .catch(reject)
                    );

                    // wait for the rate limit interval to pass before processing the next request
                    await waitUntil(this.last + RATE_LIMIT);
                    if (this.queue.length > 0) {
                        let resolveNext;
                        const nextPromise = new Promise(resolve => { resolveNext = resolve; });
                        setTimeout(() => call(this.queue.shift()).finally(resolveNext), 0); // bypass call stack limit
                        return nextPromise;
                    }
                };

                call(this.queue.shift())
                    .finally(() => {
                        const ongoing = [ ...this.ongoing ];
                        this.ongoing = [ ];

                        this.idle = performance.now();
                        this.active = false;

                        Promise.all(ongoing)
                            .finally(() => {
                                setTimeout(() => {
                                    if (this.queue.length === 0 && this.id === id)
                                        this.callbacks.forEach(fn => fn());
                                }, 0);
                            })
                    });
            })
            .catch(error => console.error(error));
    }

    return { callback: fn => this.callbacks.push(fn) };
});

const getEnqueuer = (function (token) {
    for (const [ key, value ] of this.enqueuers) {
        if (key === token)
            return value.enqueuer;
        else {
            const idle = value.context.idle;
            if (idle === false)
                continue;
            else if (performance.now() - idle > Time.minutes(30))
                this.enqueuers.delete(key);
        }
    }

    const context = { token, ongoing: [ ], queue: [ ], last: -RATE_LIMIT, callbacks: [ ], id: 0n, active: false, idle: false }
    const enqueuer = enqueueMwFetch.bind(context);
    this.enqueuers.set(token, { context, enqueuer });
    return enqueuer;
}).bind({ enqueuers: new Map() });

function parseUser(token, user) {
    const enqueuer = getEnqueuer(token);

    const data = {
        gui: { },
        gus: { },
        bg: { },
        wikis: { },
        uploads: { }
    };

    const uploadsBody = {
        "action": "query",
        "list": "logevents",

        /* list>logevents */
        leuser: user,
        letype: "upload",
        lelimit: "max"
    };
    const uploadsResponseHandler = response => {
        for (const logevent of response?.query?.logevents || [ ])
            data.uploads.push(logevent);

        if (response?.continue)
            enqueuer([
                [
                    "commons.wikimedia.org",
                    { ...uploadsBody, ...response.continue },
                    uploadsResponseHandler,
                    uploadsErrorHandler
                ]
            ]);
    };
    const uploadsErrorHandler = error => {
        console.error(error);
    };

    let resolver;
    const promise = new Promise(resolve => resolver = resolve);

    enqueuer([
        [
            "login.wikimedia.org",
            {
                "action": "query",

                "list": "globalusers|globalblocks",
                "meta": "globaluserinfo",

                /* list>globalusers */
                "gususers": user,
                "gusprop": "*",

                /* list>globalblocks */
                "bgtargets": user,
                "bgprop": "*",
                "bglimit": "1",

                /* meta>globaluserinfo */
                "guiprop": "merged",
                "guiuser": user
            },
            response => {
                const globalUserInfo = response?.query?.globaluserinfo ?? { };
                data.gui = { ...globalUserInfo, merged: undefined };

                data.gus = response?.query?.globalusers?.[0] ?? { };
                data.bg = response?.query?.globalblocks?.[0] ?? { };

                const stats = {
                    total: 0,
                    fetched: 0,
                    parsed: 0
                };

                const contribsBody = {
                    "action": "query",

                    "list": "usercontribs",
                    "meta": "userinfo",

                    /* list>usercontribs */
                    "ucuser": user,
                    "uclimit": "max",

                    /* meta>userinfo */
                    "uiprop": "*"
                };
                const editsEnqueuer = (hostname, params) => {
                    enqueuer([
                        [
                            hostname,
                            params,
                            response => {
                                if (response?.query?.userinfo)
                                    data.wikis[hostname].userinfo = response.query.userinfo;

                                handleNewEdits(hostname, response?.query?.usercontribs || [ ]);
                                if (response.continue)
                                    editsEnqueuer(hostname, { ...contribsBody, ...response.continue });
                            },
                            error => {
                                console.error(error);
                            }
                        ]
                    ]);
                };

                (globalUserInfo?.merged ?? [ ]).map(merge => {
                    const hostname = hostnameCache.renew(merge.url, () => new URL(merge.url).hostname);
                    data.wikis[hostname] = { hostname, data: merge, edits: [ ] };

                    if (merge.editcount > 0) {
                        editsEnqueuer(hostname, contribsBody);
                        stats.total += merge.editcount;
                    }
                });

                const handleNewEdits = (hostname, edits) => {
                    const count = edits.length;
                    stats.fetched += count;
                    for (let i = 0; i < count; i++) {
                        const edit = edits[i];
                        enqueuer([
                            [
                                hostname,
                                {
                                    "action": "parse",
                                    "oldid": edit.revid,
                                    "prop": "categories|externallinks|images",

                                    "disablelimitreport": true,
                                    "disableeditsection": true,
                                    "disablestylededuplication": true
                                },
                                response => {
                                    data.wikis[hostname].edits.push({ edit: edit, parsed: response?.parse || { } });
                                    stats.parsed++;
                                },
                                error => {
                                    console.error(error);
                                }
                            ]
                        ]);
                    }
                };
            },
            error => {
                console.error(error);
            }
        ],
        [ "commons.wikimedia.org", uploadsBody, uploadsResponseHandler, uploadsErrorHandler ]
    ]).callback(() => resolver(data));

    return promise;
}

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
    ws.on("message", data => {
        const [ token, username ] = data.toString().split(/:(.*)/s);
        if (!token || !username)
            return ws.send(JSON.stringify({ error: "Invalid token or username" }));

        parseUser(token, username)
            .then(data => ws.send(JSON.stringify(data)))
            .catch(error => ws.send(JSON.stringify({ error: error.message })));
    });
});

server.listen(3000, () => console.log("Server running on ws://localhost:3000"));