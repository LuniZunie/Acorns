import { $ } from "../helpers/query-selector.js";
import { Time } from "../helpers/time.js";

const dayLength = 24 * 60 * 60 * 1000;
const longGap = 30 * 60 * 1000;
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

export function RenderTimeline(data, requestedDate) {
    const dates = createTimelineDates(data);
    const $page = document.createElement("section");
    $page.classList.add("edit-timeline-page");
    $page.setAttribute("aria-label", "Edit timeline");

    const $list = document.createElement("div");
    $list.classList.add("edit-timeline-days");
    $list.setAttribute("aria-label", "Edits by date");
    $page.appendChild($list);
    const $scrollContainer = $("#tab-content");

    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    let offset = 0;
    const $$dateSections = dates.map(({ date, edits }, index) => {
        if (index > 0) {
            const skippedDays = (date - dates[index - 1].date) / dayLength - 1;
            if (skippedDays > 0) {
                const $dateGap = createDateGap(skippedDays);
                $list.appendChild($dateGap);
                offset += 2.5 * rem;
            }
        }

        const $section = document.createElement("section");
        $section.classList.add("edit-timeline-day");
        $section.dataset.dateIndex = String(index);
        $section.setAttribute("aria-label", dateFormatter.format(new Date(date)));

        const gapCount = countLongGaps(edits);
        const height = (3 + edits.length * 4 + gapCount * 2) * rem + 1;
        dates[index].offset = offset;
        dates[index].height = height;
        offset += height;
        $section.style.height = `${height}px`;
        $list.appendChild($section);
        return $section;
    });

    const $scrollTail = document.createElement("div");
    $scrollTail.classList.add("edit-timeline-scroll-tail");
    $scrollTail.setAttribute("aria-hidden", "true");
    $list.appendChild($scrollTail);

    const $navigation = document.createElement("nav");
    $navigation.classList.add("edit-timeline-navigation");
    $navigation.setAttribute("aria-label", "Choose a date");
    $page.appendChild($navigation);

    const $$dateButtons = new Map();
    const loadedDays = new Set();
    let selectedIndex = getInitialDateIndex(dates, requestedDate ?? self.rememberedDate);
    let scrollSettleTimeout = 0;
    let programmaticScrollTarget = null;

    function renderDay(index) {
        const $section = $$dateSections[index];
        const { date, edits } = dates[index];
        $section.replaceChildren();

        const $heading = document.createElement("h2");
        $heading.classList.add("edit-timeline-date");
        $heading.textContent = dateFormatter.format(new Date(date));
        $section.appendChild($heading);

        let previousTimestamp;
        for (const entry of edits) {
            if (previousTimestamp !== undefined && entry.timestamp - previousTimestamp > longGap)
                $section.appendChild(createGap(entry.timestamp - previousTimestamp));
            $section.appendChild(createEdit(entry));
            previousTimestamp = entry.timestamp;
        }
    }

    function updateLoadedDays() {
        const nextLoadedDays = new Set();
        for (let index = Math.max(0, selectedIndex - 2); index <= Math.min(dates.length - 1, selectedIndex + 2); index++)
            nextLoadedDays.add(index);

        if (dates.length > 0 && $page.isConnected) {
            const firstSectionTop = $$dateSections[0].getBoundingClientRect().top - $scrollContainer.getBoundingClientRect().top + $scrollContainer.scrollTop;
            const viewportStart = Math.max(0, $scrollContainer.scrollTop - firstSectionTop);
            const viewportEnd = viewportStart + $scrollContainer.clientHeight;
            const firstVisible = findDateAtOffset(viewportStart);
            const lastVisible = findDateAtOffset(viewportEnd);
            for (let index = Math.max(0, firstVisible - 1); index <= Math.min(dates.length - 1, lastVisible + 1); index++)
                nextLoadedDays.add(index);
        }

        for (const index of nextLoadedDays)
            if (!loadedDays.has(index))
                renderDay(index);

        for (const index of loadedDays)
            if (!nextLoadedDays.has(index))
                $$dateSections[index].replaceChildren();

        loadedDays.clear();
        for (const index of nextLoadedDays) loadedDays.add(index);
    }

    function findDateAtOffset(offset) {
        let low = 0;
        let high = dates.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (dates[middle].offset + dates[middle].height <= offset)
                low = middle + 1;
            else high = middle;
        }
        return low;
    }

    function updateNavigation() {
        const first = Math.max(0, selectedIndex - 2);
        const last = Math.min(dates.length - 1, selectedIndex + 2);
        const visible = new Set();

        for (let index = first; index <= last; index++) {
            visible.add(index);
            let $button = $$dateButtons.get(index);
            if (!$button) {
                $button = document.createElement("button");
                $button.type = "button";
                $button.classList.add("edit-timeline-date-button");
                $button.addEventListener("click", () => navigateToDate(index));
                $$dateButtons.set(index, $button);
            }

            const position = index - selectedIndex;
            $button.className = `edit-timeline-date-button position-${position + 2}`;
            $button.textContent = dateFormatter.format(new Date(dates[index].date));
            $button.setAttribute("aria-current", index === selectedIndex ? "date" : "false");
            $button.setAttribute("aria-label", `Show ${dateFormatter.format(new Date(dates[index].date))}`);
            $navigation.appendChild($button);
        }

        for (const [index, $button] of $$dateButtons) {
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
        const firstSectionTop = $$dateSections[0].getBoundingClientRect().top -
            $scrollContainer.getBoundingClientRect().top + $scrollContainer.scrollTop;
        const top = firstSectionTop + dates[index].offset;
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
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
        scheduleScrollSettle();
    }

    function scheduleScrollSettle() {
        clearTimeout(scrollSettleTimeout);
        scrollSettleTimeout = setTimeout(() => {
            programmaticScrollTarget = null;
            if ($page.isConnected) updateDateFromScroll();
        }, 140);
    }

    function goToDate(date, { instant = false } = {}) {
        const index = findDateIndex(dates, date);
        if (index < 0) return false;
        navigateToDate(index, instant);
        return true;
    }

    $page.goToDate = goToDate;
    if (dates.length > 0) saveSelectedDate();

    function updateDateFromScroll() {
        if ($$dateSections.length === 0) return;
        const firstSectionTop = $$dateSections[0].getBoundingClientRect().top -
            $scrollContainer.getBoundingClientRect().top + $scrollContainer.scrollTop;
        const targetOffset = $scrollContainer.scrollTop + 24 - firstSectionTop;
        selectDate(findDateAtOffset(targetOffset));
        updateLoadedDays();
    }

    $scrollContainer.scrollTop = 0;
    $scrollContainer.appendChild($page);
    if (dates.length > 0) {
        const firstSectionTop = $$dateSections[0].getBoundingClientRect().top -
            $scrollContainer.getBoundingClientRect().top + $scrollContainer.scrollTop;
        $scrollContainer.scrollTop = firstSectionTop + dates[selectedIndex].offset;
        updateScrollTail();
    }

    if (dates.length === 0) {
        const $empty = document.createElement("p");
        $empty.classList.add("edit-timeline-empty", "no-edits");
        $empty.textContent = "No edits are available for this editing window.";
        $list.appendChild($empty);
        $navigation.hidden = true;
    } else {
        updateLoadedDays();
        updateNavigation();
        let scrollFrame = 0;
        const scrollController = new AbortController();
        const removalObserver = new MutationObserver(() => {
            if ($page.isConnected) return;
            scrollController.abort();
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
                if (programmaticScrollTarget !== null) {
                    scheduleScrollSettle();
                    return;
                }
                updateDateFromScroll();
            });
        }, { passive: true, signal: scrollController.signal });
        window.addEventListener("resize", () => {
            updateScrollTail();
            updateLoadedDays();
        }, { passive: true, signal: scrollController.signal });

        $navigation.addEventListener("wheel", event => {
            if (event.deltaY === 0) return;
            event.preventDefault();
            if (programmaticScrollTarget !== null) return;
            navigateToDate(selectedIndex + Math.sign(event.deltaY));
        }, { passive: false });
        $navigation.addEventListener("keydown", event => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            navigateToDate(selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
        });
    }

    function saveSelectedDate() {
        const date = dates[selectedIndex].date;
        self.rememberedDate = new Date(date).toISOString().slice(0, 10);
        const state = window.history.state ?? { };
        state.data = self.rememberedDate;
        window.history.replaceState(state, "");
    }

    function updateScrollTail() {
        const lastDateHeight = dates.at(-1)?.height ?? 0;
        $scrollTail.style.height = `${Math.max(0, $scrollContainer.clientHeight - lastDateHeight)}px`;
    }
}

function getInitialDateIndex(dates, requestedDate) {
    if (dates.length === 0) return 0;
    if (requestedDate !== undefined) {
        const index = findDateIndex(dates, requestedDate);
        if (index >= 0) return index;
    }
    return 0;
}

function findDateIndex(dates, date) {
    const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (!Number.isFinite(timestamp)) return -1;
    const targetDate = Math.floor(timestamp / dayLength) * dayLength;
    return dates.findIndex(entry => entry.date === targetDate);
}

function createTimelineDates(data) {
    const editsByDate = new Map();
    for (const user of data)
        for (const project of user.projects)
            for (const edit of project.edits) {
                const timestamp = new Date(edit.timestamp).getTime();
                if (!Number.isFinite(timestamp)) continue;

                const date = Math.floor(timestamp / dayLength) * dayLength;
                let edits = editsByDate.get(date);
                if (!edits) editsByDate.set(date, edits = []);
                edits.push({
                    username: String(user.user),
                    project: project.project,
                    title: edit.title,
                    revid: edit.revid,
                    parentid: edit.parentid,
                    timestamp,
                    timestampText: edit.timestamp
                });
            }

    if (editsByDate.size === 0) return [];

    const dates = [];
    const activeDates = Array.from(editsByDate.keys()).sort((a, b) => a - b);
    for (const date of activeDates) {
        const edits = editsByDate.get(date);
        edits.sort((a, b) =>
            a.timestamp - b.timestamp ||
            a.username.localeCompare(b.username) ||
            String(a.revid).localeCompare(String(b.revid))
        );
        dates.push({ date, edits });
    }

    return dates;
}

function countLongGaps(edits) {
    let gaps = 0;
    for (let index = 1; index < edits.length; index++)
        if (edits[index].timestamp - edits[index - 1].timestamp > longGap)
            gaps++;
    return gaps;
}

function createEdit(entry) {
    const $article = document.createElement("article");
    $article.classList.add("edit-timeline-entry");

    const origin = new URL(`https://${entry.project}`).origin;
    const $meta = document.createElement("div");
    $meta.classList.add("edit-timeline-meta");

    const $timestampLink = document.createElement("a");
    $timestampLink.classList.add("edit-timeline-timestamp");
    const diffURL = new URL("/w/index.php", origin);
    diffURL.searchParams.set("diff", entry.revid);
    diffURL.searchParams.set("oldid", entry.parentid);
    $timestampLink.href = diffURL.href;
    $timestampLink.target = "_blank";
    $timestampLink.rel = "noopener noreferrer";
    $timestampLink.title = entry.timestampText;

    const $time = document.createElement("time");
    $time.dateTime = entry.timestampText;
    $time.textContent = `${timeFormatter.format(new Date(entry.timestamp))} UTC`;
    $timestampLink.appendChild($time);
    $meta.appendChild($timestampLink);

    const $username = document.createElement("a");
    $username.classList.add("edit-timeline-username");
    $username.href = new URL(`/wiki/User:${encodeURIComponent(entry.username.replaceAll(" ", "_"))}`, origin).href;
    $username.target = "_blank";
    $username.rel = "noopener noreferrer";
    $username.textContent = entry.username;
    $meta.appendChild($username);
    $article.appendChild($meta);

    const $projectLink = document.createElement("a");
    $projectLink.classList.add("edit-timeline-project");
    $projectLink.href = origin;
    $projectLink.target = "_blank";
    $projectLink.rel = "noopener noreferrer";
    $projectLink.textContent = entry.project;

    const $pageLink = document.createElement("a");
    $pageLink.classList.add("edit-timeline-title");
    $pageLink.href = new URL(`/wiki/${encodeURIComponent(entry.title.replaceAll(" ", "_"))}`, origin).href;
    $pageLink.target = "_blank";
    $pageLink.rel = "noopener noreferrer";
    $pageLink.title = entry.title;
    $pageLink.textContent = entry.title;

    const $separator = document.createElement("span");
    $separator.classList.add("edit-timeline-project-separator");
    $separator.setAttribute("aria-hidden", "true");

    const $pageDetails = document.createElement("div");
    $pageDetails.classList.add("edit-timeline-page-links");
    $pageDetails.append($projectLink, $separator, $pageLink);
    $article.appendChild($pageDetails);
    return $article;
}

function createGap(duration) {
    const $gap = document.createElement("div");
    $gap.classList.add("edit-timeline-gap");
    $gap.setAttribute("aria-label", `${formatDuration(duration)} between edits`);

    const $label = document.createElement("span");
    $label.textContent = formatDuration(duration);
    $gap.appendChild($label);

    return $gap;
}

function createDateGap(skippedDays) {
    const $gap = document.createElement("div");
    $gap.classList.add("edit-timeline-date-gap");
    $gap.setAttribute("aria-label", `${skippedDays} ${skippedDays === 1 ? "day" : "days"} without edits`);

    const $label = document.createElement("span");
    $label.textContent = `${skippedDays} ${skippedDays === 1 ? "day" : "days"} skipped`;
    $gap.appendChild($label);

    return $gap;
}

function formatDuration(duration) {
    let minutes = Math.floor(duration / Time.minutes(1));

    const days = Math.floor(minutes / (24 * 60));
    minutes %= 24 * 60;

    const hours = Math.floor(minutes / 60);
    minutes %= 60;

    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(" ");
}
