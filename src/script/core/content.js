import { $, $$ } from "../helpers/query-selector.js";

window.addEventListener("popstate", event => {
    if (event.state?.action === "change-tab")
        ChangeTab(event.state.tab, false);
});

export function LoadResults(results) { self.results = results; }
export function ChangeTab(tab, pushState = true) {
    const $tab = $(`#tabs > .tab-button[data-tab="${tab}"]`);
    if (!$tab) throw new Error(`Tab "${tab}" not found`);

    $$("#tabs > .tab-button.active").forEach($t => $t.classList.remove("active"));
    $tab.classList.add("active");

    if (pushState) {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab);
        history.pushState({ action: "change-tab", tab }, "", url);
    }

    $("#tab-content").innerHTML = "";
    LoadTabContent(tab);
}

function LoadTabContent(tab) {
    switch (tab) {
        case "overview": {

        } break;
        case "timecards": {
            for (const user of self.results) {
                const timecard = Array.from({ length: 7 }, _ => Array.from({ length: 24 }, _ => 0n));
                for (const project of user.projects)
                    for (const edit of project.edits) {
                        const timestamp = new Date(edit.timestamp);
                        timecard[timestamp.getUTCDay()][timestamp.getUTCHours()]++;
                    }

                console.log(timecard);
            }
        } break;
        default: console.warn(`Tab "${tab}" has no content to load`);
    }
}