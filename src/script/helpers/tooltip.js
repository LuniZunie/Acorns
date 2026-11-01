import { $Create } from "./DOM.js";

const GAP = 8;
const MARGIN = 8;
const FADE_MS = 150;

let $tooltip = null, $anchor = null, watcher = null, removeTimer = null;
const Hide = (function() {
    if (watcher) cancelAnimationFrame(watcher);
    watcher = null, $anchor = null;

    if (!$tooltip) return;
    $tooltip.classList.remove("visible");

    const $old = $tooltip;
    clearTimeout(removeTimer);
    removeTimer = setTimeout(() => {
        $old.remove();
        if ($tooltip === $old) $tooltip = null;
    }, FADE_MS);
});

const Watch = (function() {
    if (watcher) cancelAnimationFrame(watcher);
    watcher = requestAnimationFrame(() => {
        watcher = null;
        if (!$anchor) return;
        if ($anchor.isConnected) Watch();
        else Hide();
    });
});

export const ShowTooltip = (function($thisAnchor, point, title, rows) {
    $anchor = $thisAnchor;
    clearTimeout(removeTimer);

    const created = !$tooltip;
    if (created) {
        $tooltip = $Create("div", { className: "hover-tooltip", role: "tooltip" });
        document.body.append($tooltip);
    }

    $tooltip.replaceChildren(
        ...[
            title ? $Create("div", { className: "hover-tooltip-title" }, title) : null,
            ...rows.map(row => $Create("div", { className: "hover-tooltip-row" }, [
                row.color ? $Create("span", { className: "hover-tooltip-swatch", style: { background: row.color } }) : null,
                $Create("span", { }, row.text)
            ]))
        ].filter(Boolean)
    );

    const { width, height } = $tooltip.getBoundingClientRect();
    const above = point.y - GAP - height >= MARGIN;
    const left = Math.min(Math.max(MARGIN, point.x - width / 2), document.documentElement.clientWidth - width - MARGIN);

    $tooltip.style.left = `${left}px`;
    $tooltip.style.top = `${above ? point.y - GAP - height : point.y + GAP}px`;

    if (created) void($tooltip.offsetWidth); // commit the hidden state so the fade-in transitions
    $tooltip.classList.add("visible");
    Watch();
});

export const HideTooltip = Hide;

export const AddHoverTooltip = (function($el, getContent) {
    const show = (() => {
        const rect = $el.getBoundingClientRect();
        const { title, rows } = getContent();
        ShowTooltip($el, { x: rect.left + rect.width / 2, y: rect.top }, title, rows);
    });
    const hide = (() => { if ($anchor === $el) Hide(); });

    $el.addEventListener("mouseenter", show);
    $el.addEventListener("focus", show);
    $el.addEventListener("mouseleave", hide);
    $el.addEventListener("blur", hide);
});
