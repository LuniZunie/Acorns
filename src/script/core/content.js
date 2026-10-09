import { $, $$, $Text } from "../helpers/DOM.js";

import { RenderTimecards } from "../pages/timecards.js";
import { RenderCalendar } from "../pages/calendar.js";
import { RenderTimeline } from "../pages/timeline.js";
import { RenderLinks } from "../pages/links.js";

const LoadTabContent = (function(tab) {
    const $content = $("#tab-content");
    $content.scrollTop = 0;
    $content.replaceChildren((state => {
        switch (tab) {
            case "overview": {

            } break;
            case "timecards": {
                return RenderTimecards($content, self.results);
            } break;
            case "calendar": {
                return RenderCalendar($content, self.results, state.data);
            } break;
            case "timeline": {
                return RenderTimeline($content, self.results, state.data);
            } break;
            case "links": {
                return RenderLinks($content, self.results, state.data);
            } break;
            default: {
                console.error(`Tab "${tab}" has no content to load`);
                return $Text("Internal error");
            } break;
        }
    })(history.state ?? { }) ?? $Text(""));
});

export const LoadResults = (function(results) {
    self.results = results;

    $("#tabs").style.setProperty("--tab-count", $$("#tabs > .tab-button:not(.hidden)").length);
});
export const ChangeTab = (function(tab, instant = false, circular = false) {
    const state = history.state ?? { };
    if (state.tab !== tab && !String(state.data ?? "").startsWith("links:")) delete state.data;

    const $tab = $(`#tabs > .tab-button:not(.hidden)[data-tab="${tab}"]`);
    if (!$tab) {
        delete state.tab;
        history.replaceState(state, "");

        if (circular) throw new Error("Could not find valid tab target");
        return ChangeTab($("#tabs > .tab-button.active").dataset.tab, instant, true);
    } else state.tab = tab;

    history.replaceState(state, "");

    $$("#tabs > .tab-button.active").forEach($tab => $tab.classList.remove("active"));
    $tab.classList.add("active");

    const $tabs = $("#tabs");
    if (instant) $tabs.style.setProperty("--speed", 0);
    $tabs.style.setProperty("--active-tab", [ ...$$("#tabs > .tab-button:not(.hidden)") ].findIndex($tab => $tab.classList.contains("active")));
    if (instant) {
        void($tabs.offsetHeight);
        $tabs.style.removeProperty("--speed", 0);
    }

    LoadTabContent(tab);
});