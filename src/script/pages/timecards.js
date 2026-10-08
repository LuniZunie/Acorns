import { $ } from "../helpers/query-selector.js";
import { Text } from "../helpers/text.js";

const daysOfWeek = [ "Mo", "Tu", "We", "Th", "Fr", "Sa", "Su" ];
const fullDaysOfWeek = [ "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" ];
const hoursOfDay = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const trailingSpacers = 27;

const numberFormatter = new Intl.NumberFormat();

const $$tooltips = new Map();

const sum = values => values.reduce((total, value) => total + value, 0);
const ratio = (value, max) => max === 0 ? 0 : value / max;
const percentage = (value, total) => total === 0 ? "0.00" : (value / total * 100).toFixed(2);
const hourRange = hour => `${hoursOfDay[hour]}:00 - ${hoursOfDay[hour]}:59`;

function create(tag, className, textContent) {
    const $element = document.createElement(tag);
    if (className) $element.className = className;
    if (textContent !== undefined) $element.textContent = textContent;
    return $element;
}

function positionTooltip($tooltip, $cell) {
    const rect = $cell.getBoundingClientRect();
    $tooltip.style.left = `${rect.left + rect.width / 2}px`;
    $tooltip.style.top = `calc(${rect.top}px - 0.5rem)`;
}

window.addEventListener("resize", () => {
    for (const [ $tooltip, $cell ] of $$tooltips)
        positionTooltip($tooltip, $cell);
});

export function RenderTimecards(data) {
    const $page = create("div", "timecard-page");
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

    const hours = Array.from({ length: 24 }, (_, hour) => sum(days.map(day => day[hour])));
    const dayTotals = days.map(sum);

    return {
        days,
        hours,
        dayTotals,
        total: sum(hours),
        maxHour: Math.max(0, ...days.flat()),
        maxDay: Math.max(0, ...dayTotals),
        maxTotalHour: Math.max(0, ...hours)
    };
}

function renderTimecard($page, caption, data) {
    const $timecard = create("section", "timecard");
    $page.appendChild($timecard);

    $timecard.appendChild(create("h2", "timecard-caption", caption));

    const $table = create("div", "timecard-table");
    $table.setAttribute("role", "group");
    $table.setAttribute("aria-label", `${caption} edit activity by day and hour`);
    $timecard.appendChild($table);

    addCell($table, "corner");
    for (const label of hoursOfDay)
        addCell($table, "hour-label", label).setAttribute("aria-hidden", "true");
    addCell($table, "spacer");
    addCell($table);

    for (const [ dayIndex, day ] of data.days.entries()) {
        addCell($table, "day-label", daysOfWeek[dayIndex]);

        for (const [ hourIndex, count ] of day.entries()) {
            const $cell = addCell($table, `cell${count === 0 ? " empty" : ""}`);
            $cell.style.setProperty("--value", ratio(count, data.maxHour));
            if (count > 0)
                describeCell($cell, `${fullDaysOfWeek[dayIndex]}, ${hourRange(hourIndex)}`, count, data.total);
        }

        addCell($table, "spacer");
        addSummaryCell($table, "day-total", data.dayTotals[dayIndex], data.maxDay, data.total, fullDaysOfWeek[dayIndex]);
    }

    for (let i = 0; i < trailingSpacers; i++)
        addCell($table, "spacer");

    addCell($table);
    for (const [ hourIndex, count ] of data.hours.entries())
        addSummaryCell($table, "hour-total", count, data.maxTotalHour, data.total, hourRange(hourIndex));
    addCell($table, "spacer");
    addCell($table);
}

function addSummaryCell($table, className, count, max, total, label) {
    const $cell = addCell($table, `cell summary-cell ${className}${count === 0 ? " empty" : ""}`);
    $cell.style.setProperty("--value", ratio(count, max));
    if (count > 0) describeCell($cell, label, count, total);
    return $cell;
}

function describeCell($cell, label, count, total) {
    const percent = percentage(count, total);
    const text = Text.pluralize("edit", count);

    addTooltip($cell, label, `${numberFormatter.format(count)} ${text} (${percent}%)`);
    $cell.setAttribute("aria-label", `${label.replace(" - ", " to ")}, ${count} ${text}, ${percent}%`);
}

function addCell($table, className = "", text = "") {
    const $cell = create("div", className, text);
    $table.appendChild($cell);
    return $cell;
}

function addTooltip($cell, title, content) {
    let $tooltip;

    const show = () => {
        if (!$tooltip) {
            $tooltip = create("div", "timecard-tooltip hidden");
            $tooltip.append(
                create("div", "tooltip-title", title),
                create("div", "tooltip-content", content)
            );
            $cell.closest(".timecard-page").appendChild($tooltip);
        }

        positionTooltip($tooltip, $cell);
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