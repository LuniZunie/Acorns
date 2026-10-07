import { $, $$ } from "../helpers/query-selector.js";

import { RenderTimecards } from "../pages/timecards.js";
import { RenderCalendar } from "../pages/calendar.js";
import { RenderTimeline } from "../pages/timeline.js";

export function LoadResults(results) {
    self.results = results;

    $("#tabs").style.setProperty("--tab-count", $$("#tabs > .tab-button:not(.hidden)").length);
}
export function ChangeTab(tab, circular = false) {
    const state = window.history.state ?? { };
    if (state.tab !== tab) delete state.data;

    const $tab = $(`#tabs > .tab-button:not(.hidden)[data-tab="${tab}"]`);
    if (!$tab) {
        delete state.tab;
        window.history.replaceState(state, "");

        if (circular) throw new Error("Could not find valid tab target");
        return ChangeTab($("#tabs > .tab-button.active").dataset.tab, true);
    } else state.tab = tab;

    window.history.replaceState(state, "");

    $$("#tabs > .tab-button.active").forEach($t => $t.classList.remove("active"));
    $tab.classList.add("active");
    $("#tabs").style.setProperty("--active-tab", [ ...$$("#tabs > .tab-button:not(.hidden)") ].findIndex($tab => $tab.classList.contains("active")));

    $("#tab-content").innerHTML = "";
    LoadTabContent(tab);
}

function LoadTabContent(tab) {
    switch (tab) {
        case "overview": {

        } break;
        case "timecards": {
            RenderTimecards(self.results);
        } break;
        case "calendar": {
            const state = window.history.state ?? { };
            RenderCalendar(self.results, state.data);
        } break;
        case "timeline": {
            const state = window.history.state ?? { };
            RenderTimeline(self.results, state.data);
        } break;
        default: console.warn(`Tab "${tab}" has no content to load`);
    }
}