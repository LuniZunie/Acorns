import { createServer } from "node:http";
import { WebSocketServer } from "ws";

import fetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";

import addArrayToArray from "./custom_modules/add-array-to-array.js";
import batchArray from "./custom_modules/batch-array.js";

import { Time } from "./custom_modules/time.js";
import { TempMap } from "./custom_modules/temp-map.js";

const RATE_LIMIT_NORMAL = Time.minutes(1) / (2000 * .99);
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

// from https://commons.wikimedia.org/wiki/Special:Upload
const FILE_EXTENSIONS = /\.(tiff|tif|png|gif|jpg|jpeg|webp|xcf|pdf|mid|ogg|ogv|svg|djvu|oga|flac|opus|wav|webm|mp3|midi|mpg|mpeg)$/i;
if (!(FILE_EXTENSIONS instanceof RegExp))
    throw new Error("File extensions must be a regular expression");

// caches
const hostnameCache = new TempMap(Time.minutes(30)); // cache hostnames with a 30-minute timeout

// main
const parser = (function (wikitext) {
    if (typeof wikitext !== "string")
        return { c: [ ], i: [ ], l: [ ], d: true };
    return {
        c: (wikitext.match(this.rCAT) || [ ]).map(match => match.trim().replaceAll("_", " ")),
        i: (wikitext.match(this.rIMG) || [ ]).map(match => match.trim().replaceAll("_", " ")),
        l: (wikitext.match(this.rLINK) || [ ]).map(match => match.trim().replaceAll("_", " ")),
        d: true
    }
}).bind({
    rCAT: new RegExp("(?<=\\[\\[Category:)([^\\]|]+)", "gi"),
    rIMG: new RegExp(`((?<=\\[\\[:?(File|Image|Media):)([^\\]\\|]+)|((?<==\\s*).+?(?=${FILE_EXTENSIONS})))`, "gi"),
    rLINK: new RegExp("(?:https?:|(?<=[\\[\\s=|]))//[^\\s\\[\\]<>\"|{}]+", "gi")
});


const waitUntil = (async function(time) { // makes sure we never undershoot the wait even slightly
    let wait = 0;
    do {
        if (wait > 0) await new Promise(resolve => { setTimeout(resolve, wait); });
        wait = time - performance.now();
    } while (wait > 0);
});

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

                    let resolveThis;
                    const thisPromise = new Promise(resolve => { resolveThis = resolve; });
                    this.ongoing.add(thisPromise);

                    mwFetch(this.token, wiki, params)
                        .then(response => response.json())
                        .then(response)
                        .catch(reject)
                        .finally(() => {
                            resolveThis();
                            this.ongoing.delete(thisPromise);
                        });

                    // wait for the rate limit interval to pass before processing the next request
                    await waitUntil(this.last + this.rateLimit);
                    if (this.queue.length > 0) {
                        let resolveNext;
                        const nextPromise = new Promise(resolve => { resolveNext = resolve; });
                        setTimeout(() => call(this.queue.shift()).finally(resolveNext), 0); // bypass call stack limit
                        return await nextPromise;
                    }
                };

                call(this.queue.shift())
                    .finally(() => {
                        this.idle = performance.now();
                        this.active = false;

                        Promise.all(Array.from(this.ongoing))
                            .finally(() => {
                                setTimeout(() => {
                                    if (this.queue.length === 0 && this.id === id)
                                        this.callbacks = this.callbacks.filter(fn => fn());
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
        if (key === token) return value.enqueuer;
        else {
            const idle = value.context.idle;
            if (idle === false) continue;
            else if (performance.now() - idle > Time.minutes(30))
                this.enqueuers.delete(key);
        }
    }

    const context = { token, ongoing: new Set(), queue: [ ], last: -rateLimit, rateLimit, callbacks: [ ], id: 0n, active: false, idle: false }
    const enqueuer = enqueueMwFetch.bind(context);
    this.enqueuers.set(token, { context, enqueuer });
    return enqueuer;
}).bind({ enqueuers: new Map() });

function parseUser(token, user, cancel, progressCallback = () => { }) {
    const progress = {
        total: 0,
        done: 0,
        update: function(n) {
            if (n === 0)
                return progressCallback(this.done, this.total);

            const temp = this.done;
            this.done = Math.min(this.done + n, this.total);
            if (this.done > temp)
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
                "ucprop": "ids|title|timestamp|comment|sizediff|tags",
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

                            if (response?.query?.blocks)
                                data.wikis[hostname].blocks = response.query.blocks;

                            handleNewEdits(hostname, response?.query?.usercontribs || [ ]);
                            if (response.continue)
                                editsEnqueuer(hostname, { ...contribsBody, ...response.continue });

                            progress.update(1);
                        },
                        error => {
                            console.error(error);
                        }
                    ]
                ]);
            };

            const buildEdit = edit => {
                delete edit.B.c;

                edit.categories = edit.A.c;
                delete edit.A.c;

                {
                    const imagesBSet = new Set(edit.B.i);

                    {
                        const imagesASet = new Set(edit.A.i);
                        for (const image of edit.B.i)
                            if (!imagesASet.has(image))
                                edit.images["+"].push(image);
                        delete edit.B.i;
                    }

                    for (const image of edit.A.i)
                        if (!imagesBSet.has(image))
                            edit.images["-"].push(image);
                    delete edit.A.i;
                }

                {
                    const linksBSet = new Set(edit.B.l);

                    {
                        const linksASet = new Set(edit.A.l);
                        for (const link of edit.B.l)
                            if (!linksASet.has(link))
                                edit.links["+"].push(link);
                        delete edit.B.l;
                    }

                    for (const link of edit.A.l)
                        if (!linksBSet.has(link))
                            edit.links["-"].push(link);
                    delete edit.A.l;
                }

                delete edit.A;
                delete edit.B;
            };

            const handleNewEdits = (hostname, edits) => {
                let skippedParents = 0;
                const parentIds = new Set();
                const parentToBase = new Map();
                for (const batch of batchArray(edits, EDIT_BATCH)) {
                    let baseRevids = "";
                    for (const batchEdit of batch) {
                        const edit = data.wikis[hostname].edits[batchEdit.revid] = {
                            edit: batchEdit,
                            categories: [ ],
                            images: { "+": [ ], "-": [ ] },
                            links: { "+": [ ], "-": [ ] },
                            A: { c: [ ], i: [ ], l: [ ], d: false },
                            B: { c: [ ], i: [ ], l: [ ], d: false }
                        };

                        baseRevids += baseRevids ? `|${batchEdit.revid}` : batchEdit.revid;
                        if (batchEdit.parentid) {
                            parentIds.add(batchEdit.parentid);
                            parentToBase.set(batchEdit.parentid, batchEdit.revid);
                        } else {
                            edit.B.d = true;
                            skippedParents = (skippedParents + 1) % EDIT_BATCH;
                            if (skippedParents === 0) progress.update(1); // we've esentially skipped a whole batch
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

                                for (const badRev of Object.values(response?.query?.badrevids || [ ])) {
                                    const edit = data.wikis[hostname].edits[badRev];
                                    edit.A.d = true;
                                    if (edit.B.d) buildEdit(edit);
                                }

                                for (const page of response?.query?.pages || [ ])
                                    for (const rev of page?.revisions || [ ]) {
                                        const edit = data.wikis[hostname].edits[rev.revid];
                                        edit.A = parser(rev.content);
                                        if (edit.B.d) buildEdit(edit);
                                    }

                                progress.update(1);
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
                            const { value, done } = iterator.next();
                            if (done) break;
                            parentRevids += parentRevids ? `|${value}` : value;
                            parentIds.delete(value);
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

                                    for (const badRev of Object.values(response?.query?.badrevids || [ ])) {
                                        const edit = data.wikis[hostname].edits[parentToBase.get(badRev.revid)];
                                        edit.B.d = true;
                                        if (edit.A.d) buildEdit(edit);
                                    }

                                    for (const page of response?.query?.pages || [ ])
                                        for (const rev of page?.revisions || [ ]) {
                                            const edit = data.wikis[hostname].edits[parentToBase.get(rev.revid)];
                                            edit.B = parser(rev.content);
                                            if (edit.A.d) buildEdit(edit);
                                        }

                                    progress.update(1);
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

                                for (const badRev of Object.values(response?.query?.badrevids || [ ])) {
                                    const edit = data.wikis[hostname].edits[parentToBase.get(badRev.revid)];
                                    edit.B.d = true;
                                    if (edit.A.d) buildEdit(edit);
                                }

                                for (const page of response?.query?.pages || [ ])
                                    for (const rev of page?.revisions || [ ]) {
                                        const edit = data.wikis[hostname].edits[parentToBase.get(rev.revid)];
                                        edit.B = parser(rev.content);
                                        if (edit.A.d) buildEdit(edit);
                                    }

                                progress.update(1);
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

                    resolver(data);
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
        if (!token)
            return ws.send(JSON.stringify({ event: "error", error: "Invalid token" }));
        if (!usernames)
            return ws.send(JSON.stringify({ event: "error", error: "Invalid usernames" }));

        for (const username of new Set(usernames.split("|")))
            parseUser(
                token,
                username.trim().replaceAll("_", " "),
                cancel,
                (done, total) => {
                    ws.send(JSON.stringify({ event: "progress", progress: { done, total } }));
                }
            )
                .then(data => ws.send(JSON.stringify({ event: "done", data })))
                .catch(error => ws.send(JSON.stringify({ event: "error", error: error.message })));
    });
    ws.on("close", () => {
        cancel.cancelled = true;
    });
});

server.listen(3000, () => console.log("Server running on ws://localhost:3000"));