import { $ } from "../helpers/query-selector.js";
import { Text } from "../helpers/text.js";
import { Time } from "../helpers/time.js";
import {
    SetUserColorSeed,
    StateUserColorSeed,
    UserColor
} from "../helpers/username-to-color.js";
import { PickColorSeed } from "../helpers/pick-color-seed.js";
import {
    GetContributionsURL,
    GetDiffURL,
    GetGlobalContributionsURL,
    GetLogURL,
    GetOrigin,
    GetPageURL
} from "../helpers/wiki-urls.js";

const longGap = Time.minutes(30);
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

const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC"
});
const numberFormatter = new Intl.NumberFormat();

const hiddenUsers = new Set();

const startOfDay = timestamp => Math.floor(timestamp / Time.days(1)) * Time.days(1);
const formatDate = timestamp => dateFormatter.format(new Date(timestamp));

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

export function RenderTimeline(data, requestedDate) {
    const dates = createTimelineDates(data);
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const $scrollContainer = $("#tab-content");

    const homes = new Map(data.map(user => [ String(user.user), user.home ]));
    const users = Array.from(homes, ([ name, home ]) => ({
        name,
        home,
        color: UserColor(name),
        visible: !hiddenUsers.has(name)
    }));
    const usersByName = new Map(users.map(user => [ user.name, user ]));

    const $page = create("section", "edit-timeline-page");
    $page.setAttribute("aria-label", "User activity timeline");

    const $legend = createTimelineLegend(users, ({ name, visible }) => {
        if (visible) hiddenUsers.delete(name);
        else hiddenUsers.add(name);
        updateVisibleEntries();
    });
    $legend.querySelector(".edit-timeline-refresh-colors").addEventListener("click", refreshColors);
    $page.appendChild($legend);

    const $list = create("div", "edit-timeline-days");
    $list.setAttribute("aria-label", "Activity by date");
    $page.appendChild($list);

    const $$dateSections = dates.map(({ date }, index) => {
        if (index > 0) {
            const skippedDays = (date - dates[index - 1].date) / Time.days(1) - 1;
            if (skippedDays > 0) $list.appendChild(createDateGap(skippedDays));
        }

        const $section = create("section", "edit-timeline-day");
        $section.dataset.dateIndex = String(index);
        $section.setAttribute("aria-label", formatDate(date));
        $list.appendChild($section);
        return $section;
    });
    updateDateLayout();

    const $scrollTail = create("div", "edit-timeline-scroll-tail");
    $scrollTail.setAttribute("aria-hidden", "true");
    $list.appendChild($scrollTail);

    const $navigation = create("nav", "edit-timeline-navigation");
    $navigation.setAttribute("aria-label", "Choose a date");
    $navigation.hidden = dates.length === 0;
    $page.appendChild($navigation);

    const $$dateButtons = new Map();
    const loadedDays = new Set();
    let selectedIndex = Math.max(0, findDateIndex(dates, requestedDate ?? self.rememberedDate));
    let scrollSettleTimeout = 0;
    let programmaticScrollTarget = null;

    $page.goToDate = (date, { instant = false } = { }) => {
        const index = findDateIndex(dates, date);
        if (index < 0) return false;
        navigateToDate(index, instant);
        return true;
    };

    $scrollContainer.scrollTop = 0;
    $scrollContainer.appendChild($page);

    if (dates.length === 0) {
        const $empty = create("p", "edit-timeline-empty", "No activity to display for these users and projects.");
        $empty.setAttribute("role", "status");
        $list.appendChild($empty);
    } else {
        saveSelectedDate();
        $scrollContainer.scrollTop = getFirstSectionTop() + dates[selectedIndex].offset;
        updateScrollTail();
        updateLoadedDays();
        updateNavigation();
        attachListeners();
    }

    function refreshColors() {
        SetUserColorSeed(PickColorSeed(users));
        StateUserColorSeed();

        for (const user of users) user.color = UserColor(user.name);
        for (const $swatch of $legend.querySelectorAll(".edit-timeline-swatch"))
            $swatch.style.setProperty("--user-color", usersByName.get($swatch.dataset.username).color);
        for (const $entry of $page.querySelectorAll(".edit-timeline-entry"))
            $entry.style.setProperty("--user-color", UserColor($entry.dataset.username));

        const $icon = $legend.querySelector(".edit-timeline-refresh-icon");
        $icon.classList.remove("rotating");
        void $icon.offsetWidth;
        $icon.classList.add("rotating");
    }

    function getVisibleEntries(index) {
        return dates[index].entries.filter(entry => !hiddenUsers.has(entry.username));
    }

    function getFirstSectionTop() {
        return $$dateSections[0].getBoundingClientRect().top
            - $scrollContainer.getBoundingClientRect().top
            + $scrollContainer.scrollTop;
    }

    function updateDateLayout() {
        let offset = 0;
        dates.forEach((day, index) => {
            if (index > 0 && day.date - dates[index - 1].date > Time.days(1))
                offset += DATE_GAP_HEIGHT * rem;

            const entries = getVisibleEntries(index);
            const height = (
                DAY_HEADER_HEIGHT +
                entries.length * ENTRY_HEIGHT +
                countLongGaps(entries) * GAP_HEIGHT
            ) * rem + 1;

            day.offset = offset;
            day.height = height;
            $$dateSections[index].style.height = `${height}px`;
            offset += height;
        });
    }

    function updateScrollTail() {
        const lastDateHeight = dates.at(-1)?.height ?? 0;
        $scrollTail.style.height = `${Math.max(0, $scrollContainer.clientHeight - lastDateHeight)}px`;
    }

    function updateVisibleEntries() {
        if (dates.length === 0) return;

        const firstSectionTop = getFirstSectionTop();
        const offsetWithinDate = $scrollContainer.scrollTop - firstSectionTop - dates[selectedIndex].offset;

        updateDateLayout();
        for (const index of loadedDays) renderDay(index);

        const clamped = Math.min(Math.max(0, offsetWithinDate), dates[selectedIndex].height - 1);
        $scrollContainer.scrollTop = firstSectionTop + dates[selectedIndex].offset + clamped;
        updateScrollTail();
        updateLoadedDays();
    }

    function renderDay(index) {
        const $section = $$dateSections[index];
        $section.replaceChildren(create("h2", "edit-timeline-date", formatDate(dates[index].date)));

        let previousTimestamp;
        for (const entry of getVisibleEntries(index)) {
            if (previousTimestamp !== undefined && entry.timestamp - previousTimestamp > longGap)
                $section.appendChild(createGap(entry.timestamp - previousTimestamp));
            $section.appendChild(createEntry(entry));
            previousTimestamp = entry.timestamp;
        }
    }

    function addIndexRange(set, from, to) {
        for (let index = Math.max(0, from); index <= Math.min(dates.length - 1, to); index++)
            set.add(index);
    }

    function updateLoadedDays() {
        const next = new Set();
        addIndexRange(next, selectedIndex - 2, selectedIndex + 2);

        if (dates.length > 0 && $page.isConnected) {
            const viewportStart = Math.max(0, $scrollContainer.scrollTop - getFirstSectionTop());
            const viewportEnd = viewportStart + $scrollContainer.clientHeight;
            addIndexRange(next, findDateAtOffset(viewportStart) - 1, findDateAtOffset(viewportEnd) + 1);
        }

        for (const index of next)
            if (!loadedDays.has(index)) renderDay(index);
        for (const index of loadedDays)
            if (!next.has(index)) $$dateSections[index].replaceChildren();

        loadedDays.clear();
        for (const index of next) loadedDays.add(index);
    }

    function findDateAtOffset(offset) {
        let low = 0;
        let high = dates.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (dates[middle].offset + dates[middle].height <= offset) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    function updateNavigation() {
        const visible = new Set();
        addIndexRange(visible, selectedIndex - 2, selectedIndex + 2);

        for (const index of visible) {
            let $button = $$dateButtons.get(index);
            if (!$button) {
                $button = create("button");
                $button.type = "button";
                $button.addEventListener("click", () => navigateToDate(index));
                $$dateButtons.set(index, $button);
            }

            const label = formatDate(dates[index].date);
            $button.className = `edit-timeline-date-button position-${index - selectedIndex + 2}`;
            $button.textContent = label;
            $button.setAttribute("aria-current", index === selectedIndex ? "date" : "false");
            $button.setAttribute("aria-label", `Show ${label}`);
            $navigation.appendChild($button);
        }

        for (const [ index, $button ] of $$dateButtons) {
            if (visible.has(index)) continue;
            $button.remove();
            $$dateButtons.delete(index);
        }
    }

    function selectDate(index) {
        if (index < 0 || index >= dates.length || index === selectedIndex) return;
        selectedIndex = index;
        saveSelectedDate();
        updateLoadedDays();
        updateNavigation();
    }

    function navigateToDate(index, instant = false) {
        if (index < 0 || index >= dates.length) return;
        selectDate(index);

        const top = getFirstSectionTop() + dates[index].offset;
        if (instant) {
            clearTimeout(scrollSettleTimeout);
            programmaticScrollTarget = null;
            $scrollContainer.scrollTop = top;
            updateDateFromScroll();
            return;
        }

        programmaticScrollTarget = index;
        $scrollContainer.scrollTo({
            top,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
        });
        scheduleScrollSettle();
    }

    function scheduleScrollSettle() {
        clearTimeout(scrollSettleTimeout);
        scrollSettleTimeout = setTimeout(() => {
            programmaticScrollTarget = null;
            if ($page.isConnected) updateDateFromScroll();
        }, SCROLL_SETTLE_DELAY);
    }

    function updateDateFromScroll() {
        const offset = $scrollContainer.scrollTop + SCROLL_ANCHOR_OFFSET - getFirstSectionTop();
        selectDate(findDateAtOffset(offset));
        updateLoadedDays();
    }

    function saveSelectedDate() {
        self.rememberedDate = new Date(dates[selectedIndex].date).toISOString().slice(0, 10);
        const state = window.history.state ?? { };
        state.data = self.rememberedDate;
        window.history.replaceState(state, "");
    }

    function attachListeners() {
        let scrollFrame = 0;
        const controller = new AbortController();
        const { signal } = controller;

        const removalObserver = new MutationObserver(() => {
            if ($page.isConnected) return;
            controller.abort();
            if (scrollFrame) cancelAnimationFrame(scrollFrame);
            clearTimeout(scrollSettleTimeout);
            removalObserver.disconnect();
        });
        removalObserver.observe($scrollContainer, { childList: true });

        $scrollContainer.addEventListener("scroll", () => {
            if (scrollFrame) return;
            scrollFrame = requestAnimationFrame(() => {
                scrollFrame = 0;
                if (!$page.isConnected) return;

                updateLoadedDays();
                if (programmaticScrollTarget !== null) scheduleScrollSettle();
                else updateDateFromScroll();
            });
        }, { passive: true, signal });

        window.addEventListener("resize", () => {
            updateScrollTail();
            updateLoadedDays();
        }, { passive: true, signal });

        $navigation.addEventListener("wheel", event => {
            if (event.deltaY === 0) return;
            event.preventDefault();
            if (programmaticScrollTarget === null)
                navigateToDate(selectedIndex + Math.sign(event.deltaY));
        }, { passive: false });

        $navigation.addEventListener("keydown", event => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            navigateToDate(selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
        });
    }
}

function findDateIndex(dates, date) {
    const timestamp = new Date(date).getTime();
    if (!Number.isFinite(timestamp)) return -1;

    const day = startOfDay(timestamp);
    return dates.findIndex(entry => entry.date === day);
}

function updateSwatch($swatch, user) {
    const label = `${user.visible ? "Hide" : "Show"} ${user.name}`;
    $swatch.classList.toggle("is-hidden", !user.visible);
    $swatch.setAttribute("aria-pressed", String(user.visible));
    $swatch.setAttribute("aria-label", label);
    $swatch.title = label;
}

function createTimelineLegend(users, onToggle) {
    const $legend = create("aside", "edit-timeline-legend");
    $legend.setAttribute("aria-label", "Filter accounts");
    $legend.hidden = users.length === 0;

    const $list = create("ul", "edit-timeline-legend-list");
    $legend.append(create("h2", "edit-timeline-legend-title", "Accounts"), $list);

    for (const user of users) {
        const $swatch = create("button", "edit-timeline-swatch");
        $swatch.type = "button";
        $swatch.style.setProperty("--user-color", user.color);
        $swatch.dataset.username = user.name;
        updateSwatch($swatch, user);
        $swatch.addEventListener("click", () => {
            user.visible = !user.visible;
            updateSwatch($swatch, user);
            onToggle(user);
        });

        const $username = createLink(
            "edit-timeline-legend-username",
            user.home ? GetContributionsURL(user.home, user.name) : GetGlobalContributionsURL(user.name),
            user.name,
            user.home
                ? `View ${user.name}'s contributions on their home wiki`
                : `View ${user.name}'s global contributions`
        );

        const $item = create("li", "edit-timeline-legend-item");
        $item.append($swatch, $username);
        $list.appendChild($item);
    }

    const $icon = create("span", "edit-timeline-refresh-icon", "\u21bb");
    $icon.setAttribute("aria-hidden", "true");

    const $refresh = create("button", "edit-timeline-refresh-colors");
    $refresh.type = "button";
    $refresh.setAttribute("aria-label", "New colors");
    $refresh.append($icon, document.createTextNode("New colors"));
    $legend.appendChild($refresh);

    return $legend;
}

const getBlockLabel = (unblock, reblock, scope) => `${scope} ${unblock ? "unblock" : reblock ? "reblock" : "block"}`;

function getLockLabel({ params }) {
    if (params?.added?.includes("locked") || params?.["0"] === "locked") return "Lock";
    if (params?.removed?.includes("locked") || params?.["1"] === "locked") return "Unlock";
    return "Lock status change";
}

function createTimelineDates(data) {
    const entriesByDate = new Map();

    const addEntry = (username, project, entry) => {
        const timestamp = new Date(entry.timestamp).getTime();
        if (!Number.isFinite(timestamp)) return;

        const date = startOfDay(timestamp);
        if (!entriesByDate.has(date)) entriesByDate.set(date, [ ]);
        entriesByDate.get(date).push({
            ...entry,
            username,
            project,
            timestamp,
            timestampText: entry.timestamp
        });
    };

    const META = "meta.wikimedia.org";

    for (const user of data) {
        const username = String(user.user);

        if (user.registration?.timestamp)
            addEntry(username, META, {
                timestamp: user.registration.timestamp,
                kind: "global-registration",
                label: "Global registration",
                title: `User:${username}`
            });

        for (const project of user.projects || [ ]) {
            if (project.registration?.timestamp)
                addEntry(username, project.project, {
                    timestamp: project.registration.timestamp,
                    kind: "local-registration",
                    label: "Local registration",
                    title: `User:${username}`
                });
            for (const edit of project.edits || [ ])
                addEntry(username, project.project, { ...edit, kind: "edit" });
            for (const block of project.blocks || [ ])
                addEntry(username, project.project, {
                    ...block,
                    kind: "local-block",
                    label: getBlockLabel(block.unblock, block.reblock, "Local")
                });
        }

        for (const block of user.blocks || [ ])
            addEntry(username, META, {
                ...block,
                kind: "global-block",
                label: getBlockLabel(block.unblock, block.reblock, "Global")
            });
        for (const lock of user.locks || [ ])
            addEntry(username, META, { ...lock, kind: "lock", label: getLockLabel(lock) });
        for (const upload of user.uploads || [ ])
            addEntry(username, "commons.wikimedia.org", { ...upload, kind: "upload", label: "File upload" });
    }

    const entryId = entry => String(entry.revid ?? entry.logid ?? "");

    return Array.from(entriesByDate)
        .sort(([ a ], [ b ]) => a - b)
        .map(([ date, entries ]) => ({
            date,
            entries: entries.sort((a, b) =>
                a.timestamp - b.timestamp ||
                entryKindOrder.get(a.kind) - entryKindOrder.get(b.kind) ||
                a.username.localeCompare(b.username) ||
                entryId(a).localeCompare(entryId(b))
            )
        }));
}

function countLongGaps(entries) {
    let gaps = 0;
    for (let index = 1; index < entries.length; index++)
        if (entries[index].timestamp - entries[index - 1].timestamp > longGap) gaps++;
    return gaps;
}

function createEntry(entry) {
    const { project, username } = entry;

    const $article = create("article", `edit-timeline-entry edit-timeline-entry--${entry.kind}`);
    $article.dataset.username = username;
    $article.style.setProperty("--user-color", UserColor(username));

    const $time = create("time");
    $time.dateTime = entry.timestampText;
    $time.textContent = `${timeFormatter.format(new Date(entry.timestamp))} UTC`;

    let $timestamp;
    if (entry.kind === "edit") {
        $timestamp = createLink("edit-timeline-timestamp", GetDiffURL(project, entry.revid, entry.parentid), undefined, entry.timestampText);
    } else if (entry.logid !== undefined) {
        $timestamp = createLink("edit-timeline-timestamp", GetLogURL(project, entry.logid), undefined, `View ${entry.label.toLowerCase()} log entry`);
    } else {
        $timestamp = create("span", "edit-timeline-timestamp");
        $timestamp.title = entry.timestampText;
    }
    $timestamp.appendChild($time);

    const $meta = create("div", "edit-timeline-meta");
    $meta.append(
        $timestamp,
        createLink("edit-timeline-username", GetContributionsURL(project, username), username)
    );

    const title = entry.title || entry.label || "Activity";
    const $separator = create("span", "edit-timeline-project-separator");
    $separator.setAttribute("aria-hidden", "true");

    const $pageDetails = create("div", "edit-timeline-page-links");
    $pageDetails.append(
        create("span", "edit-timeline-kind", entry.label || "Edit"),
        createLink("edit-timeline-project", GetOrigin(project), project),
        $separator,
        createLink("edit-timeline-title", GetPageURL(project, title), title, title)
    );

    $article.append($meta, $pageDetails);
    return $article;
}

function createGap(duration) {
    const $gap = create("div", "edit-timeline-gap");
    $gap.setAttribute("aria-label", `${formatDuration(duration)} between edits`);
    $gap.appendChild(create("span", undefined, formatDuration(duration)));
    return $gap;
}

function createDateGap(skippedDays) {
    const unit = Text.pluralize("day", skippedDays);

    const $gap = create("div", "edit-timeline-date-gap");
    $gap.setAttribute("aria-label", `${skippedDays} ${unit} without edits`);
    $gap.appendChild(create("span", undefined, `${numberFormatter.format(skippedDays)} ${unit} skipped`));
    return $gap;
}

function formatDuration(duration) {
    const totalMinutes = Math.floor(duration / Time.minutes(1));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;

    const parts = [ ];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || parts.length === 0) parts.push(`${minutes}m`);
    return parts.join(" ");
}