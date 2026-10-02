import { createServer } from "node:http";

import { WebSocketServer } from "ws";

import fetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";

import addArrayToArray from "./custom_modules/add-array-to-array.js";
import batchArray from "./custom_modules/batch-array.js";

import { Time } from "./custom_modules/time.js";
import { TempMap } from "./custom_modules/temp-map.js";

const RATE_LIMIT_NORMAL = Time.minutes(1) / 2000;
if (RATE_LIMIT_NORMAL < 0 || !Number.isFinite(RATE_LIMIT_NORMAL))
    throw new Error("Rate limit (normal) must be a non-negative finite number");

const RATE_LIMIT_EXEMPT = 0;
if (RATE_LIMIT_EXEMPT < 0 || !Number.isFinite(RATE_LIMIT_EXEMPT))
    throw new Error("Rate limit (exempt) must be a non-negative finite number");

const EDIT_BATCH = 50;
if (EDIT_BATCH <= 0 || !Number.isFinite(EDIT_BATCH))
    throw new Error("Edit batch must be a positive finite number");

const MAX_USER_CONTRIBUTIONS_PER_REQUEST = 500;
if (MAX_USER_CONTRIBUTIONS_PER_REQUEST <= 0 || !Number.isFinite(MAX_USER_CONTRIBUTIONS_PER_REQUEST))
    throw new Error("Max user contributions per request must be a positive finite number");

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
    addArrayToArray(this.queue, dataList);
    if (dataList.length > 0 && !this.active) {
        const id = ++this.id;
        this.active = true;

        this.idle = false;

        waitUntil(this.last + this.rateLimit)
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
                    await waitUntil(this.last + this.rateLimit);
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

const getEnqueuer = (function (token, rateLimit) {
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

    const context = { token, ongoing: [ ], queue: [ ], last: -rateLimit, rateLimit, callbacks: [ ], id: 0n, active: false, idle: false }
    const enqueuer = enqueueMwFetch.bind(context);
    this.enqueuers.set(token, { context, enqueuer });
    return enqueuer;
}).bind({ enqueuers: new Map() });

function parseUser(token, user, cancel, progressCallback = () => { }) {
    const start = performance.now();
    const progress = {
        total: 0,
        done: 0,
        update: function(n) {
            this.done = Math.min(this.done + n, this.total);
            progressCallback(this.done, this.total);
        }
    };

    const data = {
        user,
        gui: { },
        gus: { },
        bg: { },
        wikis: { },
        uploads: [ ]
    };

    let resolver;
    const promise = new Promise(resolve => resolver = resolve);
    mwFetch(
        token,
        "login.wikimedia.org",
        {
            "action": "query",
            "meta": "globaluserinfo",

            // meta>globaluserinfo
            "guiuser": user,
            "guiprop": "groups",
        }
    )
        .then(response => {
            if (cancel.cancelled) return;

            const rateLimitExempt = groups => groups.some(group => [ "local-bot", "steward" ].includes(group));
            const enqueuer = getEnqueuer(token, rateLimitExempt(response?.query?.globaluserinfo?.groups || [ ]) ? RATE_LIMIT_EXEMPT : RATE_LIMIT_NORMAL);

            const uploadsBody = {
                "action": "query",
                "list": "logevents",

                /* list>logevents */
                leuser: user,
                letype: "upload",
                lelimit: "max"
            };
            const uploadsResponseHandler = response => {
                if (cancel.cancelled) return;
                addArrayToArray(data.uploads, response?.query?.logevents || [ ]);
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

            const contribsBody = {
                "action": "query",

                "list": "usercontribs|blocks",

                /* list>usercontribs */
                "ucuser": user,
                "uclimit": "max",

                /* list>blocks */
                "bkusers": user,
                "bkprop": "id|user|by|reason|expiry|flags"
            };
            const editsEnqueuer = (hostname, params) => {
                enqueuer([
                    [
                        hostname,
                        params,
                        response => {
                            if (cancel.cancelled) return;

                            progress.update(1);
                            if (response?.query?.blocks)
                                data.wikis[hostname].blocks = response.query.blocks;

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

            const handleNewEdits = (hostname, edits) => {
                let skippedParents = 0;
                const parentIds = new Set();
                const parentToBase = new Map();
                for (const batch of batchArray(edits, EDIT_BATCH)) {
                    let baseRevids = "";
                    for (const edit of batch) {
                        data.wikis[hostname].edits[edit.revid] = { edit, base: "", parent: "" };

                        baseRevids += baseRevids ? `|${edit.revid}` : edit.revid;
                        if (edit.parentid) {
                            parentIds.add(edit.parentid);
                            parentToBase.set(edit.parentid, edit.revid);
                        } else {
                            skippedParents = (skippedParents + 1) % EDIT_BATCH;
                            if (skippedParents === 0)
                                progress.update(1); // we've esentially skipped a whole batch
                        }
                    }

                    enqueuer([
                        [
                            hostname,
                            {
                                "action": "query",
                                "prop": "revisions",
                                "revids": baseRevids,

                                /* prop>revisions */
                                "rvprop": "ids|content",
                            },
                            response => {
                                if (cancel.cancelled) return;

                                progress.update(1);
                                for (const page of response?.query?.pages || [ ])
                                    for (const rev of page?.revisions || [ ])
                                        data.wikis[hostname].edits[rev.revid].base = rev.content;
                            },
                            error => {
                                console.error(error);
                            }
                        ]
                    ]);

                    if (parentIds.size >= EDIT_BATCH) {
                        let parentRevids = "";
                        const iterator = parentIds.values();
                        for (let i = 0; i < EDIT_BATCH; i++) {
                            const { next, done } = iterator.next();
                            if (done) break;
                            parentRevids += parentRevids ? `|${next}` : next;
                            parentIds.delete(next);
                        }

                        enqueuer([
                            [
                                hostname,
                                {
                                    "action": "query",
                                    "prop": "revisions",
                                    "revids": parentRevids,

                                    /* prop>revisions */
                                    "rvprop": "ids|content",
                                },
                                response => {
                                    if (cancel.cancelled) return;

                                    progress.update(1);
                                    for (const page of response?.query?.pages || [ ])
                                        for (const rev of page?.revisions || [ ])
                                            data.wikis[hostname].edits[parentToBase.get(rev.revid)].parent = rev.content;
                                },
                                error => {
                                    console.error(error);
                                }
                            ]
                        ]);
                    }
                }

                if (parentIds.size > 0)
                    enqueuer([
                        [
                            hostname,
                            {
                                "action": "query",
                                "prop": "revisions",
                                "revids": Array.from(parentIds).join("|"),

                                /* prop>revisions */
                                "rvprop": "ids|content"
                            },
                            response => {
                                if (cancel.cancelled) return;

                                progress.update(1);
                                for (const page of response?.query?.pages || [ ])
                                    for (const rev of page?.revisions || [ ])
                                        data.wikis[hostname].edits[parentToBase.get(rev.revid)].parent = rev.content;
                            },
                            error => {
                                console.error(error);
                            }
                        ]
                    ]);
            };

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
                        "bglimit": "max",

                        /* meta>globaluserinfo */
                        "guiprop": "merged",
                        "guiuser": user
                    },
                    response => {
                        if (cancel.cancelled) return;

                        const globalUserInfo = response?.query?.globaluserinfo ?? { };
                        data.gui = { ...globalUserInfo, merged: undefined };

                        data.gus = response?.query?.globalusers?.[0] ?? { };
                        data.bg = response?.query?.globalblocks || [ ];

                        (globalUserInfo?.merged ?? [ ]).map(merge => {
                            const hostname = hostnameCache.renew(merge.url, () => new URL(merge.url).hostname);
                            data.wikis[hostname] = { hostname, data: merge, edits: { } };

                            if (merge.editcount > 0) {
                                progress.total += Math.ceil(merge.editcount / MAX_USER_CONTRIBUTIONS_PER_REQUEST); // number of requests needed for this user's contributions
                                progress.total += Math.ceil(merge.editcount / EDIT_BATCH) * 2; // number of requests for getting content of revisions (and their parents)

                                editsEnqueuer(hostname, contribsBody);
                            }
                        });
                        progress.update(0); // initial progress update
                    },
                    error => {
                        console.error(error);
                    }
                ],
                [ "commons.wikimedia.org", uploadsBody, uploadsResponseHandler, uploadsErrorHandler ]
            ])
                .callback(() => {
                    if (cancel.cancelled) return;

                    if (progress.done < progress.total) {
                        progress.done = progress.total;
                        progress.update(0);
                    }

                    resolver({ data, duration: performance.now() - start });
                });
        })
        .catch(error => {
            console.error(error);
        });

    return promise;
}

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
    const cancel = { cancelled: false };
    ws.on("message", data => {
        if (cancel.cancelled) return;

        const [ token, usernames ] = data.toString().split(/:(.*)/s);
        if (!token || !usernames)
            return ws.send(JSON.stringify({ event: "error", error: "Invalid token or username" }));

        for (const user of new Set(usernames.split("|")))
            parseUser(token, user, cancel, (done, total) => {
                ws.send(JSON.stringify({ event: "progress", progress: { done, total } }));
            })
                .then(data => ws.send(JSON.stringify({ event: "done", data })))
                .catch(error => ws.send(JSON.stringify({ event: "error", error: error.message })));
    });
    ws.on("close", () => {
        cancel.cancelled = true;
    });
});

server.listen(3000, () => console.log("Server running on ws://localhost:3000"));