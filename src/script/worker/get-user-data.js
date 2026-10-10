import { Time } from "../helpers/time.js";

import { AddArrayToArray, BatchArray } from "../helpers/array.js";

import { NormalizeUser } from "../helpers/normalize-user.js";
import { ParseWikitext } from "../helpers/parse-wikitext.js";

const RATE_LIMIT_NORMAL = Time.minutes(1) / (2000 * .95);
const RATE_LIMIT_EXEMPT = 1;
const EDIT_BATCH = 50;
const MAX_USER_CONTRIBUTIONS_PER_REQUEST = 500;
const MAX_RATE_LIMIT_RETRIES = 5;
const INITIAL_RATE_LIMIT_BACKOFF = 1000;
const MAX_RATE_LIMIT_BACKOFF = 60000;
const API_USER_AGENT = "Acorns-Client/1.0 (https://github.com/LuniZunie/Acorns)";

const PRIORITY = { normal: 0, contribs: 1, login: 2 };

const getExpectedEditRequests = editCount => {
    if (!Number.isFinite(editCount) || editCount <= 0) return 0;
    return Math.ceil(editCount / MAX_USER_CONTRIBUTIONS_PER_REQUEST) +
        Math.ceil(editCount / EDIT_BATCH) * 2;
};

const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

const waitUntil = async time => { // makes sure we never undershoot the wait even slightly
    let wait = time - performance.now();
    while (wait > 0) {
        await sleep(wait);
        wait = time - performance.now();
    }
};

const revisionContent = rev => rev.slots?.main?.content ?? rev.content;
const revisionModel = rev => rev.slots?.main?.contentmodel ?? rev.contentmodel;

const scheduler = {
    rateLimit: RATE_LIMIT_NORMAL,
    last: -Infinity,
    rateLimitedUntil: 0,
    queue: [ ],
    running: false,
    ongoing: new Set(),

    deferUntil(time) {
        this.rateLimitedUntil = Math.max(this.rateLimitedUntil, time);
    },

    enqueue(items) {
        AddArrayToArray(this.queue, items);
        if (!this.running) this.run();
    },

    // Removes and returns the highest priority item; first-queued wins ties.
    takeNext() {
        let best = 0;
        for (let i = 1; i < this.queue.length; i++)
            if (this.queue[i].priority > this.queue[best].priority) best = i;
        return this.queue.splice(best, 1)[0];
    },

    async waitForSlot() {
        do await waitUntil(Math.max(this.last + this.rateLimit, this.rateLimitedUntil));
        while (performance.now() < this.rateLimitedUntil); // may have been pushed back while waiting
    },

    async run() {
        this.running = true;
        try {
            do {
                while (this.queue.length > 0) {
                    const item = this.takeNext();
                    if (item.cancelled()) {
                        item.settle();
                        continue;
                    }

                    await this.waitForSlot();
                    this.last = performance.now();

                    const promise = item.run().finally(() => { this.ongoing.delete(promise); });
                    this.ongoing.add(promise);
                }

                await Promise.all(this.ongoing);
            } while (this.queue.length > 0); // handlers may have queued follow-up requests
        } finally {
            this.running = false;
        }
    }
};

const getRetryAfterDelay = (response, retryCount) => {
    const retryAfter = response.headers.get("Retry-After")?.trim();
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0)
            return seconds * 1000;

        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt))
            return Math.max(0, retryAt - Date.now());
    }

    return Math.min(INITIAL_RATE_LIMIT_BACKOFF * 2 ** retryCount, MAX_RATE_LIMIT_BACKOFF);
};

async function mwFetch(getToken, project, params) {
    let retryUnauthorized = true;
    let rateLimitRetries = 0;

    while (true) {
        const token = await getToken();
        let response;
        try {
            response = await fetch(`https://${project}/w/api.php?crossorigin=`, {
                method: "POST",
                headers: {
                    "Api-User-Agent": API_USER_AGENT,
                    "Authorization": `Bearer ${token.access}`
                },
                body: new URLSearchParams({ ...params, format: "json", formatversion: "2" })
            });
        } catch (error) { throw new Error(`Network or CORS error (no HTTP response received): ${error.message}`, { cause: error }); }

        if (response.status === 401 && retryUnauthorized) {
            retryUnauthorized = false; // the token getter may hand out a fresh token
            continue;
        }

        if (response.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            const retryAt = performance.now() + getRetryAfterDelay(response, rateLimitRetries++);
            scheduler.deferUntil(retryAt);
            await waitUntil(retryAt);
            continue;
        }

        if (!response.ok)
            throw new Error(`HTTP ${response.status} error${response.statusText ? `: ${response.statusText}` : "."}`);

        const json = await response.json();
        if (json.error) throw new Error(`API error (${json.error.code}): ${json.error.info}`);
        return json;
    }
}

async function loadSitematrix() {
    const sitematrix = await fetch(`${self.location.origin}/sitematrix`).then(res => res.json());

    const codeByHost = new Map();
    const hostByCode = new Map();
    for (const [ host, code ] of Object.entries(sitematrix)) {
        codeByHost.set(host, code);
        hostByCode.set(code, host);
    }

    return { codeByHost, hostByCode };
}

function resolveProjects(projectRules, { codeByHost, hostByCode }) {
    const resolveCode = name => hostByCode.has(name) ? name : codeByHost.get(name);

    let all = false;
    const include = new Set();
    const exclude = new Set();

    for (const rule of projectRules) {
        const normalized = rule.toLowerCase();

        if (normalized === "*") {
            all = true;
            include.clear();
            exclude.clear();
            continue;
        }

        const negate = normalized.startsWith("!");
        const code = resolveCode(negate ? normalized.slice(1) : normalized);
        if (!code) continue;

        const target = all ? exclude : include;
        if (negate === all) target.add(code);
        else target.delete(code);
    }

    const toHosts = codes => new Set(Array.from(codes, code => hostByCode.get(code)));

    return {
        history: [
            ...(all ? [ "*" ] : [ ]),
            ...include,
            ...Array.from(exclude, code => `!${code}`)
        ],
        all,
        include: toHosts(include),
        exclude: toHosts(exclude)
    };
}

const eventBase = le => ({
    logid: le.logid,
    title: le.title,
    timestamp: le.timestamp,
    comment: le.comment,
    params: le.params,
    user: le.user
});

const blockEvent = (unblockAction, reblockAction) => le => ({
    ...eventBase(le),
    unblock: le.action === unblockAction,
    reblock: le.action === reblockAction
});

const uploadEvent = le => ({
    logid: le.logid,
    action: le.action,
    title: le.title,
    timestamp: le.timestamp,
    comment: le.comment || "",
    tags: le.tags || [ ]
});

const withReason = block => ({ ...block, reason: block.reason || "" });
const localBlock = ({ user: _, ...block }) => withReason(block);
const globalBlock = ({ target: _, ...block }) => withReason(block);

const revisionsParams = revids => ({
    action: "query",
    prop: "revisions",
    revids: revids.join("|"),
    rvprop: "ids|content|contentmodel",
    rvslots: "main"
});

const createEdit = contrib => ({
    title: contrib.title,
    revid: contrib.revid,
    parentid: contrib.parentid,

    timestamp: contrib.timestamp,
    comment: contrib.comment || "",
    tags: contrib.tags || [ ],
    sizediff: contrib.sizediff,

    categories: [ ],
    images: { "+": [ ], "-": [ ] },
    links: { "+": [ ], "-": [ ] },

    // A: this revision, B: its parent (c: categories, i: images, l: links, d: loaded)
    A: { c: [ ], i: [ ], l: [ ], d: false },
    B: { c: [ ], i: [ ], l: [ ], d: false }
});

const finishEdit = edit => {
    const { A, B } = edit;
    delete edit.A;
    delete edit.B;

    edit.categories = A.c;

    const imagesA = new Set(A.i);
    const imagesB = new Set(B.i);
    edit.images["+"] = A.i.filter(image => !imagesB.has(image));
    edit.images["-"] = B.i.filter(image => !imagesA.has(image));

    // link capitalization changes don't count as new links
    const linksA = new Set(A.l.map(link => link.toLowerCase()));
    const linksB = new Set(B.l.map(link => link.toLowerCase()));
    edit.links["+"] = A.l.filter(link => !linksB.has(link.toLowerCase()));
    edit.links["-"] = B.l.filter(link => !linksA.has(link.toLowerCase()));
};

const applyRevisions = (response, side, other, lookup) => {
    const store = (revid, content) => {
        for (const edit of lookup(revid)) {
            edit[side] = content;
            if (edit[other].d) finishEdit(edit);
        }
    };

    for (const bad of Object.values(response.query.badrevids || { }))
        for (const edit of lookup(bad.revid)) {
            edit[side].d = true;
            if (edit[other].d) finishEdit(edit);
        }

    for (const page of response.query.pages || [ ])
        for (const rev of page.revisions || [ ])
            store(rev.revid, ParseWikitext(revisionContent(rev), revisionModel(rev) === "wikitext"));
};

async function GetUserData(getToken, users, projectRules, callback = () => { }) {
    if (typeof getToken !== "function")
        throw new Error("(get-user-data) Token getter must be a function");
    if (!Array.isArray(users))
        throw new Error("(get-user-data) Usernames must be an array");
    if (!Array.isArray(projectRules))
        throw new Error("(get-user-data) Project rules must be an array");
    if (typeof callback !== "function")
        throw new Error("(get-user-data) Invalid callback");

    users = Array.from(new Set(
        users.filter(user => user && typeof user === "string").map(NormalizeUser).filter(Boolean)
    ));

    const sitematrix = await loadSitematrix();
    const projects = resolveProjects(projectRules, sitematrix);

    postMessage({ type: "history", state: { users: users.slice(), projects: projects.history } });

    if (users.length === 0) {
        callback({ status: "progress", data: 1 });
        callback({ status: "done", data: [ ] });
        return { close: () => { } };
    }

    let cancelled = false;
    let finished = false;

    // Everything except the initial login requests waits until all of those have returned.
    let releaseLoginBarrier;
    const loginBarrier = new Promise(resolve => { releaseLoginBarrier = resolve; });
    let loginResponsesRemaining = users.length;
    const initialLoginReturned = () => { if (--loginResponsesRemaining === 0) releaseLoginBarrier(); };

    const fail = error => {
        if (finished) return;
        finished = true;
        cancelled = true;
        releaseLoginBarrier();
        callback({ status: "error", data: error });
    };

    const progressMap = new Map();
    let lastProgress = 0;
    const reportProgress = (user, { done, total } = progressMap.get(user) ?? { done: 1, total: 1 }) => {
        progressMap.set(user, { done, total });

        let doneSum = 0, totalSum = 0;
        for (const p of progressMap.values()) {
            doneSum += p.done;
            totalSum += p.total;
        }
        if (totalSum === 0) return;

        const progress = doneSum / totalSum;
        if (progress <= lastProgress) return;
        lastProgress = progress;
        if (!finished) callback({ status: "progress", data: progress });
    };

    const mwGet = (project, params) => mwFetch(getToken, project, params);

    const createTracker = onIdle => {
        let pending = 0;
        return (requests, initialLogin = false) => {
            const items = requests.map(([ project, params, handler, priority = PRIORITY.normal ]) => {
                pending++;

                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    if (--pending === 0 && !cancelled) onIdle();
                };

                return {
                    priority,
                    cancelled: () => cancelled,
                    settle,
                    run: () => mwGet(project, params)
                        .then(response => { if (!cancelled) handler(response); })
                        .catch(fail)
                        .finally(settle)
                };
            });

            if (initialLogin) scheduler.enqueue(items);
            else loginBarrier.then(() => scheduler.enqueue(items));
        };
    };

    const parseUser = user => new Promise(resolve => {
        const progress = {
            total: 0,
            done: 0,
            report() {
                reportProgress(user, this);
            },
            advance(n) {
                const done = Math.min(this.done + n, this.total);
                if (done === this.done) return;
                this.done = done;
                this.report();
            }
        };

        const data = { missing: true, name: user, groups: [ ], rights: [ ], block: [ ], blocks: [ ], uploads: [ ], locks: [ ] };
        const projectsMap = new Map();

        const enqueue = createTracker(() => {
            if (progress.done < progress.total) {
                progress.done = progress.total;
                progress.report();
            }
            resolve(data);
        });

        /** Builds a request for a paginated list=logevents query that appends into `target`. */
        const logEventsRequest = (project, params, target, mapEvent) => {
            const body = { action: "query", list: "logevents", lelimit: "max", ...params };
            const handler = response => {
                AddArrayToArray(target, (response.query.logevents || [ ]).map(mapEvent));
                if (response.continue)
                    enqueue([ [ project, { ...body, ...response.continue }, handler ] ]);
            };
            return [ project, body, handler ];
        };

        const contribsBody = {
            action: "query",
            list: "usercontribs|blocks",
            ucuser: user,
            ucprop: "ids|title|timestamp|comment|sizediff|tags",
            uclimit: "max",
            bkusers: user,
            bkprop: "id|user|by|reason|expiry|flags"
        };

        const handleNewEdits = (project, contribs) => {
            if (contribs.length === 0) return;

            const projectData = projectsMap.get(project);
            const editsByRevid = new Map();
            const basesByParent = new Map(); // parent revid -> set of revids built on it
            const pendingParents = new Set();
            let parentlessEdits = 0;

            const requestRevisions = (revids, side, other, lookup) => enqueue([[
                project,
                revisionsParams(revids),
                response => {
                    applyRevisions(response, side, other, lookup);
                    progress.advance(1);
                }
            ]]);

            const requestParents = parentIds => requestRevisions(parentIds, "B", "A", revid =>
                Array.from(basesByParent.get(revid) ?? [ ], base => editsByRevid.get(base))
            );

            for (const batch of BatchArray(contribs, EDIT_BATCH)) {
                const revids = [ ];

                for (const contrib of batch) {
                    const edit = createEdit(contrib);
                    projectData.edits.push(edit);
                    editsByRevid.set(contrib.revid, edit);
                    revids.push(contrib.revid);

                    if (contrib.parentid) {
                        pendingParents.add(contrib.parentid);
                        if (!basesByParent.has(contrib.parentid)) basesByParent.set(contrib.parentid, new Set());
                        basesByParent.get(contrib.parentid).add(contrib.revid);
                    } else {
                        edit.B.d = true; // page creation, nothing to compare against
                        parentlessEdits = (parentlessEdits + 1) % EDIT_BATCH;
                        if (parentlessEdits === 0) progress.advance(1); // stands in for a skipped parent request
                    }
                }

                requestRevisions(revids, "A", "B", revid => editsByRevid.has(revid) ? [ editsByRevid.get(revid) ] : [ ]);

                if (pendingParents.size >= EDIT_BATCH) {
                    const parentIds = Array.from(pendingParents).slice(0, EDIT_BATCH);
                    parentIds.forEach(id => pendingParents.delete(id));
                    requestParents(parentIds);
                }
            }

            if (pendingParents.size > 0) requestParents(Array.from(pendingParents));
        };

        const enqueueEdits = (project, params) => {
            enqueue([[
                project,
                params,
                response => {
                    if (response.query.blocks)
                        AddArrayToArray(projectsMap.get(project).block, response.query.blocks.map(localBlock));

                    handleNewEdits(project, response.query.usercontribs || [ ]);
                    if (response.continue)
                        enqueueEdits(project, { ...contribsBody, ...response.continue });

                    progress.advance(1);
                },
                PRIORITY.contribs
            ]]);
        };

        const handleLogin = response => {
            initialLoginReturned();

            const globalUserInfo = response.query.globaluserinfo;
            if (globalUserInfo.missing === true) return resolve(null);

            const globalUser = response.query.globalusers[0];

            data.home = sitematrix.hostByCode.get(globalUserInfo.home) || null;
            data.registration = { project: globalUserInfo.home, timestamp: globalUserInfo.registration };
            data.edit_count = globalUser.editcount;
            data.groups = globalUser.groups || [ ];
            data.rights = globalUser.rights || [ ];
            data.locked = globalUser.locked;
            AddArrayToArray(data.block, (response.query.globalblocks || [ ]).map(globalBlock));
            data.projects = [ ];
            data.missing = false;

            const merged = (globalUserInfo.merged ?? [ ])
                .map(merge => ({ merge, host: new URL(merge.url).hostname }))
                .filter(({ host }) => !projects.exclude.has(host) && (projects.all || projects.include.has(host)));

            progress.total = merged.reduce((total, { merge }) => total + getExpectedEditRequests(merge.editcount), 0);

            for (const { merge, host } of merged) {
                const projectData = {
                    project: host,
                    code: merge.wiki,
                    registration: { method: merge.method, timestamp: merge.timestamp },
                    edit_count: merge.editcount,
                    block: [ ],
                    blocks: [ ],
                    edits: [ ]
                };
                projectsMap.set(host, projectData);
                data.projects.push(projectData);

                if (merge.editcount > 0) {
                    enqueueEdits(host, contribsBody);
                    enqueue([ logEventsRequest(host, { letype: "block", letitle: `User:${user}` }, projectData.blocks, blockEvent("unblock", "reblock")) ]);
                }
            }

            progress.report();
        };

        enqueue([[
            "login.wikimedia.org",
            {
                action: "query",
                list: "globalusers|globalblocks",
                meta: "globaluserinfo",
                gususers: user,
                gusprop: "editcount|groups|rights|locked",
                bgtargets: user,
                bglimit: "max",
                guiprop: "merged",
                guiuser: user
            },
            handleLogin,
            PRIORITY.login
        ]], true);

        enqueue([
            logEventsRequest("commons.wikimedia.org", {
                leuser: user,
                letype: "upload",
                leaction: "upload/upload",
                leprop: "ids|title|timestamp|comment|tags"
            }, data.uploads, uploadEvent),
            logEventsRequest("meta.wikimedia.org", {
                letype: "globalauth",
                leaction: "globalauth/setstatus",
                letitle: `User:${user}@global`
            }, data.locks, eventBase),
            logEventsRequest("meta.wikimedia.org", {
                letype: "gblblock",
                letitle: `User:${user}`
            }, data.blocks, blockEvent("gunblock", "modify"))
        ]);
    });

    const run = async () => {
        // Learn the caller's rate limit tier first, then fetch every user.
        const response = await mwGet("login.wikimedia.org", { action: "query", meta: "globaluserinfo", guiprop: "groups" });
        if (cancelled) return;

        const groups = response.query.globaluserinfo?.groups || [ ];
        scheduler.rateLimit = groups.some(group => [ "local-bot", "steward" ].includes(group))
            ? RATE_LIMIT_EXEMPT
            : RATE_LIMIT_NORMAL;

        const results = await Promise.all(users.map(async user => {
            const result = await parseUser(user);
            reportProgress(user);
            return result;
        }));
        if (cancelled || finished) return;

        finished = true;
        callback({ status: "done", data: results.filter(Boolean) });
    };
    run().catch(fail);

    return {
        close: () => {
            cancelled = true;
            releaseLoginBarrier();
        }
    };
}

// Worker bridge: tokens are owned by the main thread and requested on demand.
const tokenRequests = new Map();
let nextTokenRequestId = 0;

const requestToken = () => new Promise((resolve, reject) => {
    const id = nextTokenRequestId++;
    tokenRequests.set(id, { resolve, reject });
    postMessage({ type: "token-request", id });
});

self.addEventListener("message", ({ data: message }) => {
    if (message.type === "token-response") {
        const request = tokenRequests.get(message.id);
        if (!request) return;
        tokenRequests.delete(message.id);

        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.token);
    } else if (message.type === "start") {
        GetUserData(requestToken, message.users, message.projectRules, result => {
            if (result.status === "error")
                result.data = {
                    message: String(result.data),
                    name: result.data?.name || "Error",
                    stack: result.data?.stack,
                    cause: result.data?.cause
                };
            postMessage({ type: "result", result });
        });
    }
});

export default GetUserData;