import { $Create } from "../helpers/DOM.js";

import { Text } from "../helpers/text.js";
import { Ratio, Sum } from "../helpers/math.js";

import { GetContributionsURL, GetGlobalContributionsURL } from "../helpers/wiki-urls.js";

const daysOfWeek = [ "Mo", "Tu", "We", "Th", "Fr", "Sa", "Su" ];
const fullDaysOfWeek = [ "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" ];
const hoursOfDay = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

const NumberFormatter = new Intl.NumberFormat();

const $$tooltips = new Map();
const AddTooltip = (function($cell, title, content) {
    let $tooltip;
    const show = (() => {
        if (!$tooltip) {
            $tooltip = $Create(
                "div",
                {
                    className: "timecard-tooltip hidden"
                },
                [
                    $Create("div", { className: "tooltip-title" }, title),
                    $Create("div", { className: "tooltip-content" }, content)
                ]
            );
            $cell.closest(".timecard-page").append($tooltip);
        }

        PositionTooltip($tooltip, $cell);
        $$tooltips.set($tooltip, $cell);

        $tooltip.classList.remove("hidden");
        $tooltip.ontransitionend = null;
    });

    const hide = (() => {
        if (!$tooltip) return;

        $tooltip.classList.add("hidden");
        $tooltip.ontransitionend = () => {
            $$tooltips.delete($tooltip);
            $tooltip.remove();
            $tooltip = null;
        };
    });

    $cell.tabIndex = 0;
    $cell.addEventListener("mouseenter", show);
    $cell.addEventListener("focus", show);
    $cell.addEventListener("mouseleave", hide);
    $cell.addEventListener("blur", hide);
});

const PositionTooltip = (function($tooltip, $cell) {
    const rect = $cell.getBoundingClientRect();
    $tooltip.style.left = `${rect.left + rect.width / 2}px`;
    $tooltip.style.top = `calc(${rect.top}px - 0.5rem)`;
});

window.addEventListener("resize", () => {
    for (const [ $tooltip, $cell ] of $$tooltips)
        PositionTooltip($tooltip, $cell);
});

export const RenderTimecards = (function($content, data) {
    return $Create(
        "div",
        {
            className: "timecard-page",
        },
        data.map(user => {
            const days = Array.from({ length: 7 }, () => Array(24).fill(0));
            for (const project of user.projects)
                for (const edit of project.edits) {
                    const timestamp = new Date(edit.timestamp);
                    if (Number.isNaN(timestamp.getTime())) continue;
                    days[(timestamp.getUTCDay() + 6) % 7][timestamp.getUTCHours()]++;
                }

            const hours = Array.from({ length: 24 }, (_, hour) => Sum(days.map(day => day[hour])));

            const dayTotals = days.map(Sum);
            const total = Sum(hours);

            const maxCell = Math.max(0, ...days.flat());
            const maxDay = Math.max(0, ...dayTotals);
            const maxHour = Math.max(0, ...hours);

            return $Create(
                "section",
                {
                    className: "timecard"
                },
                [
                    $Create(
                        "a",
                        {
                            className: "timecard-caption",
                            href: user.home ? GetContributionsURL(user.home, user.name) : GetGlobalContributionsURL(user.name),
                            target: "_blank",
                            rel: "noopener noreferrer",
                            title: user.home
                                ? `Open ${user.name}'s home contibutions`
                                : `Open ${user.name}'s global contributions`
                        },
                        user.name
                    ),
                    $Create(
                        "div",
                        {
                            className: "timecard-table",
                            role: "group",
                            "aria-label": `${user.name} edit activity by day and hour`
                        },
                        [
                            $Create("div"),
                            ...hoursOfDay.map(label => $Create("div", { className: "hour-label", "aria-hidden": "true" }, label)),
                            $Create("div", { className: "spacer" }),
                            $Create("div"),
                            ...days.flatMap((day, di) => {
                                const count = dayTotals[di];

                                const percent = `${(count / total * 100 || 0).toFixed(2)}%`;
                                return [
                                    $Create("div", { className: "day-label" }, daysOfWeek[di]),
                                    ...day.map((count, hi) => {
                                        const percent = `${(count / total * 100 || 0).toFixed(2)}%`;
                                        return $Create(
                                            "div",
                                            {
                                                className: `cell ${count === 0 ? "empty" : ""}`,
                                                "aria-label": `${fullDaysOfWeek[di]}, ${hoursOfDay[hi]}:00 to ${hoursOfDay[hi]}:59, ${Text.label("edit", count)}, ${percent} of edits`,
                                                style: {
                                                    "--value": Ratio(count, maxCell)
                                                }
                                            },
                                            undefined,
                                            undefined,
                                            $self => count > 0
                                                ?
                                                    AddTooltip(
                                                        $self,
                                                        `${fullDaysOfWeek[di]}, ${hoursOfDay[hi]}:00–${hoursOfDay[hi]}:59`,
                                                        `${Text.label("edit", count, null, NumberFormatter)} (${percent})`
                                                    )
                                                : 0
                                        );
                                    }),
                                    $Create("div", { className: "spacer" }),
                                    $Create(
                                        "div",
                                        {
                                            className: `cell summary-cell day-total ${count === 0 ? "empty" : ""}`,
                                            "aria-label": `${fullDaysOfWeek[di]}, ${Text.label("edit", count)}, ${percent} of edits`,
                                            style: {
                                                "--value": Ratio(count, maxDay)
                                            }
                                        },
                                        undefined,
                                        undefined,
                                        $self => count > 0
                                            ? AddTooltip($self, `${fullDaysOfWeek[di]}`, `${Text.label("edit", count, null, NumberFormatter)} (${percent})`)
                                            : 0
                                    )
                                ];
                            }),
                            ...Array.from({ length: 27 }, () => $Create("div", { className: "spacer" })),
                            $Create("div"),
                            ...hours.map((count, hi) => {
                                const percent = `${(count / total * 100 || 0).toFixed(2)}%`;
                                return $Create(
                                    "div",
                                    {
                                        className: `cell summary-cell hour-total ${count === 0 ? "empty" : ""}`,
                                        "aria-label": `${hoursOfDay[hi]}:00 to ${hoursOfDay[hi]}:59, ${Text.label("edit", count)}, ${percent} of edits`,
                                        style: {
                                            "--value": Ratio(count, maxHour)
                                        }
                                    },
                                    undefined,
                                    undefined,
                                    $self => count > 0
                                        ? AddTooltip($self, `${hoursOfDay[hi]}:00–${hoursOfDay[hi]}:59`, `${Text.label("edit", count, null, NumberFormatter)} (${percent})`)
                                        : 0
                                );
                            }),
                            $Create("div", { className: "spacer" }),
                            $Create("div")
                        ]
                    )
                ]
            );
        })
    );
});