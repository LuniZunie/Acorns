import { Time } from "../helpers/time.js";

import { AddArrayToArray } from "../helpers/add-array-to-array.js";
import { BatchArray } from "../helpers/batch-array.js";

import { NormalizeUser } from "../helpers/normalize-user.js";
import { ParseWikitext } from "../helpers/parse-wikitext.js";

const RATE_LIMIT_NORMAL = Time.minutes(1) / (2000 * .95);
const RATE_LIMIT_EXEMPT = 1;
const EDIT_BATCH = 50;
const MAX_USER_CONTRIBUTIONS_PER_REQUEST = 500;

const getExpectedEditRequests = editCount => {
    if (!Number.isFinite(editCount) || editCount <= 0) return 0;
    return Math.ceil(editCount / MAX_USER_CONTRIBUTIONS_PER_REQUEST) +
        Math.ceil(editCount / EDIT_BATCH) * 2;
};

const waitUntil = async time => { // makes sure we never undershoot the wait even slightly
    let wait = 0;
    do {
        if (wait > 0) await new Promise(resolve => { setTimeout(resolve, wait); });
        wait = time - performance.now();
    } while (wait > 0);
};

const revisionContent = rev => rev.slots?.main?.content ?? rev.content;

const scheduler = {
    rateLimit: RATE_LIMIT_NORMAL,
    last: -Infinity,
    queue: [ ],
    running: false,
    ongoing: new Set(),

    enqueue(items) {
        AddArrayToArray(this.queue, items);
        if (!this.running) this.run();
    },

    async run() {
        this.running = true;
        try {
            while (true) {
                while (this.queue.length > 0) {
                    // highest priority first; first-queued wins ties
                    let best = 0;
                    const length = this.queue.length;
                    if (length < 1e4) // only perform the full search for smaller queues, clears up performance for very large queues
                        for (let i = 1; i < length; i++)
                            if (this.queue[i].priority > this.queue[best].priority) best = i;

                    const [ item ] = this.queue.splice(best, 1);
                    if (item.cancelled()) {
                        item.settle();
                        continue;
                    }

                    await waitUntil(this.last + this.rateLimit);
                    this.last = performance.now();

                    const promise = item.run().finally(() => { this.ongoing.delete(promise); });
                    this.ongoing.add(promise);
                }

                await Promise.all(Array.from(this.ongoing));
                if (this.queue.length === 0) break; // handlers may have queued follow-up requests
            }
        } finally {
            this.running = false;
        }
    }
};

const mwFetch = async (getToken, project, params, retry = true) => {
    const token = await getToken();
    const response = await fetch(`https://${project}/w/api.php?crossorigin=`, {
        method: "POST",
        headers: {
            "Api-User-Agent": "Acorns-Client/1.0 (https://github.com/LuniZunie/Acorns)",
            "Authorization": `Bearer ${token.access}`
        },
        body: new URLSearchParams({ ...params, format: "json", formatversion: "2" })
    });

    if (response.status === 401 && retry) return mwFetch(getToken, project, params, false);
    if (!response.ok) throw new Error(`HTTP ${response.status} error${response.statusText ? `: ${response.statusText}` : "."}`);

    const json = await response.json();
    if (json.error) throw new Error(`API error (${json.error.code}): ${json.error.info}`);
    return json;
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

    users = Array.from(new Set(users.filter(user => user && typeof user === "string").map(NormalizeUser).filter(Boolean)));

    let sitematrix = await fetch(`${self.location.origin}/sitematrix`).then(res => res.json());
    {
        const temp = { set: new Set(), map: new Map(), reverse: new Map() };
        for (const [ key, value ] of Object.entries(sitematrix)) {
            temp.set.add(value);
            temp.map.set(key, value);
            temp.reverse.set(value, key);
        }

        sitematrix = temp;
    }

    const projects = { all: false, include: new Set(), exclude: new Set() };
    for (const rule of projectRules) {
        const normalized = rule.toLowerCase();
        if (normalized === "*") {
            projects.all = true;
            projects.include.clear();
            projects.exclude.clear();
        } else if (normalized.startsWith("!")) {
            let project = normalized.slice(1);
            if (sitematrix.set.has(project)) project = project;
            else if (sitematrix.map.has(project)) project = sitematrix.map.get(project);
            else continue;

            if (projects.all)
                projects.exclude.add(project);
            else
                projects.include.delete(project);
        } else {
            let project = normalized;
            if (sitematrix.set.has(project)) project = project;
            else if (sitematrix.map.has(project)) project = sitematrix.map.get(project);
            else continue;

            if (projects.all)
                projects.exclude.delete(project);
            else
                projects.include.add(project);
        }
    }

    const state = { users: users.slice(), projects: [ ] };

    if (projects.all) state.projects.push("*");

    {
        const temp = new Set();
        for (const project of projects.include)
            if (sitematrix.set.has(project)) {
                state.projects.push(project);
                temp.add(sitematrix.reverse.get(project));
            }
        projects.include = temp;
    }

    {
        const temp = new Set();
        for (const project of projects.exclude)
            if (sitematrix.set.has(project)) {
                state.projects.push(`!${project}`);
                temp.add(sitematrix.reverse.get(project));
            }
        projects.exclude = temp;
    }

    postMessage({ type: "history", state });

    if (users.length === 0) {
        callback({ status: "progress", data: 1 });
        callback({ status: "done", data: [ ] });
        return { close: () => { } };
    }

    const cancel = { cancelled: false };
    let finished = false;
    const fail = error => {
        if (finished) return;
        finished = true;
        cancel.cancelled = true;
        callback({ status: "error", data: error });
    };

    const progressMap = new Map();
    let lastProgress = 0;
    const reportProgress = (user, done, total) => {
        if (done === undefined && total === undefined) {
            const temp = progressMap.get(user) ?? { done: 1, total: 1 };
            done = temp.done, total = temp.total;
        }
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
        return items => {
            const wrapped = items.map(([ project, params, handler, priority = 0 ]) => {
                pending++;
                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    if (--pending === 0 && !cancel.cancelled) onIdle();
                };
                return {
                    priority,
                    cancelled: () => cancel.cancelled,
                    settle,
                    run: () => mwGet(project, params)
                        .then(response => { if (!cancel.cancelled) handler(response); })
                        .catch(fail)
                        .finally(settle)
                };
            });
            scheduler.enqueue(wrapped);
        };
    };

    const parseUser = (user, projects) => new Promise(resolve => {
        const progress = {
            total: 0,
            done: 0,
            update(n) {
                if (n === 0) return reportProgress(user, this.done, this.total);

                const temp = this.done;
                this.done = Math.min(this.done + n, this.total);
                if (this.done > temp) reportProgress(user, this.done, this.total);
            }
        };

        const data = { missing: true, user, groups: [ ], rights: [ ], block: [ ], blocks: [ ], uploads: [ ], locks: [ ] };
        const projectsMap = new Map();

        const buildEdit = edit => {
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

        const finalize = () => {
            if (progress.done < progress.total) {
                progress.done = progress.total;
                progress.update(0);
            }

            resolve(data);
        };

        const enqueue = createTracker(finalize);

        const uploadsBody = {
            action: "query",
            list: "logevents",
            leuser: user,
            letype: "upload",
            leaction: "upload/upload",
            leprop: "ids|title|timestamp|comment|tags",
            lelimit: "max"
        };
        const uploadsHandler = response => {
            AddArrayToArray(data.uploads, (response.query.logevents || [ ]).map(le => ({
                logid: le.logid,
                title: le.title,
                timestamp: le.timestamp,
                comment: le.comment || "",
                tags: le.tags || [ ]
            })));
            if (response.continue)
                enqueue([ [ "commons.wikimedia.org", { ...uploadsBody, ...response.continue }, uploadsHandler, 0 ] ]);
        };

        const locksBody = {
            action: "query",
            list: "logevents",
            letype: "globalauth",
            leaction: "globalauth/setstatus",
            letitle: `User:${user}@global`,
            lelimit: "max"
        };
        const locksHandler = response => {
            AddArrayToArray(data.locks, (response.query.logevents || [ ]).map(le => ({
                logid: le.logid,
                title: le.title,
                timestamp: le.timestamp,
                comment: le.comment,
                params: le.params,
                user: le.user
            })));
            if (response.continue)
                enqueue([ [ "meta.wikimedia.org", { ...locksBody, ...response.continue }, locksHandler, 0 ] ]);
        };

        const globalBlocksBody = {
            action: "query",
            list: "logevents",
            letype: "gblblock",
            letitle: `User:${user}`,
            lelimit: "max"
        };
        const globalBlocksHandler = response => {
            AddArrayToArray(data.blocks, (response.query.logevents || [ ]).map(le => ({
                logid: le.logid,
                title: le.title,
                timestamp: le.timestamp,
                comment: le.comment,
                params: le.params,
                user: le.user,
                unblock: le.action === "gunblock"
            })));
            if (response.continue)
                enqueue([ [ "meta.wikimedia.org", { ...globalBlocksBody, ...response.continue }, globalBlocksHandler, 0 ] ]);
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

        const applyRevisions = (response, target, other, lookup) => {
            for (const bad of Object.values(response.query.badrevids || { }))
                for (const edit of lookup(bad.revid)) {
                    edit[target].d = true;
                    if (edit[other].d) buildEdit(edit);
                }

            for (const page of response.query.pages || [ ])
                for (const rev of page.revisions || [ ])
                    for (const edit of lookup(rev.revid)) {
                        edit[target] = ParseWikitext(revisionContent(rev));
                        if (edit[other].d) buildEdit(edit);
                    }
        };

        const handleNewEdits = (project, edits) => {
            if (edits.length === 0) return;

            const projectData = projectsMap.get(project);

            const editMap = new Map();
            const parentToBase = new Map();
            const parentIds = new Set();
            let skippedParents = 0;

            const requestParents = ids => {
                enqueue([
                    [
                        project,
                        { action: "query", prop: "revisions", revids: ids.join("|"), rvprop: "ids|content", rvslots: "main" },
                        response => {
                            applyRevisions(response, "B", "A", revid => Array.from(parentToBase.get(revid) ?? [ ], base => editMap.get(base)));
                            progress.update(1);
                        },
                        0
                    ]
                ]);
            };

            for (const batch of BatchArray(edits, EDIT_BATCH)) {
                const baseRevids = [ ];
                for (const batchEdit of batch) {
                    const edit = {
                        title: batchEdit.title,
                        revid: batchEdit.revid,
                        parentid: batchEdit.parentid,

                        timestamp: batchEdit.timestamp,
                        comment: batchEdit.comment || "",
                        tags: batchEdit.tags || [ ],
                        sizediff: batchEdit.sizediff,

                        categories: [ ],
                        images: { "+": [ ], "-": [ ] },
                        links: { "+": [ ], "-": [ ] },

                        A: { c: [ ], i: [ ], l: [ ], d: false },
                        B: { c: [ ], i: [ ], l: [ ], d: false }
                    };

                    projectData.edits.push(edit);
                    editMap.set(batchEdit.revid, edit);
                    baseRevids.push(batchEdit.revid);

                    if (batchEdit.parentid) {
                        parentIds.add(batchEdit.parentid);
                        if (!parentToBase.has(batchEdit.parentid)) parentToBase.set(batchEdit.parentid, new Set());
                        parentToBase.get(batchEdit.parentid).add(batchEdit.revid);
                    } else {
                        edit.B.d = true; // page creation, nothing to compare against
                        skippedParents = (skippedParents + 1) % EDIT_BATCH;
                        if (skippedParents === 0) progress.update(1);
                    }
                }

                enqueue([
                    [
                        project,
                        { action: "query", prop: "revisions", revids: baseRevids.join("|"), rvprop: "ids|content", rvslots: "main" },
                        response => {
                            applyRevisions(response, "A", "B", revid => editMap.has(revid) ? [ editMap.get(revid) ] : [ ]);
                            progress.update(1);
                        },
                        0
                    ]
                ]);

                if (parentIds.size >= EDIT_BATCH) {
                    const ids = Array.from(parentIds).slice(0, EDIT_BATCH);
                    for (const id of ids) parentIds.delete(id);
                    requestParents(ids);
                }
            }

            if (parentIds.size > 0) requestParents(Array.from(parentIds));
        };

        const editsEnqueue = (project, params) => {
            enqueue([
                [
                    project,
                    params,
                    response => {
                        if (response.query.blocks)
                            AddArrayToArray(projectsMap.get(project).block, response.query.blocks.map(({ user: _, ...block }) =>
                                ({ ...block, reason: block.reason || "" })
                            ));

                        handleNewEdits(project, response.query.usercontribs || [ ]);
                        if (response.continue)
                            editsEnqueue(project, { ...contribsBody, ...response.continue });

                        progress.update(1);
                    },
                    1
                ]
            ]);
        };

        const localBlocksEnqueue = project => {
            const params = {
                action: "query",
                list: "logevents",
                letype: "block",
                letitle: `User:${user}`,
                lelimit: "max"
            };
            const handler = response => {
                AddArrayToArray(projectsMap.get(project).blocks, (response.query.logevents || [ ]).map(le => ({
                    logid: le.logid,
                    title: le.title,
                    timestamp: le.timestamp,
                    comment: le.comment,
                    params: le.params,
                    user: le.user,
                    unblock: le.action === "unblock"
                })));
                if (response.continue)
                    enqueue([ [ project, { ...params, ...response.continue }, handler, 0 ] ]);
            };

            enqueue([ [ project, params, handler, 0 ] ]);
        };

        enqueue([
            [
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
                response => {
                    const globalUserInfo = response.query.globaluserinfo;
                    if (globalUserInfo.missing === true) return resolve(null);

                    const globalUser = response.query.globalusers[0];
                    data.projects = [ ];

                    data.registration = { project: globalUserInfo.home, timestamp: globalUserInfo.registration };
                    data.edit_count = globalUser.editcount;
                    data.groups = globalUser.groups || [ ];
                    data.rights = globalUser.rights || [ ];
                    data.locked = globalUser.locked;
                    AddArrayToArray(data.block, (response.query.globalblocks || [ ]).map(({ target: _, ...block }) =>
                        ({ ...block, reason: block.reason || "" })
                    ));
                    data.missing = false;

                    const mergedProjects = (globalUserInfo.merged ?? [ ])
                        .map(merge => ({ merge, project: new URL(merge.url).hostname }))
                        .filter(({ project }) => !projects.exclude.has(project) && (projects.all || projects.include.has(project)));

                    progress.total = mergedProjects.reduce((total, { merge }) => total + getExpectedEditRequests(merge.editcount), 0);
                    for (const { merge, project } of mergedProjects) {
                        const projectData = {
                            project,
                            code: merge.wiki,
                            registration: { method: merge.method, timestamp: merge.timestamp },
                            edit_count: merge.editcount,
                            block: [ ],
                            blocks: [ ],
                            edits: [ ]
                        };
                        projectsMap.set(project, projectData);
                        data.projects.push(projectData);

                        if (merge.editcount > 0) {
                            editsEnqueue(project, contribsBody);
                            localBlocksEnqueue(project);
                        }
                    }

                    progress.update(0);
                },
                2
            ],
            [ "commons.wikimedia.org", uploadsBody, uploadsHandler, 0 ],
            [ "meta.wikimedia.org", locksBody, locksHandler, 0 ],
            [ "meta.wikimedia.org", globalBlocksBody, globalBlocksHandler, 0 ]
        ]);
    });

    // Learn the caller's rate limit tier first, then fetch every user.
    mwGet("login.wikimedia.org", { action: "query", meta: "globaluserinfo", guiprop: "groups" })
        .then(response => {
            if (cancel.cancelled) return;
            const groups = response.query.globaluserinfo?.groups || [ ];
            scheduler.rateLimit = groups.some(group => [ "local-bot", "steward" ].includes(group)) ? RATE_LIMIT_EXEMPT : RATE_LIMIT_NORMAL;

            return Promise.all(users.map(async user => {
                return parseUser(user, projects).then(result => {
                    reportProgress(user);
                    return result;
                });
            }));
        })
        .then(results => {
            if (cancel.cancelled) return;
            if (finished) return;
            finished = true;

            callback({ status: "done", data: results.filter(Boolean) });
        })
        .catch(error => { fail(error); });

    return { close: () => { cancel.cancelled = true; } };
}

export default GetUserData;

const tokenRequests = new Map();
let nextTokenRequestId = 0;

const requestToken = () => new Promise((resolve, reject) => {
    const id = nextTokenRequestId++;
    tokenRequests.set(id, { resolve, reject });
    postMessage({ type: "token-request", id });
});

self.addEventListener("message", event => {
    const message = event.data;

    if (message.type === "token-response") {
        const request = tokenRequests.get(message.id);
        if (!request) return;
        tokenRequests.delete(message.id);

        if (message.error)
            request.reject(new Error(message.error));
        else
            request.resolve(message.token);
        return;
    }

    if (message.type !== "start") return;

    GetUserData(requestToken, message.users, message.projectRules, result => {
        if (result.status === "error") {
            result.data = {
                message: String(result.data),
                name: result.data?.name || "Error",
                stack: result.data?.stack
            };
        }
        postMessage({ type: "result", result });
    });
});
