import { $ } from "../helpers/query-selector.js";

import {
    COLOR_SEED_CANDIDATES,
    GetUserColorSeed,
    SetUserColorSeed,
    StateUserColorSeed,
    UserColor,
} from "../helpers/username-to-color.js";
import { Text } from "../helpers/text.js";

const weekdays = [ "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" ];
const monthFormatter = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });
const dateFormatter = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
});
const numberFormatter = new Intl.NumberFormat();

const MOBILE_BREAKPOINT = 760;
const MAX_LISTED_EVENTS = 5;
const MAX_FEATHER_ANGLE = 6;

const dismissCalendarTooltips = new Set();
const hiddenUsers = new Set();

const dismissTooltips = () => dismissCalendarTooltips.forEach(dismiss => dismiss());
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const dayKey = (month, day) => `${month}-${day}`;
const encodeTitle = title => encodeURIComponent(title.replaceAll(" ", "_"));

function getOrCreate(map, key, createValue) {
    if (!map.has(key)) map.set(key, createValue());
    return map.get(key);
}

function create(tag, className, textContent) {
    const $element = document.createElement(tag);
    if (className) $element.className = className;
    if (textContent !== undefined) $element.textContent = textContent;
    return $element;
}

function createLink(className, href, textContent, title) {
    const $link = create("a", className, textContent);
    $link.href = href;
    $link.target = "_blank";
    $link.rel = "noopener noreferrer";
    if (title !== undefined) $link.title = title;
    return $link;
}

function getContributionsURL(project, username) {
    const origin = new URL(`https://${project}`).origin;
    return new URL(`/wiki/Special:Contributions/${encodeTitle(username)}`, origin).href;
}

function getGlobalContributionsURL(username) {
    return new URL(`/wiki/Special:GlobalContributions/${encodeTitle(username)}`, "https://meta.wikimedia.org").href;
}

function createUTCDate(year, month, day) {
    const date = new Date(0);
    date.setUTCFullYear(year, month, day);
    date.setUTCHours(0, 0, 0, 0);
    return date;
}

const daysInMonth = (year, month) => createUTCDate(year, month + 1, 0).getUTCDate();

export function RenderCalendar(data, requestedYear) {
    const calendar = createCalendarData(data);
    const years = getYears(calendar);
    const usersByName = new Map(calendar.users.map(user => [ user.name, user ]));

    for (const user of calendar.users) user.visible = !hiddenUsers.has(user.name);

    const newestIndex = years.length - 1;
    const parsedYear = Number(requestedYear ?? self.rememberedYear);
    const requestedIndex = Number.isInteger(parsedYear) ? years.indexOf(parsedYear) : -1;
    const initialIndex = requestedIndex >= 0 ? requestedIndex : newestIndex;

    let selectedIndex = initialIndex;
    let queuedIndex = initialIndex;
    let transitionPending = false;
    let wheelLocked = false;

    const $page = create("section", "calendar-page");
    $page.tabIndex = 0;
    $page.setAttribute("aria-label", "Calendar of account activity. Use the mouse wheel or up and down arrow keys to change years.");

    const $legend = createLegend(calendar.users, user => {
        if (user.visible) hiddenUsers.delete(user.name);
        else hiddenUsers.add(user.name);

        dismissTooltips();
        for (const $panel of $monthsWindow.querySelectorAll(".calendar-year-panel"))
            $panel.replaceChildren(...renderMonths(Number($panel.dataset.year), calendar));
    });
    $legend.querySelector(".calendar-refresh-colors").addEventListener("click", refreshColors);
    $page.appendChild($legend);

    const $main = create("div", "calendar-main");
    const $header = create("div", "calendar-header");
    const $yearWindow = create("div", "calendar-year-window");
    const $monthsWindow = create("div", "calendar-months-window");
    $monthsWindow.setAttribute("aria-live", "polite");

    let $currentTitle = createYearTitle(years[initialIndex]);
    $currentTitle.classList.add("current");

    $yearWindow.appendChild($currentTitle);
    $header.appendChild($yearWindow);
    $main.append($header, $monthsWindow);
    $page.appendChild($main);

    const $yearNavigation = create("nav", "calendar-years");
    $yearNavigation.setAttribute("aria-label", "Choose a year");
    $page.appendChild($yearNavigation);

    const $$yearButtons = years.map(year => {
        const $button = create("button", "calendar-year-button", String(year));
        $button.type = "button";
        $button.setAttribute("aria-label", `Show ${year}`);
        $button.addEventListener("click", () => requestYear(year));
        $yearNavigation.appendChild($button);
        return $button;
    });

    $page.addEventListener("wheel", event => {
        if (window.innerWidth <= MOBILE_BREAKPOINT) return;
        if (event.target instanceof Element && event.target.closest(".calendar-legend")) return;

        const delta = getWheelDelta(event, $page.clientHeight);
        if (delta === 0) return;

        event.preventDefault();
        if (wheelLocked || transitionPending) return;

        const nextIndex = selectedIndex + Math.sign(delta);
        if (nextIndex < 0 || nextIndex >= years.length) return;

        wheelLocked = true;
        requestYear(years[nextIndex]);
    }, { passive: false });

    $page.addEventListener("keydown", event => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();

        const step = event.key === "ArrowDown" ? 1 : -1;
        requestYear(years[Math.max(0, Math.min(newestIndex, queuedIndex + step))]);
    });

    $monthsWindow.appendChild(renderYearPanel(years[initialIndex], calendar, true));
    $("#tab-content").appendChild($page);

    setActiveYear(initialIndex);
    saveSelectedYear(years[initialIndex]);
    $yearNavigation.scrollTop = getCenteredScrollTop(initialIndex);

    function refreshColors() {
        SetUserColorSeed(pickColorSeed(calendar.users));
        StateUserColorSeed();
        for (const user of calendar.users) user.color = UserColor(user.name);

        for (const $swatch of $page.querySelectorAll(".calendar-legend-swatch"))
            $swatch.style.setProperty("--user-color", usersByName.get($swatch.dataset.username).color);

        for (const $day of $page.querySelectorAll(".calendar-day[data-usernames]")) {
            const colors = JSON.parse($day.dataset.usernames).map(name => usersByName.get(name).color);
            setDayColors($day, colors, JSON.parse($day.dataset.editCounts));
        }

        const $icon = $legend.querySelector(".calendar-refresh-icon");
        $icon.classList.remove("rotating");
        void $icon.offsetWidth;
        $icon.classList.add("rotating");
    }

    function getCenteredScrollTop(index) {
        const $button = $$yearButtons[index];
        return $button.offsetTop - ($yearNavigation.clientHeight - $button.offsetHeight) / 2;
    }

    function setActiveYear(index) {
        $$yearButtons.forEach(($button, i) => {
            $button.classList.toggle("active", i === index);
            $button.setAttribute("aria-current", i === index ? "date" : "false");
        });
        $yearNavigation.style.setProperty("--active-year-index", index);
    }

    function saveSelectedYear(year) {
        self.rememberedYear = year;
        const state = window.history.state ?? { };
        state.data = String(year);
        window.history.replaceState(state, "");
    }

    function requestYear(year) {
        const targetIndex = years.indexOf(year);
        if (targetIndex < 0 || targetIndex === queuedIndex) return;

        queuedIndex = targetIndex;
        saveSelectedYear(year);
        if (!transitionPending) advanceYear();
    }

    function advanceYear() {
        if (selectedIndex === queuedIndex) {
            transitionPending = false;
            return;
        }

        transitionPending = true;
        const nextYear = years[queuedIndex];
        const direction = nextYear < years[selectedIndex] ? "older" : "newer";
        selectedIndex = queuedIndex;

        dismissTooltips();

        const $currentPanel = $monthsWindow.querySelector(".calendar-year-panel.current");
        const $previousTitle = $currentTitle;
        const $nextPanel = renderYearPanel(nextYear, calendar);
        const $nextTitle = createYearTitle(nextYear);

        $yearWindow.appendChild($nextTitle);
        $monthsWindow.appendChild($nextPanel);

        const $exiting = [ $currentPanel, $previousTitle ];
        const $entering = [ $nextPanel, $nextTitle ];
        for (const $element of $exiting) $element.classList.add(`exit-${direction}`);
        for (const $element of $entering) $element.classList.add(`enter-${direction}`);

        setActiveYear(selectedIndex);
        $yearNavigation.scrollTo({ top: getCenteredScrollTop(selectedIndex), behavior: "smooth" });

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;

            $currentPanel.remove();
            $previousTitle.remove();

            for (const $element of $entering) {
                $element.classList.remove(`enter-${direction}`);
                $element.classList.add("current");
            }

            $currentTitle = $nextTitle;
            wheelLocked = false;
            advanceYear(); // continue with any year requested meanwhile
        };

        let remaining = $exiting.length + $entering.length;
        for (const $element of [ ...$exiting, ...$entering ])
            $element.addEventListener("animationend", () => { if (--remaining === 0) finish(); }, { once: true });

        if (prefersReducedMotion()) finish();
        else setTimeout(finish, 360);
    }
}

function createYearTitle(year) {
    return create("h1", "calendar-year", String(year));
}

function getWheelDelta(event, pageHeight) {
    switch (event.deltaMode) {
        case WheelEvent.DOM_DELTA_LINE: return event.deltaY * 16;
        case WheelEvent.DOM_DELTA_PAGE: return event.deltaY * pageHeight;
        default: return event.deltaY;
    }
}

function getLockLabel({ params }) {
    if (params?.added?.includes("locked") || params?.["0"] === "locked") return "Lock";
    if (params?.removed?.includes("locked") || params?.["1"] === "locked") return "Unlock";
    return "Lock status change";
}

function getCalendarBlockLabel(block, scope, local = false) {
    const action = block.unblock ? "Unblock" : block.reblock ? "Reblock" : "Block";
    return local ? `${action} (${scope})` : `${scope} ${action.toLowerCase()}`;
}

function createCalendarData(data) {
    const users = [ ];
    const seenUsers = new Set();
    const activity = new Map();
    const events = new Map();
    let oldestYear = Infinity;
    let newestYear = -Infinity;

    const getDayBucket = (timestamp, byYear, createBucket) => {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return null;

        const year = date.getUTCFullYear();
        oldestYear = Math.min(oldestYear, year);
        newestYear = Math.max(newestYear, year);

        const days = getOrCreate(byYear, year, () => new Map());
        return {
            date,
            bucket: getOrCreate(days, dayKey(date.getUTCMonth(), date.getUTCDate()), createBucket)
        };
    };

    const addEvent = (username, timestamp, kind, label) => {
        const day = getDayBucket(timestamp, events, () => [ ]);
        day?.bucket.push({ username, kind, label, timestamp: day.date.getTime() });
    };

    for (const user of data) {
        const username = String(user.user);
        if (!seenUsers.has(username)) {
            seenUsers.add(username);
            users.push({ name: username, home: user.home, color: UserColor(username), visible: true });
        }

        if (user.registration?.timestamp)
            addEvent(username, user.registration.timestamp, "registration", "Global registration");

        for (const project of user.projects || [ ]) {
            for (const edit of project.edits || [ ]) {
                const day = getDayBucket(edit.timestamp, activity, () => new Map());
                if (day) day.bucket.set(username, (day.bucket.get(username) || 0) + 1);
            }

            for (const block of project.blocks || [ ])
                addEvent(username, block.timestamp, "local-block", getCalendarBlockLabel(block, project.code || project.project, true));
        }

        for (const block of user.blocks || [ ])
            addEvent(username, block.timestamp, "global-block", getCalendarBlockLabel(block, "Global"));

        for (const lock of user.locks || [ ])
            addEvent(username, lock.timestamp, "lock", getLockLabel(lock));
    }

    if (oldestYear === Infinity)
        oldestYear = newestYear = new Date().getFullYear();

    return { users, activity, events, oldestYear, newestYear };
}

function getYears({ oldestYear, newestYear }) {
    return Array.from({ length: newestYear - oldestYear + 1 }, (_, index) => oldestYear + index);
}

function updateSwatch($swatch, user) {
    const label = `${user.visible ? "Hide" : "Show"} ${user.name}`;
    $swatch.classList.toggle("is-hidden", !user.visible);
    $swatch.setAttribute("aria-pressed", String(user.visible));
    $swatch.setAttribute("aria-label", label);
    $swatch.title = label;
}

function createLegend(users, onToggle) {
    const $legend = create("aside", "calendar-legend");
    const $list = create("ul", "calendar-legend-list");
    $legend.append(create("h2", "calendar-legend-title", "Accounts"), $list);

    for (const user of users) {
        const $swatch = create("button", "calendar-legend-swatch");
        $swatch.type = "button";
        $swatch.style.setProperty("--user-color", user.color);
        $swatch.dataset.username = user.name;
        updateSwatch($swatch, user);
        $swatch.addEventListener("click", () => {
            user.visible = !user.visible;
            updateSwatch($swatch, user);
            onToggle(user);
        });

        const $item = create("li", "calendar-legend-item");
        const $username = createLink(
            "calendar-legend-username",
            user.home ? getContributionsURL(user.home, user.name) : getGlobalContributionsURL(user.name),
            user.name,
            user.home
                ? `View ${user.name}'s contributions on their home wiki`
                : `View ${user.name}'s global contributions`
        );
        $item.append($swatch, $username);
        $list.appendChild($item);
    }

    const $icon = create("span", "calendar-refresh-icon", "\u21bb");
    $icon.setAttribute("aria-hidden", "true");

    const $refresh = create("button", "calendar-refresh-colors");
    $refresh.type = "button";
    $refresh.setAttribute("aria-label", "New colors");
    $refresh.append($icon, document.createTextNode("New colors"));
    $legend.appendChild($refresh);

    return $legend;
}

function getPaletteDistance(users, seed) {
    const hues = users.map(user => {
        const match = UserColor(user.name, seed).match(/^hsl\((\d+)/);
        if (!match) throw new Error(`Could not read generated color for "${user.name}".`);
        return Number(match[1]);
    });

    let minimumDistance = Infinity;
    for (let i = 0; i < hues.length; i++)
        for (let j = i + 1; j < hues.length; j++) {
            const difference = Math.abs(hues[i] - hues[j]);
            minimumDistance = Math.min(minimumDistance, difference, 360 - difference);
        }

    return minimumDistance;
}

function pickColorSeed(users) {
    const currentSeed = GetUserColorSeed();
    const candidates = new Set();
    while (candidates.size < COLOR_SEED_CANDIDATES) {
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        if (seed !== currentSeed) candidates.add(seed);
    }

    let best;
    let greatestDistance = -Infinity;
    for (const candidate of candidates) {
        const distance = getPaletteDistance(users, candidate);
        if (distance > greatestDistance) {
            best = candidate;
            greatestDistance = distance;
        }
    }
    return best;
}

function setDayColors($cell, colors, editCounts) {
    $cell.style.removeProperty("--day-color");
    $cell.style.removeProperty("background-image");
    if ($cell.classList.contains("future") || colors.length === 0) return;

    if (colors.length === 1) {
        $cell.style.setProperty("--day-color", colors[0]);
        return;
    }

    const totalWeight = editCounts.reduce((total, count) => total + count, 0);
    const angles = editCounts.map(count => count / totalWeight * 360);
    const halfFeather = Math.min(MAX_FEATHER_ANGLE, Math.min(...angles) / 2) / 2;
    const last = colors.length - 1;

    const stops = [
        `${colors[last]} ${-halfFeather}deg`,
        `${colors[0]} ${halfFeather}deg`
    ];
    let boundary = 0;
    for (let index = 1; index < colors.length; index++) {
        boundary += angles[index - 1];
        stops.push(
            `${colors[index - 1]} ${boundary - halfFeather}deg`,
            `${colors[index]} ${boundary + halfFeather}deg`
        );
    }
    stops.push(
        `${colors[last]} ${360 - halfFeather}deg`,
        `${colors[0]} ${360 + halfFeather}deg`
    );

    $cell.style.backgroundImage = `conic-gradient(from -90deg, ${stops.join(", ")})`;
}

function renderYearPanel(year, calendar, current = false) {
    const $panel = create("div", "calendar-year-panel");
    $panel.dataset.year = String(year);
    $panel.classList.toggle("current", current);
    $panel.setAttribute("aria-label", `${year} calendar`);
    $panel.append(...renderMonths(year, calendar));
    return $panel;
}

function renderMonths(year, calendar) {
    const visibleUsers = new Set(calendar.users.filter(user => user.visible !== false).map(user => user.name));
    const activity = calendar.activity.get(year);
    const eventDays = calendar.events.get(year);

    const today = new Date();
    const currentYear = today.getUTCFullYear();
    const currentMonth = today.getUTCMonth();
    const currentDay = today.getUTCDate();

    return Array.from({ length: 12 }, (_, month) => {
        const monthIsFuture = year > currentYear || year === currentYear && month > currentMonth;
        const monthStart = createUTCDate(year, month, 1);
        const monthName = monthFormatter.format(monthStart);

        const $grid = create("div", "calendar-month-grid");
        $grid.setAttribute("role", "group");
        $grid.setAttribute("aria-label", `${monthName} ${year}`);

        for (const weekday of weekdays) {
            const $label = create("span", "calendar-weekday", weekday);
            $label.setAttribute("aria-hidden", "true");
            $grid.appendChild($label);
        }

        const offset = (monthStart.getUTCDay() + 6) % 7; // 67
        for (let i = 0; i < offset; i++) {
            const $blank = create("span", "calendar-day-spacer");
            $blank.setAttribute("aria-hidden", "true");
            $grid.appendChild($blank);
        }

        for (let day = 1; day <= daysInMonth(year, month); day++) {
            const key = dayKey(month, day);
            const editors = new Map(Array.from(activity?.get(key) ?? [ ]).filter(([ name ]) => visibleUsers.has(name)));
            const events = (eventDays?.get(key) ?? [ ]).filter(event => visibleUsers.has(event.username));
            const future = monthIsFuture || year === currentYear && month === currentMonth && day > currentDay;

            let $cell;
            if (editors.size > 0 || events.length > 0) {
                $cell = createActiveDay(year, month, day, editors, events, calendar.users, future);
            } else {
                $cell = create("span", "calendar-day inactive");
                $cell.setAttribute("aria-hidden", "true");
                $cell.classList.toggle("future", future);
            }
            $grid.appendChild($cell);
        }

        const $heading = create("h2", "calendar-month-title", monthName);
        const $monthHeading = create("div", "calendar-month-heading");
        $monthHeading.appendChild($heading);

        const $card = create("section", "calendar-month");
        $card.classList.toggle("future", monthIsFuture);
        $card.append($monthHeading, $grid);
        return $card;
    });
}

function createActiveDay(year, month, day, editors, events, users, future) {
    const date = createUTCDate(year, month, day);
    const dateLabel = dateFormatter.format(date);

    const $cell = create("button", "calendar-day active");
    $cell.type = "button";
    $cell.classList.toggle("future", future);
    $cell.classList.toggle("has-events", events.length > 0);

    const editorEntries = users
        .filter(user => editors.has(user.name))
        .map(user => ({ ...user, edits: editors.get(user.name) }));
    const names = editorEntries.map(user => user.name);
    const editCounts = editorEntries.map(user => user.edits);

    $cell.dataset.usernames = JSON.stringify(names);
    $cell.dataset.editCounts = JSON.stringify(editCounts);
    setDayColors($cell, editorEntries.map(user => user.color), editCounts);

    if (editorEntries.length === 0) $cell.classList.add("event-only");
    if (events.length > 0) $cell.appendChild(createEventMarker(events));

    const editDetails = editorEntries.map(user =>
        `${user.name}: ${numberFormatter.format(user.edits)} ${Text.pluralize("edit", user.edits)}`
    );

    const sortedEvents = events.slice().sort((a, b) => a.timestamp - b.timestamp);
    const describe = event => `${event.username}: ${event.label}`;
    const eventDetails = sortedEvents.length > MAX_LISTED_EVENTS
        ? [
            ...sortedEvents.slice(0, MAX_LISTED_EVENTS - 1).map(describe),
            `and ${sortedEvents.length - (MAX_LISTED_EVENTS - 1)} other events`
        ]
        : sortedEvents.map(describe);

    const details = [ ...editDetails, ...eventDetails ];
    $cell.setAttribute("aria-label", details.length > 0 ? `${dateLabel}. ${details.join(". ")}` : dateLabel);

    $cell.addEventListener("click", () => {
        const $timelineTab = $("#tabs > .tab-button[data-tab=\"timeline\"]");
        if (!$timelineTab) throw new Error("Timeline tab not found.");
        $timelineTab.click();

        const $timeline = $("#tab-content .edit-timeline-page");
        if (!$timeline?.goToDate(date, { instant: true }))
            throw new Error(`Could not navigate to timeline date ${dateLabel}.`);
    });

    attachTooltip($cell, dateLabel, { edits: editDetails, events: eventDetails });
    return $cell;
}

function createEventMarker(events) {
    const $marker = create("span", "calendar-event-marker", "!");
    $marker.setAttribute("aria-hidden", "true");
    $marker.title = events.map(event => event.label).join(", ");
    return $marker;
}

function createTooltip(heading, { edits, events }) {
    const $content = create("div", "calendar-tooltip-content");
    if (edits.length > 0) $content.appendChild(create("div", undefined, edits.join("\n")));
    if (edits.length > 0 && events.length > 0) $content.appendChild(create("hr", "calendar-tooltip-divider"));
    if (events.length > 0) $content.appendChild(create("div", undefined, events.join("\n")));

    const $tooltip = create("div", "calendar-tooltip");
    $tooltip.append(create("strong", "calendar-tooltip-title", heading), $content);
    return $tooltip;
}

function attachTooltip($cell, heading, details) {
    let $tooltip = null;

    const show = () => {
        if (!$tooltip) {
            $tooltip = createTooltip(heading, details);
            $cell.closest(".calendar-page").appendChild($tooltip);
        }

        const rect = $cell.getBoundingClientRect();
        $tooltip.classList.toggle("below", rect.top < 100);
        $tooltip.style.left = `${rect.left + rect.width / 2}px`;
        $tooltip.style.top = `${rect.top}px`;
        $tooltip.classList.add("visible");

        window.addEventListener("scroll", hide, true);
        dismissCalendarTooltips.add(hide);
    };

    const hide = () => {
        if (!$tooltip) return;

        window.removeEventListener("scroll", hide, true);
        dismissCalendarTooltips.delete(hide);
        $tooltip.classList.remove("visible");

        const $fading = $tooltip;
        setTimeout(() => {
            if ($fading.classList.contains("visible")) return;
            $fading.remove();
            if ($tooltip === $fading) $tooltip = null;
        }, 180);
    };

    $cell.addEventListener("mouseenter", show);
    $cell.addEventListener("focus", show);
    $cell.addEventListener("mouseleave", hide);
    $cell.addEventListener("blur", hide);
}