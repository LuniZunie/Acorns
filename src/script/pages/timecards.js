import { $ } from "../helpers/query-selector.js";
import { Text } from "../helpers/text.js";

const daysOfWeek = [ "Mo", "Tu", "We", "Th", "Fr", "Sa", "Su" ];
const fullDaysOfWeek = [ "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" ];
const hoursOfDay = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

const numberFormatter = new Intl.NumberFormat("en-US");

const $$tooltips = new Map();
window.addEventListener("resize", () => {
    for (const [ $tooltip, $cell ] of $$tooltips) {
        const rect = $cell.getBoundingClientRect();
        $tooltip.style.left = `${rect.left + rect.width / 2}px`;
        $tooltip.style.top = `calc(${rect.top}px - 0.5rem)`;
    }
});

export function RenderTimecards(data) {
    const $page = document.createElement("div");
    $page.classList.add("timecard-page");
    $("#tab-content").appendChild($page);

    for (const user of data)
        renderTimecard($page, user.user, createTimecard(user));
}

function createTimecard(user) {
    const days = Array.from({ length: 7 }, () => Array(24).fill(0));

    for (const project of user.projects)
        for (const edit of project.edits) {
            const timestamp = new Date(edit.timestamp);
            if (Number.isNaN(timestamp.getTime())) continue;
            const day = (timestamp.getUTCDay() + 6) % 7;
            days[day][timestamp.getUTCHours()]++;
        }

    const hours = Array.from({ length: 24 }, (_, hour) => days.reduce((total, day) => total + day[hour], 0));
    const dayTotals = days.map(day => day.reduce((total, count) => total + count, 0));
    const total = hours.reduce((sum, count) => sum + count, 0);

    return {
        days,
        hours,
        dayTotals,
        total,
        maxHour: Math.max(0, ...days.flat()),
        maxDay: Math.max(0, ...dayTotals),
        maxTotalHour: Math.max(0, ...hours)
    };
}

function renderTimecard($page, caption, data) {
    const $timecard = document.createElement("section");
    $timecard.classList.add("timecard");
    $page.appendChild($timecard);

    const $caption = document.createElement("h2");
    $caption.classList.add("timecard-caption");
    $caption.textContent = caption;
    $timecard.appendChild($caption);

    const $table = document.createElement("div");
    $table.classList.add("timecard-table");
    $table.setAttribute("role", "group");
    $table.setAttribute("aria-label", `${caption} edit activity by day and hour`);
    $timecard.appendChild($table);

    addCell($table, "corner", "");
    for (const [ hour, label ] of hoursOfDay.entries()) {
        const $label = addCell($table, "hour-label", label);
        $label.setAttribute("aria-hidden", "true");
    }
    addCell($table, "spacer", "");
    addCell($table, "", "");

    for (const [ dayIndex, day ] of data.days.entries()) {
        addCell($table, "day-label", daysOfWeek[dayIndex]);

        for (const [ hourIndex, count ] of day.entries()) {
            const $cell = addCell($table, `cell${count === 0 ? " empty" : ""}`, "");
            $cell.style.setProperty("--value", ratio(count, data.maxHour));
            if (count > 0) {
                const hourLabel = hoursOfDay[hourIndex];
                const percent = percentage(count, data.total);
                const text = new Text("edit").get(count);
                addTooltip($cell, `${fullDaysOfWeek[dayIndex]}, ${hourLabel}:00 - ${hourLabel}:59`, `${numberFormatter.format(count)} ${text} (${percent}%)`);
                $cell.setAttribute("aria-label", `${fullDaysOfWeek[dayIndex]}, ${hourLabel}:00 to ${hourLabel}:59, ${count} ${text}, ${percent}%`);
            }
        }

        addCell($table, "spacer", "");
        addSummaryCell($table, "day-total", data.dayTotals[dayIndex], data.maxDay, data.total, fullDaysOfWeek[dayIndex]);
    }

    for (let i = 0; i < 27; i++)
        addCell($table, "spacer", "");

    addCell($table, "", "");
    for (const [ hourIndex, count ] of data.hours.entries())
        addSummaryCell($table, "hour-total", count, data.maxTotalHour, data.total, `${hoursOfDay[hourIndex]}:00 - ${hoursOfDay[hourIndex]}:59`);
    addCell($table, "spacer", "");
    addCell($table, "", "");
}

function addSummaryCell($table, className, count, max, total, label) {
    const $cell = addCell($table, `cell summary-cell ${className}${count === 0 ? " empty" : ""}`, "");
    $cell.style.setProperty("--value", ratio(count, max));
    if (count > 0) {
        const percent = percentage(count, total);
        const text = new Text("edit").get(count);
        addTooltip($cell, label, `${numberFormatter.format(count)} ${text} (${percent}%)`);
        $cell.setAttribute("aria-label", `${label}, ${count} ${text}, ${percent}%`);
    }
    return $cell;
}

function addCell($table, className, text) {
    const $cell = document.createElement("div");
    $cell.className = className;
    $cell.textContent = text;
    $table.appendChild($cell);
    return $cell;
}

function ratio(value, max) {
    return max === 0 ? 0 : value / max;
}

function percentage(value, total) {
    return total === 0 ? "0.00" : (value / total * 100).toFixed(2);
}

function addTooltip($cell, title, content) {
    let $tooltip;

    const show = () => {
        if (!$tooltip) {
            $tooltip = document.createElement("div");
            $tooltip.classList.add("timecard-tooltip", "hidden");
            $cell.closest(".timecard-page").appendChild($tooltip);

            const $title = document.createElement("div");
            $title.classList.add("tooltip-title");
            $title.textContent = title;
            $tooltip.appendChild($title);

            const $text = document.createElement("div");
            $text.classList.add("tooltip-content");
            $text.textContent = content;
            $tooltip.appendChild($text);
        }

        const rect = $cell.getBoundingClientRect();
        $tooltip.style.left = `${rect.left + rect.width / 2}px`;
        $tooltip.style.top = `calc(${rect.top}px - 0.5rem)`;
        $$tooltips.set($tooltip, $cell);
        $tooltip.classList.remove("hidden");
        $tooltip.ontransitionend = null;
    };

    const hide = () => {
        if (!$tooltip) return;
        $tooltip.classList.add("hidden");
        $tooltip.ontransitionend = () => {
            $$tooltips.delete($tooltip);
            $tooltip.remove();
            $tooltip = null;
        };
    };

    $cell.tabIndex = 0;
    $cell.addEventListener("mouseenter", show);
    $cell.addEventListener("focus", show);
    $cell.addEventListener("mouseleave", hide);
    $cell.addEventListener("blur", hide);
}
