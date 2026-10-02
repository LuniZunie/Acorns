import { createServer } from "node:http";

import { WebSocketServer } from "ws";

import fetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";

import { Time } from "./custom_modules/time.js";
import { TempMap } from "./custom_modules/temp-map.js";

const RATE_LIMIT_NORMAL = Time.minutes(1) / 2000;
if (RATE_LIMIT_NORMAL < 0 || !Number.isFinite(RATE_LIMIT_NORMAL))
    throw new Error("Rate limit must be a non-negative finite number");

const RATE_LIMIT_EXEMPT = 0;
if (RATE_LIMIT_EXEMPT < 0 || !Number.isFinite(RATE_LIMIT_EXEMPT))
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

function parseUser(token, user, progressCallback = () => { }) {
    const start = performance.now();

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
            const rateLimitExempt = groups => groups.some(group => [ "local-bot", "steward" ].includes(group));
            const enqueuer = getEnqueuer(token, rateLimitExempt(response?.query?.globaluserinfo?.groups || [ ]) ? RATE_LIMIT_EXEMPT : RATE_LIMIT_NORMAL);

            const data = {
                user,
                gui: { },
                gus: { },
                bg: { },
                wikis: { },
                uploads: [ ]
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

            const progress = {
                total: 0,
                done: 0,
                update: function(n) {
                    this.done += n;
                    progressCallback(this.done, this.total);
                }
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
                        const globalUserInfo = response?.query?.globaluserinfo ?? { };
                        data.gui = { ...globalUserInfo, merged: undefined };

                        data.gus = response?.query?.globalusers?.[0] ?? { };
                        data.bg = response?.query?.globalblocks || [ ];

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

                        (globalUserInfo?.merged ?? [ ]).map(merge => {
                            const hostname = hostnameCache.renew(merge.url, () => new URL(merge.url).hostname);
                            data.wikis[hostname] = { hostname, data: merge, edits: [ ] };

                            if (merge.editcount > 0) {
                                editsEnqueuer(hostname, contribsBody);
                                progress.total += merge.editcount * 4; // 4 API calls per edit* (fetch, parse, query, parse) (*can be 3 if user is onlyauthor of page)
                            }
                        });

                        const handleNewEdits = (hostname, edits) => {
                            const count = edits.length;
                            progress.update(count);
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
                                            progress.update(1);

                                            const parsedEdit = { edit: edit, categories: response?.parse?.categories || [ ] };
                                            data.wikis[hostname].edits.push(parsedEdit);

                                            const base = { externallinks: response?.parse?.externallinks || [ ], images: response?.parse?.images || [ ] };
                                            enqueuer([
                                                [
                                                    hostname,
                                                    {
                                                        "action": "query",
                                                        "prop": "revisions",
                                                        titles: edit.title,

                                                        "rvstartid": edit.revid,
                                                        "rvexcludeuser": user,
                                                        "rvlimit": 1
                                                    },
                                                    response => {
                                                        progress.update(1);

                                                        const revision = response?.query?.pages?.[0]?.revisions?.[0];
                                                        if (revision)
                                                            enqueuer([
                                                                [
                                                                    hostname,
                                                                    {
                                                                        "action": "parse",
                                                                        "oldid": revision.revid,
                                                                        "prop": "externallinks|images",

                                                                        "disablelimitreport": true,
                                                                        "disableeditsection": true,
                                                                        "disablestylededuplication": true
                                                                    },
                                                                    response => {
                                                                        progress.update(1);

                                                                        const end = { externallinks: response?.parse?.externallinks || [ ], images: response?.parse?.images || [ ] };
                                                                        [ "externallinks", "images" ].forEach(prop => {
                                                                            const baseSet = new Set(base[prop]), endSet = new Set(end[prop]);
                                                                            parsedEdit[prop] = {
                                                                                added: end[prop].filter(item => !baseSet.has(item)),
                                                                                removed: base[prop].filter(item => !endSet.has(item))
                                                                            };
                                                                        });
                                                                    },
                                                                    error => {
                                                                        console.error(error);
                                                                    }
                                                                ]
                                                            ]);
                                                        else {
                                                            progress.update(1);

                                                            parsedEdit.externallinks = { added: base.externallinks, removed: [ ] };
                                                            parsedEdit.images = { added: base.images, removed: [ ] };
                                                        }
                                                    },
                                                    error => {
                                                        console.error(error);
                                                    }
                                                ]
                                            ]);
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
            ]).callback(() => resolver({ data, duration: performance.now() - start }));
        })
        .catch(error => {
            console.error(error);
        });

    return promise;
}

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
    ws.on("message", data => {
        const [ token, usernames ] = data.toString().split(/:(.*)/s);
        if (!token || !usernames)
            return ws.send(JSON.stringify({ event: "error", error: "Invalid token or username" }));

        for (const user of new Set(usernames.split("|")))
            parseUser(token, user, (done, total) => {
                ws.send(JSON.stringify({ event: "progress", progress: { done, total } }));
            })
                .then(data => ws.send(JSON.stringify({ event: "done", data })))
                .catch(error => ws.send(JSON.stringify({ event: "error", error: error.message })));
    });
});

server.listen(3000, () => console.log("Server running on ws://localhost:3000"));