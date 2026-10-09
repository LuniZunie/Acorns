import { SITE_MATRIX } from "../data/sitematrix.js";

import { $, $$, $Text, $Create } from "../helpers/DOM.js";

import { Text } from "../helpers/text.js";

import { PickColorSeed, SeededColor } from "../helpers/color-seed.js";
import { GetOrigin, GetPageURL, GetContributionsURL, GetGlobalContributionsURL, GetDiffURL } from "../helpers/wiki-urls.js";

const DRAG_THRESHOLD = 5;

const LINK_MODE_DOMAIN = "domain";
const LINK_MODE_FULL = "full";

const LINK_MODES = [
    [ LINK_MODE_DOMAIN, "Domains" ],
    [ LINK_MODE_FULL, "Full links" ]
];

const BLACKLIST_LINK = (function(url) {
    if (url === null) return true;
    if (!url.protocol.startsWith("http")) return true;

    const parts = url.hostname.toLowerCase().split(".");
    const first = parts.at(-1);
    if ((first === "org" || first === "com") && this.mediawikiSecondLevels?.has(parts.at(-2))) return true;
    return false;
});

const NumberFormatter = new Intl.NumberFormat();
const DateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const TimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" });

const expanded = { [LINK_MODE_DOMAIN]: new Set(), [LINK_MODE_FULL]: new Set() };
const hiddenAccounts = new Set();

const FormatTimestamp = (function(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return `${DateFormatter.format(date)}, ${TimeFormatter.format(date)} UTC`;
});

const GetURL = (function(link) { try { return typeof link === "string" ? new URL(link) : null; } catch { return null; } });
const GetAddedLinks = (function*(result) {
    const MEDIAWIKI_SECOND_LEVELS = new Set(SITE_MATRIX.map.keys().map(url => url.split(".").at(-2).toLowerCase()).filter(Boolean));
    MEDIAWIKI_SECOND_LEVELS.add("toolforge").add("wmcloud").add("wmflabs");
    const IsBlacklistedLink = BLACKLIST_LINK.bind({ mediawikiSecondLevels: MEDIAWIKI_SECOND_LEVELS });
    for (const project of result.projects || [ ])
        for (const edit of project.edits || [ ]) {
            const added = edit.links?.["+"];
            if (!Array.isArray(added)) continue;

            for (const link of added) {
                const url = GetURL(link);
                if (IsBlacklistedLink(url)) continue;
                yield { link, host: url.hostname.toLowerCase().replace(/^www\./, ""), edit, project: project.project, target: url.toString() };
            }
        }
});

const RenderMain = (function($content, data, mode) {
    const groups = new Map();
    for (const user of data)
        if (!hiddenAccounts.has(user.name))
            for (const { link, target, host, edit, project } of GetAddedLinks(user)) {
                const label = mode === LINK_MODE_FULL ? target : host;
                if (!groups.has(label))
                    groups.set(label, { label, host, additions: 0, accounts: new Set(), pages: new Set(), edits: [ ] });

                const group = groups.get(label);
                group.additions++;
                if (user.name) group.accounts.add(user.name);
                if (edit.title) group.pages.add(edit.title);
                group.edits.push({ ...edit, name: user.name, project, host, link, date: new Date(edit.timestamp).valueOf() });
            }

    const links = Array.from(groups.values()).sort((a, b) =>
        b.accounts.size - a.accounts.size ||
        b.pages.size - a.pages.size ||
        b.additions - a.additions ||
        a.label.localeCompare(b.label)
    );

    for (const link of links)
        link.edits.sort((a, b) => a.date - b.date);

    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const linkGap = 0.7 * rem;
    const linkHeaderHeight = 3.25 * rem;
    const editRowHeight = 3.25 * rem;
    const measuredHeights = new Map();
    const offsets = [ ];
    let totalHeight = 0;

    const GetLinkHeight = (function(index) {
        return measuredHeights.get(index) ?? linkHeaderHeight + (
            expanded[mode].has(links[index].label)
                ? 1 + links[index].edits.length * editRowHeight
                : 0
        );
    });

    const UpdateOffsets = (function() {
        offsets.length = links.length;
        totalHeight = 0;
        for (let i = 0; i < links.length; i++) {
            offsets[i] = totalHeight;
            totalHeight += GetLinkHeight(i) + linkGap;
        }
    });

    const FindLinkIndex = (function(offset) {
        let low = 0, high = links.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (offsets[middle] + GetLinkHeight(middle) + linkGap <= offset) low = middle + 1;
            else high = middle;
        }
        return low;
    });

    let $list, renderedStart = -1, renderedEnd = -1;
    const BuildEditRow = (function(edit, index) {
        return $Create(
            "article",
            {
                className: `links-edit-row ${index % 2 ? "even" : ""}`,
                dataset: {
                    username: edit.name
                },
                style: {
                    "--user-color": SeededColor(edit.name)
                }
            },
            [
                $Create(
                    "div",
                    {
                        className: "links-edit-meta"
                    },
                    [
                        $Create(
                            ...(edit.revid !== undefined
                                ? [
                                    "a",
                                    {
                                        className: "links-edit-timestamp",
                                        href: GetDiffURL(edit.project, edit.revid, edit.parentid),
                                        target: "_blank",
                                        rel: "noopener noreferrer",
                                        title: "View edit"
                                    }
                                ]
                                : [ "span", { className: "links-edit-timestamp" } ]
                            ),
                            [
                                $Create("time", { dateTime: edit.timestamp || undefined }, FormatTimestamp(edit.timestamp))
                            ]
                        ),
                        $Create(
                            "a",
                            {
                                className: "links-edit-account",
                                href: GetContributionsURL(edit.project, edit.name),
                                target: "_blank",
                                rel: "noopener noreferrer",
                                title: "Open user contributions"
                            },
                            edit.name
                        )
                    ]
                ),
                $Create(
                    "div",
                    {
                        className: "links-edit-page",
                    },
                    [
                        $Create(
                            "a",
                            {
                                className: "links-edit-project",
                                href: GetOrigin(edit.project),
                                target: "_blank",
                                rel: "noopener noreferrer",
                                title: "Open project"
                            },
                            edit.project
                        ),
                        $Create("span", { className: "links-edit-separator", "aria-hidden": "true" }),
                        $Create(
                            "a",
                            {
                                className: "links-edit-title",
                                href: GetPageURL(edit.project, edit.title),
                                target: "_blank",
                                rel: "noopener noreferrer",
                                title: "Open page"
                            },
                            edit.title
                        )
                    ]
                )
            ]
        );
    });

    const UpdateEditRows = (function($editList, link) {
        if (!expanded[mode].has(link.label)) return;

        const listTop = $editList.getBoundingClientRect().top - $content.getBoundingClientRect().top + $content.scrollTop;
        const overscan = Math.max(editRowHeight * 8, $content.clientHeight / 2);
        const first = Math.max(0, Math.floor(($content.scrollTop - listTop - overscan) / editRowHeight));
        const last = Math.min(
            link.edits.length - 1,
            Math.ceil(($content.scrollTop + $content.clientHeight - listTop + overscan) / editRowHeight)
        );
        const start = Math.min(first, link.edits.length);
        const end = Math.max(start, last + 1);
        if ($editList.dataset.start === String(start) && $editList.dataset.end === String(end)) return;

        $editList.dataset.start = start;
        $editList.dataset.end = end;
        const $$children = [ ];
        if (start > 0)
            $$children.push($Create("div", {
                className: "links-edit-spacer",
                style: { height: `${start * editRowHeight}px` },
                "aria-hidden": "true"
            }));
        for (let i = start; i < end; i++)
            $$children.push(BuildEditRow(link.edits[i], i));
        if (end < link.edits.length)
            $$children.push($Create("div", {
                className: "links-edit-spacer",
                style: { height: `${(link.edits.length - end) * editRowHeight}px` },
                "aria-hidden": "true"
            }));
        $editList.replaceChildren(...$$children);
    });

    const BuildLinkItem = (function(link, index) {
        const drag = { dragging: false, x: 0, y: 0 };
        const isExpanded = expanded[mode].has(link.label);
        return $Create(
            "article",
            {
                className: "link-item",
                role: "listitem",
                dataset: { index },
                "aria-posinset": index + 1,
                "aria-setsize": links.length
            },
            [
                $Create(
                    "div",
                    {
                        className: `link-item-header ${isExpanded ? "expanded" : ""}`,
                        "aria-expanded": String(isExpanded)
                    },
                    [
                        $Create(
                            "button",
                            {
                                className: "link-button",
                                type: "button",
                            },
                            [
                                $Create("span", { className: "link-chevron" }, "▾"),
                                $Create("span", { className: "link-label" }, link.label)
                            ]
                        ),
                        $Create(
                            "div",
                            {
                                className: "link-breakdown"
                            },
                            [
                                $Create("span", { className: "link-stat" }, Text.label("account", link.accounts.size, null, NumberFormatter)),
                                $Create("span", { className: "link-stat" }, Text.label("page", link.pages.size, null, NumberFormatter)),
                                $Create("span", { className: "link-stat" }, Text.label("addition", link.additions, null, NumberFormatter))
                            ]
                        )
                    ],
                    [
                        [ "mousedown", ($self, e) => {
                            drag.dragging = false;
                            drag.x = e.clientX;
                            drag.y = e.clientY;
                            if (e.detail > 1) e.preventDefault();
                        } ],
                        [ "mousemove", ($self, e) => {
                            if (!drag.dragging && Math.hypot(drag.x - e.clientX, drag.y - e.clientY) >= DRAG_THRESHOLD)
                                drag.dragging = true;
                        } ],
                        [ "click", ($self, e) => {
                            if (drag.dragging) return;

                            const expand = $self.getAttribute("aria-expanded") !== "true";
                            if (expand) expanded[mode].add(link.label);
                            else expanded[mode].delete(link.label);
                            measuredHeights.delete(index);
                            UpdateOffsets();
                            RenderVisibleLinks(true);
                        } ]
                    ]
                ),
                $Create(
                    "div",
                    {
                        className: `links-edit-list ${isExpanded ? "" : "hidden"}`,
                        dataset: { index }
                    }
                )
            ]
        );
    });

    const UpdateVisibleEditRows = (function() {
        for (const $item of $$(":scope > .link-item", $list)) {
            const index = Number($item.dataset.index);
            const $editList = $(":scope > .links-edit-list", $item);
            if (!$editList.classList.contains("hidden"))
                UpdateEditRows($editList, links[index]);
        }
    });

    const RenderVisibleLinks = (function(force = false) {
        if (!$list?.isConnected) return;

        const mainTop = $list.getBoundingClientRect().top - $content.getBoundingClientRect().top + $content.scrollTop;
        const viewportStart = Math.max(0, $content.scrollTop - mainTop);
        const overscan = Math.max(editRowHeight * 8, $content.clientHeight / 2);
        const start = links.length ? FindLinkIndex(Math.max(0, viewportStart - overscan)) : 0;
        const end = links.length
            ? Math.min(links.length - 1, FindLinkIndex(viewportStart + $content.clientHeight + overscan) + 1)
            : -1;

        if (force || start !== renderedStart || end !== renderedEnd) {
            renderedStart = start;
            renderedEnd = end;
            const $$children = [ ];
            if (start > 0)
                $$children.push($Create("div", {
                    className: "links-virtual-spacer",
                    style: { height: `${offsets[start]}px` },
                    "aria-hidden": "true"
                }));
            for (let i = start; i <= end; i++)
                $$children.push(BuildLinkItem(links[i], i));
            if (end < links.length - 1)
                $$children.push($Create("div", {
                    className: "links-virtual-spacer",
                    style: { height: `${Math.max(0, totalHeight - offsets[end + 1])}px` },
                    "aria-hidden": "true"
                }));
            $list.replaceChildren(...$$children);
        }

        UpdateVisibleEditRows();

        let heightsChanged = false;
        for (const $item of $$(":scope > .link-item", $list)) {
            const index = Number($item.dataset.index);
            const height = $item.getBoundingClientRect().height;
            if (Math.abs((measuredHeights.get(index) ?? 0) - height) > 1) {
                measuredHeights.set(index, height);
                heightsChanged = true;
            }
        }
        if (heightsChanged) {
            UpdateOffsets();
            const spacer = $(":scope > .links-virtual-spacer", $list);
            if (spacer && start > 0) spacer.style.height = `${offsets[start]}px`;
            const $bottomSpacer = $(":scope > .links-virtual-spacer:last-child", $list);
            if ($bottomSpacer && end < links.length - 1)
                $bottomSpacer.style.height = `${Math.max(0, totalHeight - offsets[end + 1])}px`;
        }
    });

    UpdateOffsets();
    return $Create(
        "div",
        {
            className: "links-main"
        },
        links.length === 0
            ? [ $Create("p", { className: "links-empty" }, "No external links were found in the returned edits.") ]
            : [ $Create("list", { className: "links-list", role: "list" }, "", undefined, $el => {
                $list = $el;
                RenderVisibleLinks(true);

                const $page = $el.closest(".links-page");
                let scrollFrame;
                const controller = new AbortController();
                const observer = new MutationObserver(() => {
                    if ($el.isConnected) return;
                    controller.abort();
                    if (scrollFrame) cancelAnimationFrame(scrollFrame);
                    observer.disconnect();
                });
                observer.observe($page, { childList: true });
                observer.observe($content, { childList: true });

                $content.addEventListener("scroll", () => {
                    if (scrollFrame) return;
                    scrollFrame = requestAnimationFrame(() => {
                        scrollFrame = undefined;
                        RenderVisibleLinks();
                    });
                }, { passive: true, signal: controller.signal });
                window.addEventListener("resize", () => {
                    UpdateOffsets();
                    RenderVisibleLinks(true);
                }, { passive: true, signal: controller.signal });
            }) ]
    )
});

export const RenderLinks = (function($content, data, requestedMode = self.rememberedMode) {
    let mode = LINK_MODES.find(([ value ]) => value === requestedMode)?.[0] || LINK_MODES[0][0];

    const state = history.state ?? { };
    self.rememberedMode = state.data = mode;
    history.replaceState(state, "");

    const users = data.map(user => ({ name: user.name, home: user.home, color: SeededColor(user.name), visible: !hiddenAccounts.has(user.name) }));
    const RefreshColors = () => {
        PickColorSeed(users.map(user => user.name));
        for (const user of users) user.color = SeededColor(user.name);
        for (const $element of $$("#tab-content *[data-username]", $content))
            $element.style.setProperty("--user-color", SeededColor($element.dataset.username));
    };

    return $Create(
        "section",
        {
            className: "links-page",
            tabIndex: 0,
            "aria-label": "External links added by accounts"
        },
        [
            $Create(
                "aside",
                {
                    className: "legend",
                    "aria-label": "Filter accounts"
                },
                [
                    $Create("h2", { className: "legend-title" }, "Accounts"),
                    $Create(
                        "ul",
                        {
                            className: "legend-list"
                        },
                        users.map(user => $Create(
                            "li",
                            {
                                className: "legend-item"
                            },
                            [
                                $Create(
                                    "button",
                                    {
                                        className: `legend-swatch ${user.visible ? "" : "hidden"}`,
                                        type: "button",
                                        title: `${user.visible ? "Hide" : "Show"} ${user.name}`,
                                        "aria-pressed": String(user.visible),
                                        "aria-label": `${user.visible ? "Hide" : "Show"} ${user.name}`,
                                        dataset: {
                                            username: user.name
                                        },
                                        style: {
                                            "--user-color": user.color
                                        },
                                    },
                                    "",
                                    [
                                        [ "click", ($self, e) => {
                                            $self.classList.toggle("hidden", user.visible);
                                            $self.setAttribute("aria-pressed", String(user.visible = !user.visible));
                                            $self.setAttribute("aria-label", $self.title = `${user.visible ? "Hide" : "Show"} ${user.name}`);

                                            if (user.visible) hiddenAccounts.delete(user.name);
                                            else hiddenAccounts.add(user.name);

                                            $(":scope > .links-page > .links-main", $content).replaceWith(RenderMain($content, data, mode));
                                        } ]
                                    ]
                                ),
                                $Create(
                                    "a",
                                    {
                                        className: "legend-username",
                                        href: user.home ? GetContributionsURL(user.home, user.name) : GetGlobalContributionsURL(user.name),
                                        target: "_blank",
                                        rel: "noopener noreferrer",
                                        title: user.home
                                            ? `Open ${user.name}'s home contributions`
                                            : `Open ${user.name}'s global contributions`
                                    },
                                    user.name
                                )
                            ]
                        ))
                    ),
                    $Create(
                        "button",
                        {
                            className: "refresh-colors",
                            type: "button",
                            "aria-label": "New colors",
                        },
                        [
                            $Create("span", { className: "refresh-icon", "aria-hidden": "true" }, "\u21bb"),
                            $Text("New colors")
                        ],
                        [
                            [ "click", ($self, e) => {
                                const $icon = $(":scope > .refresh-icon", $self);
                                $icon.classList.remove("rotating");
                                void($icon.offsetWidth);
                                $icon.classList.add("rotating");

                                RefreshColors();
                            } ]
                        ]
                    )
                ]
            ),
            RenderMain($content, data, mode),
            $Create(
                "div",
                {
                    className: "links-controls",
                    dataset: {
                        mode: mode
                    },
                    style: {
                        "--mode": String(LINK_MODES.findIndex(([ value ]) => value === mode))
                    }
                },
                LINK_MODES.map(([ value, label ]) => $Create(
                    "button",
                    {
                        className: `links-mode-button ${value === mode ? "active" : ""}`,
                        type: "button",
                        "aria-pressed": String(value === mode),
                        dataset: {
                            mode: value
                        }
                    },
                    label,
                    [
                        [ "click", ($self, e) => {
                            const $parent = $self.parentElement;
                            if (value === $parent.dataset.mode) return;
                            mode = value;

                            const state = history.state ?? { };
                            self.rememberedMode = state.data = mode;
                            history.replaceState(state, "");

                            $parent.dataset.mode = value;
                            $parent.style.setProperty("--mode", String(LINK_MODES.findIndex(([ value ]) => value === mode)));
                            $$(":scope > .links-mode-button.active", $parent).forEach($button => {
                                $button.classList.remove("active");
                                $button.setAttribute("aria-pressed", "false");
                            });

                            $self.classList.add("active");
                            $self.setAttribute("aria-pressed", "true");

                            $(":scope > .links-page > .links-main", $content).replaceWith(RenderMain($content, data, mode));
                        } ]
                    ]
                ))
            )
        ]
    );
});