import { $, $$, $Text, $Create } from "../helpers/DOM.js";

import { Text } from "../helpers/text.js";
import { Time } from "../helpers/time.js";

import { PickColorSeed, SeededColor } from "../helpers/color-seed.js";
import { GetOrigin, GetPageURL, GetContributionsURL, GetGlobalContributionsURL, GetDiffURL, GetLogURL } from "../helpers/wiki-urls.js";

const LONG_GAP = Time.minutes(30);
const SCROLL_SETTLE_DELAY = 140;
const SCROLL_ANCHOR_OFFSET = 24;

const DAY_HEADER_HEIGHT = 2.5;
const ENTRY_HEIGHT = 3.25;
const GAP_HEIGHT = 1.1;
const DATE_GAP_HEIGHT = 2;

const entryKindOrder = new Map([
    "global-registration",
    "local-registration",
    "upload",
    "edit",
    "local-block",
    "global-block",
    "lock"
].map((kind, index) => [ kind, index ]));

const NumberFormatter = new Intl.NumberFormat();
const DateFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const TimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" });

const hiddenUsers = new Set();
const CreateTimelineDates = (function(data) {
    const entriesByDate = new Map();

    const addEntry = ((name, project, entry) => {
        const timestamp = new Date(entry.timestamp).getTime();
        if (!Number.isFinite(timestamp)) return;

        const date = Math.floor(timestamp / Time.days(1)) * Time.days(1)
        if (!entriesByDate.has(date)) entriesByDate.set(date, [ ]);
        entriesByDate.get(date).push({ ...entry, name, project, timestamp, dateTime: entry.timestamp });
    });

    for (const user of data) {
        if (user.registration?.timestamp)
            addEntry(user.name, "meta.wikimedia.org", {
                timestamp: user.registration.timestamp,
                kind: "global-registration",
                label: "global registration",
                title: `User:${user.name}`
            });

        for (const project of user.projects || [ ]) {
            if (project.registration?.timestamp)
                addEntry(user.name, project.project, {
                    timestamp: project.registration.timestamp,
                    kind: "local-registration",
                    label: "local registration",
                    title: `User:${user.name}`
                });
            for (const edit of project.edits || [ ])
                addEntry(user.name, project.project, { ...edit, kind: "edit", label: "edit" });
            for (const block of project.blocks || [ ])
                addEntry(user.name, project.project, {
                    ...block,
                    kind: "local-block",
                    label: `local ${block.unblock ? "unblock" : block.reblock ? "reblock" : "block"}`
                });
        }

        for (const block of user.blocks || [ ])
            addEntry(user.name, "meta.wikimedia.org", {
                ...block,
                kind: "global-block",
                label: `global ${block.unblock ? "unblock" : block.reblock ? "reblock" : "block"}`
            });
        for (const lock of user.locks || [ ])
            addEntry(user.name, "meta.wikimedia.org", {
                ...lock,
                kind: "lock",
                label: lock?.added?.includes("locked") || lock?.["0"] === "locked"
                            ? "lock"
                            : lock?.removed?.includes("locked") || lock?.["1"] === "locked"
                                ? "unlock"
                                : "lock status change"
            });
        for (const upload of user.uploads || [ ])
            addEntry(user.name, "commons.wikimedia.org", { ...upload, kind: "upload", label: "file upload" });
    }

    return Array.from(entriesByDate)
        .sort(([ a ], [ b ]) => a - b)
        .map(([ date, entries ]) => ({
            date,
            entries: entries.sort((a, b) =>
                a.timestamp - b.timestamp ||
                entryKindOrder.get(a.kind) - entryKindOrder.get(b.kind) ||
                a.name.localeCompare(b.name) ||
                String(a.revid ?? a.logid ?? "").localeCompare(String(b.revid ?? b.logid ?? ""))
            )
        }));
});

export const RenderTimeline = (function($content, data, requestedDate = self.rememberedDate) {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

    const users = new Map(data.map(user => [ user.name, { name: user.name, home: user.home, color: SeededColor(user.name), visible: !hiddenUsers.has(user.name) }]));
    const dates = CreateTimelineDates(data);

    const GetVisibleEntries = (function(i) { return dates[i].entries.filter(entry => !hiddenUsers.has(entry.name)); });
    const GetDateIndex = (function(date) {
        const timestamp = new Date(date).getTime();
        if (!Number.isFinite(timestamp)) return -1;

        const day = Math.floor(timestamp / Time.days(1)) * Time.days(1)
        return dates.findIndex(entry => entry.date === day);
    });
    const FindDateAtOffset = (function(offset) {
        let low = 0, high = dates.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (dates[middle].offset + dates[middle].height <= offset) low = middle + 1;
            else high = middle;
        }
        return low;
    });

    const state = history.state ?? { };
    self.rememberedDate = state.data = new Date(dates[Math.max(0, GetDateIndex(requestedDate))].date).toISOString().slice(0, 10);
    history.replaceState(state, "");

    const AddIndexRange = (function(set, from, to) {
        const stop = Math.min(dates.length - 1, to);
        for (let i = Math.max(0, from); i <= stop; i++)
            set.add(i);
    });

    const RefreshColors = (function() {
        PickColorSeed(users.keys());
        for (const [ key, value ] of users) value.color = SeededColor(key);
        for (const $el of $$("*[data-username]", $content))
            $el.style.setProperty("--user-color", SeededColor($el.dataset.username));
    });

    const GetFirstSectionTop = (function() {
        return $(":scope > .edit-timeline-page > .edit-timeline-days > .edit-timeline-day", $content).getBoundingClientRect().top
            - $content.getBoundingClientRect().top
            + $content.scrollTop
    });

    const loadedDays = new Set();
    const UpdateLoadedDays = (function() {
        const next = new Set();
        AddIndexRange(next, selectedIndex - 2, selectedIndex + 2);

        if (dates.length > 0 && $(":scope > .edit-timeline-page", $content)) {
            const viewportStart = Math.max(0, $content.scrollTop - GetFirstSectionTop());
            const viewportEnd = viewportStart + $content.clientHeight;
            AddIndexRange(next, FindDateAtOffset(viewportStart) - 1, FindDateAtOffset(viewportEnd) + 1);
        }

        for (const index of next)
            if (!loadedDays.has(index)) RenderDay(index);
        for (const index of loadedDays)
            if (!next.has(index))
                $(`:scope > .edit-timeline-page > .edit-timeline-days > .edit-timeline-day[data-index="${index}"]`, $content).replaceChildren();

        loadedDays.clear();
        for (const index of next) loadedDays.add(index);
    });

    let selectedIndex = Math.max(0, GetDateIndex(self.rememberedDate));
    let scrollSettleTimeout, programmaticScrollTarget = null;
    const NavigateToDate = (function(i, instant = false) {
        if (i < 0 || i >= dates.length) return;

        const top = GetFirstSectionTop() + dates[i].offset;
        if (instant) {
            clearTimeout(scrollSettleTimeout);
            programmaticScrollTarget = null;
            $content.scrollTop = top;
            return void(UpdateDateFromScroll());
        }

        programmaticScrollTarget = i;
        $content.scrollTo({
            top,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
        });
        ScheduleScrollSettle();
    });

    const ScheduleScrollSettle = (function() {
        clearTimeout(scrollSettleTimeout);
        scrollSettleTimeout = setTimeout(() => {
            programmaticScrollTarget = null;
            if ($(":scope > .edit-timeline-page", $content)) UpdateDateFromScroll();
        }, SCROLL_SETTLE_DELAY);
    });

    const UpdateDateFromScroll = (function() {
        const offset = $content.scrollTop + SCROLL_ANCHOR_OFFSET - GetFirstSectionTop();
        const i = FindDateAtOffset(offset);

        const state = history.state ?? { };
        self.rememberedDate = state.data = new Date(dates[i].date).toISOString().slice(0, 10);
        if (i !== selectedIndex) {
            selectedIndex = i;

            history.replaceState(state, "");
            UpdateLoadedDays();
            UpdateNavigation();
        }
    });

    const $$dateButtons = new Map();
    const UpdateNavigation = (function() {
        const $nav = $(":scope > .edit-timeline-page > .edit-timeline-navigation", $content);

        const visible = new Set();
        AddIndexRange(visible, selectedIndex - 2, selectedIndex + 2);
        for (const index of visible) {
            let $button = $$dateButtons.get(index);
            if (!$button)
                $$dateButtons.set(index, $button = $Create("button", { type: "button" }, undefined, [ [ "click", () => NavigateToDate(index) ] ]));

            const label = DateFormatter.format(new Date(dates[index].date));
            $button.className = `edit-timeline-date-button position-${index - selectedIndex + 2}`;
            $button.textContent = label;
            $button.setAttribute("aria-current", index === selectedIndex ? "date" : "false");
            $button.setAttribute("aria-label", `Show ${label}`);
            $nav.append($button);
        }

        for (const [ index, $button ] of $$dateButtons) {
            if (visible.has(index)) continue;
            $button.remove();
            $$dateButtons.delete(index);
        }
    });

    const UpdateDates = (function() {
        const $days = $(`:scope > .edit-timeline-page > .edit-timeline-days`, $content);
        let offset = 0;
        dates.forEach((day, i) => {
            if (i > 0 && day.date - dates[i - 1].date > Time.days(1))
                offset += DATE_GAP_HEIGHT * rem;

            const entries = GetVisibleEntries(i);
            const length = entries.length;

            let gaps = 0;
            for (let j = 1; j < length; j++)
                if (entries[j].timestamp - entries[j - 1].timestamp > LONG_GAP) gaps++;

            const height = (
                DAY_HEADER_HEIGHT +
                entries.length * ENTRY_HEIGHT +
                gaps * GAP_HEIGHT
            ) * rem + 1;

            day.offset = offset;
            day.height = height;
            $(`:scope > .edit-timeline-day[data-index="${i}"]`, $days).style.height = `${height}px`;
            offset += height;
        });
    });

    const RenderDay = (function(i) { // TODO add "aria-label" to entries
        let previous;
        const $section = $(`:scope > .edit-timeline-page > .edit-timeline-days > .edit-timeline-day[data-index="${i}"]`, $content);
        $section.replaceChildren(
            $Create("h2", { className: "edit-timeline-date" }, DateFormatter.format(new Date(dates[i].date))),
            ...GetVisibleEntries(i).flatMap(entry => {
                const $$els = [ $Create(
                    "article",
                    {
                        className: `edit-timeline-entry edit-timeline-entry--${entry.kind}`,
                        dataset: {
                            username: entry.name
                        },
                        style: {
                            "--user-color": SeededColor(entry.name)
                        }
                    },
                    [
                        $Create(
                            "div",
                            {
                                className: "edit-timeline-meta",
                            },
                            [
                                $Create(
                                    ...(entry.kind === "edit" || entry.logid !== undefined
                                        ? [
                                            "a",
                                            {
                                                className: "edit-timeline-timestamp",
                                                href: entry.kind === "edit"
                                                    ? GetDiffURL(entry.project, entry.revid, entry.parentid)
                                                    : GetLogURL(entry.project, entry.logid),
                                                target: "_blank",
                                                rel: "noopener noreferrer",
                                                title: `View ${entry.label}`
                                            }
                                        ]
                                        : [ "span", { className: "edit-timeline-timestamp", title: entry.dateTime } ]
                                    ),
                                    [
                                        $Create(
                                            "time",
                                            {
                                                dateTime: entry.dateTime
                                            },
                                            `${TimeFormatter.format(new Date(entry.timestamp))} UTC`
                                        )
                                    ]
                                ),
                                $Create(
                                    "a",
                                    {
                                        className: "edit-timeline-username",
                                        href: GetContributionsURL(entry.project, entry.name),
                                        target: "_blank",
                                        rel: "noopener noreferrer",
                                        title: "Open user contributions"
                                    },
                                    entry.name
                                )
                            ]
                        ),
                        $Create(
                            "div",
                            {
                                className: "edit-timeline-page-links",
                            },
                            [
                                $Create("span", { className: "edit-timeline-kind" }, entry.label || "Unknown"),
                                $Create(
                                    "a",
                                    {
                                        className: "edit-timeline-project",
                                        href: GetOrigin(entry.project),
                                        target: "_blank",
                                        rel: "noopener noreferrer",
                                        title: "Open project"
                                    },
                                    entry.project
                                ),
                                $Create(
                                    "span",
                                    {
                                        className: "edit-timeline-project-seperator",
                                        "aria-hidden": "true"
                                    }
                                ),
                                $Create(
                                    "a",
                                    {
                                        className: "edit-timeline-title",
                                        href: GetPageURL(entry.project, entry.title),
                                        target: "_blank",
                                        rel: "noopener noreferrer",
                                        title: "Open page"
                                    },
                                    entry.title
                                )
                            ]
                        )
                    ]
                ) ];
                const gap = previous === undefined ? -1 : entry.timestamp - previous;
                if (gap >= LONG_GAP) {
                    const totalMinutes = Math.floor(gap / Time.minutes(1));

                    const days = Math.floor(totalMinutes / (24 * 60));
                    const hours = Math.floor(totalMinutes / 60) % 24;
                    const minutes = totalMinutes % 60;

                    const parts = [ ];
                    if (days) parts.push(`${days}d`);
                    if (hours) parts.push(`${hours}h`);
                    if (minutes | !parts.length) parts.push(`${minutes}m`);
                    $$els.unshift($Create(
                        "div",
                        {
                            className: "edit-timeline-gap",
                            "aria-hidden": "true"
                        },
                        [
                            $Create("span", undefined, parts.join(" "))
                        ]
                    ));
                }
                previous = entry.timestamp;

                return $$els;
            })
        );
    });

    return $Create(
        "section",
        {
            className: "edit-timeline-page",
            tabIndex: 0,
            "aria-label": "User activity timeline",
            functions: {
                goToDate: (date => {
                    const timestamp = new Date(date).getTime();
                    if (!Number.isFinite(timestamp)) return -1;

                    const day = Math.floor(timestamp / Time.days(1)) * Time.days(1)
                    const i = dates.findIndex(entry => entry.date === day);
                    if (i < 0) return false;
                    return void(selectedIndex = i) || true;
                })
            },
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
                        Array.from(users.values()).map(user => $Create(
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

                                            if (user.visible) hiddenUsers.delete(user.name);
                                            else hiddenUsers.add(user.name);

                                            UpdateDates();
                                            UpdateLoadedDays();
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
            $Create(
                "div",
                {
                    className: "edit-timeline-days",
                    "aria-label": "Activity by date"
                },
                dates.flatMap(({ date }, i) => {
                    const $$els = [ $Create(
                        "section",
                        {
                            className: "edit-timeline-day",
                            "aria-label": DateFormatter.format(new Date(date)),
                            dataset: {
                                index: i
                            }
                        }
                    ) ];
                    if (i > 0) {
                        const skipped = (date - dates[i - 1].date) / Time.days(1) - 1;
                        if (skipped > 0)
                            $$els.unshift($Create(
                                "div",
                                {
                                    className: "edit-timeline-date-gap",
                                    "aria-label": `${Text.label("day", skipped)} without activity`
                                },
                                [
                                    $Create("span", undefined, `${Text.label("day", skipped, undefined, NumberFormatter)} skipped`)
                                ]
                            ));
                    }

                    return $$els;
                }).concat([
                    $Create("div", { className: "edit-timeline-scroll-tail", "aria-hidden": "true" }),
                    ...(dates.length ? [ ] : [ $Create(
                        "p", {
                            className: "edit-timeline-empty",
                            role: "status",
                        },
                        "No activity to display for these users and projects."
                    ) ])
                ])
            ),
            $Create(
                "nav",
                {
                    className: `edit-timeline-navigation ${dates.length ? "" : "hidden"}`,
                    "aria-label": "Choose a date"
                }
            )
        ],
        undefined,
        $self => {
            UpdateLoadedDays();
            UpdateNavigation();

            UpdateDates();

            $content.scrollTop = GetFirstSectionTop() + dates[selectedIndex].offset;
            $(":scope > .edit-timeline-days > .edit-timeline-scroll-tail", $self).style.height = Math.max(
                0,
                $content.clientHeight - dates.at(-1)?.height ?? 0
            );

            if (dates.length) {
                let scrollFrame;
                const controller = new AbortController();
                const { signal } = controller;

                const observer = new MutationObserver(() => {
                    if ($self.isConnected) return;
                    controller.abort();

                    if (scrollFrame) cancelAnimationFrame(scrollFrame);
                    clearTimeout(scrollSettleTimeout);
                    observer.disconnect();
                });
                observer.observe($content, { childList: true });

                $content.addEventListener("scroll", () => {
                    if (scrollFrame) return;
                    scrollFrame = requestAnimationFrame(() => {
                        scrollFrame = undefined;
                        if (!$self.isConnected) return;

                        UpdateLoadedDays();
                        if (programmaticScrollTarget === null) UpdateDateFromScroll();
                        else ScheduleScrollSettle();
                    });
                }, { passive: true, signal });

                window.addEventListener("resize", () => {
                    $(":scope > .edit-timeline-days > .edit-timeline-scroll-tail", $self).style.height = Math.max(
                        0,
                        $content.clientHeight - dates.at(-1)?.height ?? 0
                    );

                    UpdateLoadedDays();
                }, { passive: true, signal });

                const $nav = $(":scope > .edit-timeline-navigation", $self);
                $nav.addEventListener("wheel", e => {
                    if (e.deltaY === 0) return;
                    e.preventDefault();
                    if (programmaticScrollTarget === null)
                        NavigateToDate(selectedIndex + Math.sign(e.deltaY));
                }, { passive: false });
                $nav.addEventListener("keydown", e => {
                    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                    e.preventDefault();
                    NavigateToDate(selectedIndex + (e.key === "ArrowDown" ? 1 : -1));
                }, { passive: false });
            }
        }
    );
});