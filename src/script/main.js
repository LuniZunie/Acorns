import { $, $$ } from "./helpers/query-selector.js";

import { NormalizeUser } from "./helpers/normalize-user.js";
import { NormalizeProject } from "./helpers/normalize-project.js";
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
$projects.addEventListener("pills-changed", () => {
    $projects.children.forEach($child => {
        const normalized = NormalizeProject($child.value);
        if (!normalized) $child.remove();
        $child.value = normalized;
    });
});
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

const $submit = $("#input-screen-submit");
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
};
const tickProgress = now => {
    const dt = Math.min((now - progressLast) / 1000, 0.1);
    progressLast = now;
    progressShown += (progressTarget - progressShown) * (1 - Math.exp(-PROGRESS_RATE * dt));
    if (progressTarget - progressShown < 0.0005) {
        progressShown = progressTarget;
        if (progressCalback) requestAnimationFrame(progressCalback);
    }
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

new OAuth().then(async function(oauth) {
    await oauth.authenticate();

    $submit.classList.remove("disabled");
    $submit.addEventListener("click", () => {
        const state = window.history.state;
        state.submit = true;
        window.history.replaceState(state, "");

        $users.disable();
        $projects.disable();

        $submit.classList.add("hidden");
        $cancel.classList.remove("hidden");

        setProgress(0, true);

        $progress.classList.remove("success");
        $progress.classList.remove("error");
        $progress.classList.remove("hidden");

        $status.classList.remove("hidden");
        $credits.classList.add("hidden");

        const { close } = GetUserData(() => oauth.access(), $users.values(), $projects.values(), function callback({ status, data }) {
            switch (status) {
                case "progress": {
                    setProgress(data);
                } break;
                case "done": {
                    if (data.length === 0) {
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
                        };
                    }
                } break;
                case "error": {
                    console.error(data);

                    $progress.classList.add("error");
                    progressCalback = () => {
                        $status.textContent = String(data.message);
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
            $cancel.classList.add("hidden");

            $progress.classList.add("hidden");
            $status.classList.add("hidden");
            $credits.classList.remove("hidden");

            $users.enable();
            $projects.enable();
        };
    });

    if (state.submit) $submit.click();
}).catch(error => console.error(error));