import { $ } from "../helpers/query-selector.js";

import {
    GetUserColorSeed,
    SetUserColorSeed,
    StateUserColorSeed,
    UserColor
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
const dismissCalendarTooltips = new Set();

export function RenderCalendar(data, requestedYear) {
    const calendar = createCalendarData(data);
    const years = getYears(calendar);

    const $page = document.createElement("section");
    $page.classList.add("calendar-page");
    $page.tabIndex = 0;
    $page.setAttribute("aria-label", "Calendar of edit activity. Use the mouse wheel or up and down arrow keys to change years.");

    const $legend = document.createElement("aside");
    $legend.classList.add("calendar-legend");
    $page.appendChild($legend);

    const $refreshButton = renderLegend($legend, calendar.users);
    $refreshButton.addEventListener("click", () => {
        const currentSeed = GetUserColorSeed();
        const candidates = new Set();
        while (candidates.size < 10) {
            const seed = crypto.getRandomValues(new Uint32Array(1))[0];
            if (seed !== currentSeed) candidates.add(seed);
        }

        let seed;
        let greatestDistance = -Infinity;
        for (const candidate of candidates) {
            const distance = getPaletteDistance(calendar.users, candidate);
            if (distance > greatestDistance) {
                seed = candidate;
                greatestDistance = distance;
            }
        }

        SetUserColorSeed(seed);
        StateUserColorSeed();
        for (const user of calendar.users)
            user.color = UserColor(user.name);

        for (const $swatch of $page.querySelectorAll(".calendar-legend-swatch")) {
            const user = calendar.users.find(user => user.name === $swatch.dataset.username);
            if (!user) throw new Error(`No calendar account found for "${$swatch.dataset.username}".`);
            $swatch.style.setProperty("--user-color", user.color);
        }

        for (const $day of $page.querySelectorAll(".calendar-day[data-usernames]")) {
            const users = JSON.parse($day.dataset.usernames).map(username => {
                const user = calendar.users.find(user => user.name === username);
                if (!user)
                    throw new Error(`No calendar account found for "${username}".`);
                return user;
            });
            setDayColors($day, users.map(user => user.color), JSON.parse($day.dataset.editCounts));
        }

        const $icon = $refreshButton.querySelector(".calendar-refresh-icon");
        $icon.classList.remove("rotating");
        void $icon.offsetWidth;
        $icon.classList.add("rotating");
    });

    const $main = document.createElement("div");
    $main.classList.add("calendar-main");
    $page.appendChild($main);

    const $header = document.createElement("div");
    $header.classList.add("calendar-header");
    $main.appendChild($header);

    const $yearWindow = document.createElement("div");
    $yearWindow.classList.add("calendar-year-window");
    $header.appendChild($yearWindow);

    const $title = document.createElement("h1");
    $title.classList.add("calendar-year", "current");
    $yearWindow.appendChild($title);
    let $currentTitle = $title;

    const $monthsWindow = document.createElement("div");
    $monthsWindow.classList.add("calendar-months-window");
    $monthsWindow.setAttribute("aria-live", "polite");
    $main.appendChild($monthsWindow);

    const $yearNavigation = document.createElement("nav");
    $yearNavigation.classList.add("calendar-years");
    $yearNavigation.setAttribute("aria-label", "Choose a year");
    $page.appendChild($yearNavigation);

    const $$yearButtons = years.map(year => {
        const $button = document.createElement("button");
        $button.type = "button";
        $button.classList.add("calendar-year-button");
        $button.textContent = String(year);
        $button.setAttribute("aria-label", `Show ${year}`);
        $yearNavigation.appendChild($button);

        $button.addEventListener("click", () => requestYear(year));

        return $button;
    });

    const newestIndex = years.length - 1;
    const parsedYear = Number(requestedYear ?? self.rememberedYear);
    const requestedIndex = Number.isInteger(parsedYear) ? years.indexOf(parsedYear) : -1;
    const initialIndex = requestedIndex >= 0 ? requestedIndex : newestIndex;

    let selectedIndex = initialIndex, queuedIndex = initialIndex;
    let transitionPending = false;
    let wheelLocked = false;

    function requestYear(year) {
        const targetIndex = years.indexOf(year);
        if (targetIndex < 0 || targetIndex === queuedIndex) return;
        queuedIndex = targetIndex;
        saveSelectedYear(year);
        if (!transitionPending) advanceYear();
    }

    function saveSelectedYear(year) {
        self.rememberedYear = year;
        const state = window.history.state ?? { };
        state.data = String(year);
        window.history.replaceState(state, "");
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

        dismissCalendarTooltips.forEach(dismiss => dismiss());

        const $currentPanel = $monthsWindow.querySelector(".calendar-year-panel.current");
        const $nextPanel = renderYearPanel(nextYear, calendar);
        const $nextTitle = createYearTitle(nextYear);

        $yearWindow.appendChild($nextTitle);
        $monthsWindow.appendChild($nextPanel);

        $currentPanel.classList.add(`exit-${direction}`);
        $nextPanel.classList.add(`enter-${direction}`);
        $currentTitle.classList.add(`exit-${direction}`);
        $nextTitle.classList.add(`enter-${direction}`);

        $$yearButtons.forEach(($button, index) => {
            const active = years[index] === nextYear;
            $button.classList.toggle("active", active);
            $button.setAttribute("aria-current", active ? "date" : "false");
        });
        $yearNavigation.style.setProperty("--active-year-index", selectedIndex);

        const $selectedButton = $$yearButtons[selectedIndex];
        $yearNavigation.scrollTo({
            top: $selectedButton.offsetTop - ($yearNavigation.clientHeight - $selectedButton.offsetHeight) / 2,
            behavior: "smooth"
        });

        let finishedAnimations = 0, finished = false;
        const finish = force => {
            if (finished || !force && ++finishedAnimations < 4) return;
            finished = true;

            $currentPanel.remove();
            $currentPanel.classList.remove(`exit-${direction}`);

            $nextPanel.classList.remove(`enter-${direction}`);
            $nextPanel.classList.add("current");

            $currentTitle.remove();

            $nextTitle.classList.remove(`enter-${direction}`);
            $nextTitle.classList.add("current");

            $currentTitle = $nextTitle;

            wheelLocked = false;
            advanceYear();
        };

        $currentPanel.addEventListener("animationend", () => finish(false), { once: true });
        $nextPanel.addEventListener("animationend", () => finish(false), { once: true });

        $currentTitle.addEventListener("animationend", () => finish(false), { once: true });
        $nextTitle.addEventListener("animationend", () => finish(false), { once: true });

        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
            finish(true);
        else setTimeout(() => finish(true), 360);
    }

    function createYearTitle(year) {
        const $yearTitle = document.createElement("h1");
        $yearTitle.classList.add("calendar-year");
        $yearTitle.textContent = String(year);
        return $yearTitle;
    }

    $page.addEventListener("wheel", event => {
        if (window.innerWidth <= 760) return;
        const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? event.deltaY * 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? event.deltaY * $page.clientHeight
                : event.deltaY;

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
        const direction = event.key === "ArrowDown" ? 1 : -1;
        requestYear(years[Math.max(0, Math.min(years.length - 1, queuedIndex + direction))]);
    });

    $title.textContent = String(years[initialIndex]);

    $$yearButtons[initialIndex].classList.add("active");
    $$yearButtons[initialIndex].setAttribute("aria-current", "date");
    $yearNavigation.style.setProperty("--active-year-index", initialIndex);

    $monthsWindow.appendChild(renderYearPanel(years[initialIndex], calendar, true));
    $("#tab-content").appendChild($page);

    saveSelectedYear(years[initialIndex]);
    $yearNavigation.scrollTop = $$yearButtons[initialIndex].offsetTop - ($yearNavigation.clientHeight - $$yearButtons[initialIndex].offsetHeight) / 2;
}

function createCalendarData(data) {
    const users = [];
    const userNames = new Set();
    const activity = new Map();
    let oldestYear = Infinity;
    let newestYear = -Infinity;

    for (const user of data) {
        const username = String(user.user);
        if (!userNames.has(username)) {
            userNames.add(username);
            users.push({ name: username, color: UserColor(username) });
        }

        for (const project of user.projects)
            for (const edit of project.edits) {
                const date = new Date(edit.timestamp);
                if (Number.isNaN(date.getTime())) continue;

                const year = date.getUTCFullYear(), month = date.getUTCMonth(), day = date.getUTCDate();
                oldestYear = Math.min(oldestYear, year);
                newestYear = Math.max(newestYear, year);

                let days = activity.get(year);
                if (!days) activity.set(year, days = new Map());

                const dateKey = `${month}-${day}`;
                let editors = days.get(dateKey);
                if (!editors) days.set(dateKey, editors = new Map());
                editors.set(username, (editors.get(username) || 0) + 1);
            }
    }

    if (oldestYear === Infinity)
        oldestYear = newestYear = new Date().getFullYear();

    return { users, activity, oldestYear, newestYear };
}

function getYears({ oldestYear, newestYear }) {
    const years = [];
    for (let year = oldestYear; year <= newestYear; year++)
        years.push(year);
    return years;
}

function renderLegend($legend, users) {
    const $title = document.createElement("h2");
    $title.classList.add("calendar-legend-title");
    $title.textContent = "Accounts";
    $legend.appendChild($title);

    const $list = document.createElement("ul");
    $list.classList.add("calendar-legend-list");
    $legend.appendChild($list);

    for (const user of users) {
        const $item = document.createElement("li");
        $item.classList.add("calendar-legend-item");
        $list.appendChild($item);

        const $swatch = document.createElement("span");
        $swatch.classList.add("calendar-legend-swatch");
        $swatch.style.setProperty("--user-color", user.color);
        $swatch.dataset.username = user.name;
        $swatch.setAttribute("aria-hidden", "true");
        $item.append($swatch, document.createTextNode(user.name));
    }

    const $refresh = document.createElement("button");
    $refresh.type = "button";
    $refresh.classList.add("calendar-refresh-colors");
    $refresh.setAttribute("aria-label", "New colors");
    $legend.appendChild($refresh);

    const $icon = document.createElement("span");
    $icon.classList.add("calendar-refresh-icon");
    $icon.setAttribute("aria-hidden", "true");
    $icon.textContent = "\u21bb";
    $refresh.append($icon, document.createTextNode("New colors"));

    return $refresh;
}

function renderMonths(year, calendar) {
    const $$months = [ ];

    const today = new Date();
    const currentYear = today.getUTCFullYear(), currentMonth = today.getUTCMonth(), currentDay = today.getUTCDate();
    for (let month = 0; month < 12; month++) {
        const $card = document.createElement("section");
        $card.classList.add("calendar-month");
        const monthIsFuture = year > currentYear || year === currentYear && month > currentMonth;
        if (monthIsFuture) $card.classList.add("future");

        const date = createUTCDate(year, month, 1);
        const $monthHeading = document.createElement("div");
        $monthHeading.classList.add("calendar-month-heading");
        $card.appendChild($monthHeading);

        const $heading = document.createElement("h2");
        $heading.classList.add("calendar-month-title");
        $heading.textContent = monthFormatter.format(date);
        $monthHeading.appendChild($heading);

        const $grid = document.createElement("div");
        $grid.classList.add("calendar-month-grid");
        $grid.setAttribute("role", "group");
        $grid.setAttribute("aria-label", `${$heading.textContent} ${year}`);

        for (const weekday of weekdays) {
            const $label = document.createElement("span");
            $label.classList.add("calendar-weekday");
            $label.textContent = weekday;
            $label.setAttribute("aria-hidden", "true");
            $grid.appendChild($label);
        }

        const offset = (date.getUTCDay() + 6) % 7;
        for (let i = 0; i < offset; i++) {
            const $blank = document.createElement("span");
            $blank.classList.add("calendar-day-spacer");
            $blank.setAttribute("aria-hidden", "true");
            $grid.appendChild($blank);
        }

        const dayCount = daysInMonth(year, month);
        const days = calendar.activity.get(year);
        for (let day = 1; day <= dayCount; day++) {
            const editors = days?.get(`${month}-${day}`);
            const $cell = editors
                ? createActiveDay(year, month, day, editors, calendar.users)
                : document.createElement("span");

            const dayIsFuture = monthIsFuture || year === currentYear && month === currentMonth && day > currentDay;
            if (dayIsFuture) $cell.classList.add("future");

            if (!editors) {
                $cell.classList.add("calendar-day", "inactive");
                $cell.setAttribute("aria-hidden", "true");
            }

            $grid.appendChild($cell);
        }

        $card.appendChild($grid);
        $$months.push($card);
    }

    return $$months;
}

function renderYearPanel(year, calendar, current = false) {
    const $panel = document.createElement("div");
    $panel.classList.add("calendar-year-panel");
    if (current) $panel.classList.add("current");
    $panel.setAttribute("aria-label", `${year} calendar`);

    for (const $month of renderMonths(year, calendar))
        $panel.append($month);
    return $panel;
}

function createActiveDay(year, month, day, editors, users) {
    const $cell = document.createElement("button");
    $cell.type = "button";
    $cell.classList.add("calendar-day", "active");
    const date = createUTCDate(year, month, day);

    const colors = [ ], editCounts = [ ], names = [ ];
    const editorEntries = users.filter(user => editors.has(user.name)).map(user => {
        const edits = editors.get(user.name);
        names.push(user.name);
        colors.push(user.color);
        editCounts.push(edits);
        return { ...user, edits };
    });
    $cell.dataset.usernames = JSON.stringify(names);
    $cell.dataset.editCounts = JSON.stringify(editCounts);

    setDayColors($cell, colors, editCounts);
    const editorCount = editorEntries.length;
    if (editorCount > 1) {
        $cell.classList.add("multi-user");

        const $count = document.createElement("span");
        $count.classList.add("calendar-day-count");
        $count.textContent = editorCount > 9 ? "9+" : String(editorCount);
        $cell.appendChild($count);
    }

    const dateLabel = dateFormatter.format(date);
    const details = editorEntries.map(user => `${user.name}: ${user.edits} ${Text.pluralize("edit", user.edits)}`);
    const tooltipText = details.join("\n");
    $cell.setAttribute("aria-label", `${dateLabel}. ${details.join(". ")}`);
    $cell.addEventListener("click", () => {
        const $timelineTab = $("#tabs > .tab-button[data-tab=\"timeline\"]");
        if (!$timelineTab)
            throw new Error("Timeline tab not found.");
        $timelineTab.click();

        const $timeline = $("#tab-content .edit-timeline-page");
        if (!$timeline?.goToDate(date, { instant: true }))
            throw new Error(`Could not navigate to timeline date ${dateLabel}.`);
    });
    attachTooltip($cell, dateLabel, tooltipText);
    return $cell;
}

function setDayColors($cell, colors, editCounts) {
    $cell.style.removeProperty("--day-color");
    $cell.style.removeProperty("background-image");
    if ($cell.classList.contains("future")) return;
    if (colors.length === 1) {
        $cell.style.setProperty("--day-color", colors[0]);
        return;
    }

    const totalEdits = editCounts.reduce((total, count) => total + count, 0);
    let editsSoFar = 0;
    const stops = colors.flatMap((color, index) => {
        const start = editsSoFar / totalEdits * 360;
        editsSoFar += editCounts[index];
        const end = index === colors.length - 1 ? 360 : editsSoFar / totalEdits * 360;
        return [`${color} ${start}deg`, `${color} ${end}deg`];
    });
    stops.push(`${colors[0]} 360deg`);
    $cell.style.backgroundImage = `conic-gradient(from -90deg, ${stops.join(", ")})`;
}

function attachTooltip($cell, heading, details) {
    let $tooltip;

    const show = () => {
        if (!$tooltip) {
            $tooltip = document.createElement("div");
            $tooltip.classList.add("calendar-tooltip");

            const $title = document.createElement("strong");
            $title.classList.add("calendar-tooltip-title");
            $title.textContent = heading;
            $tooltip.appendChild($title);

            const $content = document.createElement("span");
            $content.classList.add("calendar-tooltip-content");
            $content.textContent = details;
            $tooltip.appendChild($content);
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

        const $currentTooltip = $tooltip;
        setTimeout(() => {
            if ($currentTooltip.classList.contains("visible")) return;
            $currentTooltip.remove();
            if ($tooltip === $currentTooltip) $tooltip = null;
        }, 180);
    };

    $cell.addEventListener("mouseenter", show);
    $cell.addEventListener("focus", show);
    $cell.addEventListener("mouseleave", hide);
    $cell.addEventListener("blur", hide);
}

function createUTCDate(year, month, day) {
    const date = new Date(0);
    date.setUTCFullYear(year, month, day);
    date.setUTCHours(0, 0, 0, 0);
    return date;
}

function daysInMonth(year, month) {
    return createUTCDate(year, month + 1, 0).getUTCDate();
}

function getPaletteDistance(users, seed) {
    let minimumDistance = Infinity;
    const hues = users.map(user => {
        const match = UserColor(user.name, seed).match(/^hsl\((\d+)/);
        if (!match) throw new Error(`Could not read generated color for "${user.name}".`);
        return Number(match[1]);
    });

    for (let i = 0; i < hues.length; i++)
        for (let j = i + 1; j < hues.length; j++) {
            const difference = Math.abs(hues[i] - hues[j]);
            minimumDistance = Math.min(minimumDistance, Math.min(difference, 360 - difference));
        }

    return minimumDistance;
}
