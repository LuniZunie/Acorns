import { $, $$ } from "./helpers/query-selector.js";

import { normalizeUser } from "./helpers/normalize-user.js";
import { normalizeProject } from "./helpers/normalize-project.js";

import { OAuth } from "./core/oauth.js";

import getUserData from "./get-user-data.js";

const $users = $("#user-pill-input");
$users.addEventListener("pills-changed", () => {
    $users.children.forEach($child => {
        const normalized = normalizeUser($child.value);
        if (!normalized) $child.remove();
        $child.value = normalized;
    });
});

const $project = $("#project-pill-input");
$project.addEventListener("pills-changed", () => {
    $project.children.forEach($child => {
        const normalized = normalizeProject($child.value);
        if (!normalized) $child.remove();
        $child.value = normalized;
    });
});

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
        $users.disable();
        $project.disable();

        $submit.classList.add("hidden");
        $cancel.classList.remove("hidden");

        setProgress(0, true);

        $progress.classList.remove("success");
        $progress.classList.remove("error");
        $progress.classList.remove("hidden");

        $status.classList.remove("hidden");
        $credits.classList.add("hidden");

        const { close } = getUserData(() => oauth.access(), $users.values(), $project.values(), function callback({ status, data }) {
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
                            $status.textContent = "Data loaded successfully";
                            console.log(data);
                        };
                    }
                } break;
                case "error": {
                    console.error(data);

                    $progress.classList.add("error");
                    $status.textContent = data;
                } break;
            }
        });

        $cancel.onclick = () => {
            close();

            progressCalback = null;

            $submit.classList.remove("hidden");
            $cancel.classList.add("hidden");

            $progress.classList.add("hidden");
            $status.classList.add("hidden");
            $credits.classList.remove("hidden");

            $users.enable();
            $project.enable();
        };
    });
}).catch(error => console.error(error));