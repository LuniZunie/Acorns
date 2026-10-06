import { addArrayToArray } from "./helpers/add-array-to-array.js";
import { batchArray } from "./helpers/batch-array.js";
import { Time } from "./helpers/time.js";

const RATE_LIMIT_NORMAL = Time.minutes(1) / (2000 * .95);
const RATE_LIMIT_EXEMPT = 1;
const EDIT_BATCH = 50;
const MAX_USER_CONTRIBUTIONS_PER_REQUEST = 500;

const rCAT = /(?<=\[\[Category:)([^\]|]+)/gi;
const rIMG = /((?<=\[\[:?(File|Image|Media):)([^\]|]+)|(=[^\n\[\]{}\\/<>#|]+?\.(?:tiff?|png|gif|jpe?g|webp|xcf|pdf|midi?|og[gva]|svg|djvu|flac|opus|wav|webm|mp3|mpe?g)))/gi;
const rLINK = /(?:https?:|(?<=[\[\s=|]))\/\/[^\s\[\]<>"|{}]+/gi;

const parseWikitext = wikitext => {
    if (typeof wikitext !== "string")
        return { c: [ ], i: [ ], l: [ ], d: true };
    return {
        c: (wikitext.match(rCAT) || [ ]).map(match => match.trim().replaceAll("_", " ")),
        i: (wikitext.match(rIMG) || [ ]).map(match => match.replace(/^=/, "").trim().replaceAll("_", " ")),
        l: (wikitext.match(rLINK) || [ ]).map(match => match.trim().replaceAll("_", " ")),
        d: true
    };
};

const normalizeUser = user => {
    const temp = user.trim().replaceAll("_", " ").split(":").pop().trim();
    return `${temp.charAt(0).toUpperCase()}${temp.slice(1)}`;
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
        this.queue.push(...items);
        if (!this.running) this.run();
    },

    async run() {
        this.running = true;
        try {
            while (true) {
                while (this.queue.length > 0) {
                    // highest priority first; first-queued wins ties
                    let best = 0;
                    for (let i = 1; i < this.queue.length; i++)
                        if (this.queue[i].priority > this.queue[best].priority) best = i;
                    const [ item ] = this.queue.splice(best, 1);

                    if (item.cancelled()) { item.settle(); continue; }

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
            "Api-User-Agent": "Acorns/1.0 (https://github.com/LuniZunie/Acorns)",
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

export default function(getToken, users, projectRules, callback = () => { }) {
    if (typeof getToken !== "function")
        throw new Error("(get-user-data) Token getter must be a function");
    if (!Array.isArray(users))
        throw new Error("(get-user-data) Usernames must be an array");
    if (!Array.isArray(projectRules))
        throw new Error("(get-user-data) Project rules must be an array");
    if (typeof callback !== "function")
        throw new Error("(get-user-data) Invalid callback");

    users = Array.from(new Set(users.filter(user => user && typeof user === "string").map(normalizeUser).filter(Boolean)));

    const projects = { all: false, include: new Set(), exclude: new Set() };
    for (const rule of projectRules) {
        if (rule === "*") {
            projects.all = true;
            projects.include.clear();
            projects.exclude.clear();
        } else if (rule.startsWith("-")) {
            if (projects.all)
                projects.exclude.add(rule.slice(1));
            else
                projects.include.delete(rule.slice(1));
        } else {
            if (projects.all)
                projects.exclude.delete(rule);
            else
                projects.include.add(rule);
        }
    }

    if (users.length === 0 || (!projects.all && projects.include.size === 0)) {
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
            if (!progressMap.has(user)) return;
            const temp = progressMap.get(user);
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

        const data = { missing: true, user, groups: [ ], rights: [ ], blocks: [ ], uploads: [ ] };
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
            for (const projectData of projectsMap.values())
                for (const edit of projectData.edits)
                    if (edit.A) buildEdit(edit); // revisions the API never returned count as empty

            if (progress.done < progress.total) {
                progress.done = progress.total;
                progress.update(0);
            }

            if (data.missing) return resolve(null);
            delete data.missing;
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
            addArrayToArray(data.uploads, (response.query.logevents || [ ]).map(le => ({
                logid: le.logid,
                title: le.title,
                timestamp: le.timestamp,
                comment: le.comment || "",
                tags: le.tags || [ ]
            })));
            if (response.continue)
                enqueue([ [ "commons.wikimedia.org", { ...uploadsBody, ...response.continue }, uploadsHandler, 0 ] ]);
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
                        edit[target] = parseWikitext(revisionContent(rev));
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

            for (const batch of batchArray(edits, EDIT_BATCH)) {
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
                            addArrayToArray(projectsMap.get(project).blocks, response.query.blocks.map(({ user: _, ...block }) =>
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
                    if (globalUserInfo.missing === true) return;

                    const globalUser = response.query.globalusers[0];
                    data.projects = [ ];

                    data.registration = { project: globalUserInfo.home, timestamp: globalUserInfo.registration };
                    data.edit_count = globalUser.editcount;
                    data.groups = globalUser.groups || [ ];
                    data.rights = globalUser.rights || [ ];
                    data.locked = globalUser.locked;
                    data.blocks = (response.query.globalblocks || [ ]).map(({ target: _, ...block }) =>
                        ({ ...block, reason: block.reason || "" })
                    );
                    data.missing = false;

                    for (const merge of globalUserInfo.merged ?? [ ]) {
                        const project = new URL(merge.url).hostname;
                        if (projects.exclude.has(project) || !(projects.all || projects.include.has(project))) continue;

                        const projectData = {
                            project,
                            code: merge.wiki,
                            registration: { method: merge.method, timestamp: merge.timestamp },
                            edit_count: merge.editcount,
                            blocks: [ ],
                            edits: [ ]
                        };
                        projectsMap.set(project, projectData);
                        data.projects.push(projectData);

                        if (merge.editcount > 0) {
                            progress.total += Math.ceil(merge.editcount / MAX_USER_CONTRIBUTIONS_PER_REQUEST); // contributions requests
                            progress.total += Math.ceil(merge.editcount / EDIT_BATCH) * 2; // revision content requests (edits and their parents)

                            editsEnqueue(project, contribsBody);
                        }
                    }

                    progress.update(0);
                },
                2
            ],
            [ "commons.wikimedia.org", uploadsBody, uploadsHandler, 0 ]
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
            if (!results || finished) return;
            finished = true;

            callback({ status: "done", data: results.filter(Boolean) });
        })
        .catch(fail);

    return { close: () => { cancel.cancelled = true; } };
}
