import { $, $$ } from "./helpers/query-selector.js";

import { NormalizeUser } from "./helpers/normalize-user.js";
import { SetUserColorSeed } from "./helpers/username-to-color.js";

import { OAuth } from "./core/oauth.js";
import { GetUserData } from "./core/get-user-data.js";
import { LoadResults, ChangeTab } from "./core/content.js";

const url = new URL(window.location.href);
const state = window.history.state ?? { };

if (url.searchParams.has("seed"))
    state.seed = parseInt(url.searchParams.get("seed"), 10);
SetUserColorSeed(state.seed || 0);

const $users = $("#user-pill-input");
$users.addEventListener("pills-changed", () => {
    $users.children.forEach($child => {
        const normalized = NormalizeUser($child.value);
        if (!normalized) $child.remove();
        $child.value = normalized;
    });
});
if (url.searchParams.has("users")) {
    $users.clear();
    url.searchParams.getAll("users").forEach(user => $users.paste(user));
    state.users = $users.values();
} else if (Array.isArray(state.users)) {
    $users.clear();
    state.users.forEach(user => $users.paste(user));
}

const $projects = $("#project-pill-input");
if (url.searchParams.has("projects")) {
    $projects.clear();
    url.searchParams.getAll("projects").forEach(project => $projects.paste(project));
    state.projects = $projects.values();
} else if (Array.isArray(state.projects)) {
    $projects.clear();
    state.projects.forEach(project => $projects.paste(project));
}

if (url.searchParams.has("tab"))
    state.tab = url.searchParams.get("tab");
if (url.searchParams.has("data"))
    state.data = url.searchParams.get("data");
if (url.searchParams.has("submit"))
    state.submit = url.searchParams.get("submit") === "1";

window.history.replaceState(state, "", `${window.location.origin}${window.location.pathname}`);
window.addEventListener("popstate", e => {
    if (e.state?.reload)
        location.reload();
})

const $submit = $("#input-screen-submit");
const $actions = $("#input-screen-actions");
const $retry = $("#input-screen-retry");
const $cancel = $("#input-screen-cancel");

const $progress = $("#input-screen-progress");
const $progressBars = $$("path", $progress);

const layoutProgress = () => {
    const card = $progress.parentElement;
    const { width: cw, height: ch } = card.getBoundingClientRect();
    const w = cw + 6, h = ch + 4;
    const o = 1.5, r = 13.5, cx = w / 2;
    $progress.setAttribute("width", w);
    $progress.setAttribute("height", h);
    const right = `M${cx} ${o}H${w - o - r}A${r} ${r} 0 0 1 ${w - o} ${o + r}V${h - o - r}A${r} ${r} 0 0 1 ${w - o - r} ${h - o}H${cx}`;
    const left = `M${cx} ${o}H${o + r}A${r} ${r} 0 0 0 ${o} ${o + r}V${h - o - r}A${r} ${r} 0 0 0 ${o + r} ${h - o}H${cx}`;
    $progressBars[0].setAttribute("d", right);
    $progressBars[1].setAttribute("d", left);
};
new ResizeObserver(layoutProgress).observe($progress.parentElement);
const $status = $("#input-screen-status");
const $credits = $("#credits");
const $loadingScreen = $("#app-loading-screen");
const $loadingSkeleton = $(".loading-skeleton", $loadingScreen);
const $loadingMessage = $("#app-loading-message");
const $loadingError = $("#app-loading-error");
$("#app-loading-reload").addEventListener("click", () => window.location.reload());

let progressTarget = 0, progressShown = 0, progressFrame = null, progressLast = 0;
let progressCalback = null;
const PROGRESS_RATE = 4;
const renderProgress = () => {
    const dashOffset = 1 - progressShown;
    $progressBars.forEach($bar => {
        $bar.classList.toggle("hidden", dashOffset === 1);
        $bar.style.strokeDashoffset = dashOffset;
    });
    $status.textContent = `${Math.trunc(progressShown * 100)}%`;

    if (progressShown === 1 && progressCalback)
        requestAnimationFrame(() => {
            progressCalback();
            progressCalback = null;
        });
};
const tickProgress = now => {
    const dt = Math.min((now - progressLast) / 1000, 0.1);
    progressLast = now;
    progressShown += (progressTarget - progressShown) * (1 - Math.exp(-PROGRESS_RATE * dt));
    if (progressTarget - progressShown < 0.0005) progressShown = progressTarget;
    renderProgress();
    progressFrame = progressShown === progressTarget ? null : requestAnimationFrame(tickProgress);
};
const setProgress = (value, instant = false) => {
    progressTarget = value;
    if (instant) {
        if (progressFrame !== null) cancelAnimationFrame(progressFrame);
        progressFrame = null;
        progressShown = value;
        renderProgress();
    } else if (progressFrame === null && progressShown !== value) {
        progressLast = performance.now();
        progressFrame = requestAnimationFrame(tickProgress);
    }
};

Promise.all([
    new OAuth().then(async oauth => await oauth.authenticate() && oauth),
    fetch(`${window.location.origin}/sitematrix`).then(res => res.json())
]).then(async function([ oauth, sitematrix ]) {
    {
        const suggestions = [ "*" ];
        const temp = { set: new Set(), map: new Map() };
        for (const [ key, value ] of Object.entries(sitematrix)) {
            temp.set.add(value);
            temp.map.set(key, value);
            suggestions.push(key, value, `!${key}`, `!${value}`);
        }

        sitematrix = temp;
        $projects.suggest(suggestions);
    }

    $projects.addEventListener("pills-changed", () => {
        $projects.children.forEach($child => {
            const normalized = $child.value.toLowerCase();
            if (normalized === "*") $child.value = normalized;
            else {
                const exclude = normalized.startsWith("!");

                let project = exclude ? normalized.slice(1) : normalized;
                if (sitematrix.set.has(project)) project = project;
                else if (sitematrix.map.has(project)) project = sitematrix.map.get(project);
                else return $child.remove();

                $child.value = `${exclude ? "!" : ""}${project}`;
            }
        });
    });

    $submit.classList.remove("disabled");
    $submit.addEventListener("click", () => {
        const state = window.history.state;
        state.submit = true;
        window.history.replaceState(state, "");

        $users.disable();
        $projects.disable();

        $submit.classList.add("hidden");
        $actions.classList.remove("hidden");
        $retry.classList.add("hidden");

        setProgress(0, true);

        $progress.classList.remove("success");
        $progress.classList.remove("error");
        $progress.classList.remove("hidden");

        $status.classList.remove("hidden");
        $credits.classList.add("hidden");

        window.onfocus = () => {
            if (progressTarget === 1) {
                $("#input-screen-wrap").style.transition = "none";
                $("#content").style.transition = "none";
            }
            setProgress(progressTarget, true);
        }

        const { close } = GetUserData(() => oauth.access(), $users.values(), $projects.values(), function callback({ status, data }) {
            switch (status) {
                case "progress": {
                    setProgress(data);
                } break;
                case "done": {
                    if (data.length === 0) {
                        $retry.classList.remove("hidden");
                        $progress.classList.add("error");
                        progressCalback = () => {
                            $status.textContent = "No data returned";
                        };
                    } else {
                        $progress.classList.add("success");
                        progressCalback = () => {
                            LoadResults(data);

                            $$("#tabs > .tab-button.active").forEach($t => $t.classList.remove("active"));
                            if (state.tab) ChangeTab(state.tab);

                            if (!$("#tabs > .tab-button.active"))
                                ChangeTab($("#tabs > .tab-button").dataset.tab);

                            $$("#tabs > .tab-button").forEach($tab => {
                                $tab.addEventListener("click", () => ChangeTab($tab.dataset.tab));
                            });

                            $("#input-screen-wrap").classList.add("hidden");
                            $("#content").classList.remove("hidden");

                            requestAnimationFrame(() => {
                                $("#input-screen-wrap").style.transition = "";
                                $("#content").style.transition = "";
                            });
                        };
                    }

                    setProgress(1);
                } break;
                case "error": {
                    console.error(data);

                    $progress.classList.add("error");
                    progressCalback = () => {
                        $status.textContent = String(data.message);

                        $retry.classList.remove("hidden");
                    };
                    setProgress(1);
                } break;
            }
        });

        $cancel.onclick = () => {
            const state = window.history.state;
            state.submit = false;
            window.history.replaceState(state, "");

            close();

            progressCalback = null;

            $submit.classList.remove("hidden");
            $actions.classList.add("hidden");
            $retry.classList.add("hidden");

            $progress.classList.add("hidden");
            $status.classList.add("hidden");
            $credits.classList.remove("hidden");

            $users.enable();
            $projects.enable();
        };

        $retry.onclick = () => {
            $cancel.click();
            $submit.click();
        };
    });

    $loadingScreen.classList.add("hidden");
    if (state.submit) $submit.click();
}).catch(error => {
    console.error("Failed to initialize Acorns.", error);
    $loadingSkeleton.hidden = true;
    $loadingMessage.hidden = true;
    $loadingError.hidden = false;
});