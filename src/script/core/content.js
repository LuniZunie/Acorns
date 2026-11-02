import { $, $$, $Text } from "../helpers/DOM.js";

import { ReleaseResults } from "../helpers/object-url-store.js";
import { ClearPreloads, Release } from "../helpers/preload.js";
import { CreateTabSkeleton } from "../helpers/skeleton.js";

import { RenderTimecards, PreloadTimecards } from "../pages/timecards.js";
import { RenderCalendar, PreloadCalendar } from "../pages/calendar.js";
import { RenderTimeline, PreloadTimeline } from "../pages/timeline.js";
import { RenderLinks, PreloadLinks } from "../pages/links.js";

const preloaders = {
    timecards: PreloadTimecards,
    calendar: PreloadCalendar,
    timeline: PreloadTimeline,
    links: PreloadLinks
};

export const PreloadTab = (function(tab) {
    if (!self.results || $("#tabs > .tab-button.active")?.dataset.tab === tab) return;
    preloaders[tab]?.(self.results).catch(error => console.warn(`Failed to preload tab "${tab}"`, error));
});
export const CancelPreload = (function(tab) { Release(tab); });

// Hovering (or focusing) a tab usually means it is about to be opened, so warm its data after a short intent delay.
const HOVER_INTENT_DELAY = 100;
{
    const $tabs = $("#tabs");
    const tabOf = ($el) => $el instanceof Element ? $el.closest(".tab-button")?.dataset.tab : undefined;

    let intentTimer;
    const start = (tab, delay) => {
        clearTimeout(intentTimer);
        if (!tab) return;
        if (delay) intentTimer = setTimeout(() => PreloadTab(tab), delay);
        else PreloadTab(tab);
    };
    const stop = (tab, e) => {
        if (!tab || tabOf(e.relatedTarget) === tab) return;
        clearTimeout(intentTimer);
        CancelPreload(tab);
    };

    $tabs.addEventListener("pointerover", e => e.pointerType === "touch" ? 0 : start(tabOf(e.target), HOVER_INTENT_DELAY));
    $tabs.addEventListener("pointerout", e => stop(tabOf(e.target), e));
    $tabs.addEventListener("pointerdown", e => start(tabOf(e.target), 0));
    $tabs.addEventListener("focusin", e => start(tabOf(e.target), HOVER_INTENT_DELAY));
    $tabs.addEventListener("focusout", e => stop(tabOf(e.target), e));
}

let loadId = 0;
const LoadTabContent = (function(tab) {
    const id = ++loadId;
    const $content = $("#tab-content");
    $content.scrollTop = 0;

    const content = (state => {
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
    })(history.state ?? { });

    // Pages read edits back from object URLs, so they render asynchronously.
    if (content instanceof Promise) {
        const $skeleton = CreateTabSkeleton(tab, { accounts: self.results?.length, state: history.state?.data });
        if ($skeleton) $content.replaceChildren($skeleton);
        content.then(
            $page => { if (id === loadId) $content.replaceChildren($page ?? $Text("")); },
            error => {
                console.error(`Failed to render tab "${tab}"`, error);
                if (id === loadId) $content.replaceChildren($Text("Internal error"));
            }
        );
    } else $content.replaceChildren(content ?? $Text(""));
});

export const LoadResults = (function(results) {
    ClearPreloads();
    ReleaseResults(self.results);
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