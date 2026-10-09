import { $, $$, $Create, $Text } from "../helpers/DOM.js";

import {
    SetUserColorSeed,
    StateUserColorSeed,
    UserColor,
} from "../helpers/username-to-color.js";
import { PickColorSeed } from "../helpers/pick-color-seed.js";
import { GetContributionsURL, GetGlobalContributionsURL } from "../helpers/wiki-urls.js";

import { Text } from "../helpers/text.js";
import { Weight } from "../helpers/math.js";

const weekdays = [ "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" ];
const MonthFormatter = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });
const DateFormatter = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const NumberFormatter = new Intl.NumberFormat();

const MOBILE_BREAKPOINT = 760;
const MAX_LISTED_EVENTS = 5;
const MAX_HALF_FEATHER_ANGLE = 3;

const hiddenUsers = new Set();

const $$tooltips = new Map();
const AddTooltip = (($cell, title, { edits, events }) => {
    let $tooltip;
    const show = () => {
        if (!$tooltip) {
            $tooltip = $Create(
                "div",
                {
                    className: "calendar-tooltip hidden"
                },
                [
                    $Create("strong", { className: "calendar-tooltip-title" }, title),
                    $Create(
                        "div",
                        {
                            className: "calendar-tooltip-content"
                        },
                        [
                            ...(edits.length ? [ $Create("div", void(0), edits.join("\n")) ] : [ ]),
                            ...(edits.length & events.length ? [ $Create("hr", { className: "calendar-tooltip-divider" }) ] : [ ]),
                            ...(events.length ? [ $Create("div", void(0), events.join("\n")) ] : [ ]),
                        ]
                    )
                ]
            );
            $cell.closest(".calendar-page").append($tooltip);
        }

        PositionTooltip($tooltip, $cell);
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
});
const PositionTooltip = (($tooltip, $cell) => {
    const rect = $cell.getBoundingClientRect();
    $tooltip.style.left = `${rect.left + rect.width / 2}px`;
    $tooltip.style.top = `calc(${rect.top}px - 0.5rem)`;
});

window.addEventListener("resize", () => {
    for (const [ $tooltip, $cell ] of $$tooltips)
        PositionTooltip($tooltip, $cell);
});

const getOrCreate = ((map, key, createValue) => {
    if (!map.has(key)) map.set(key, createValue());
    return map.get(key);
});

const CreateUTCDate = ((year, month, day) => {
    const date = new Date(0);
    date.setUTCFullYear(year, month, day);
    date.setUTCHours(0, 0, 0, 0);
    return date;
});

const getLockLabel = (({ params }) => {
    if (params?.added?.includes("locked") || params?.["0"] === "locked") return "Lock";
    if (params?.removed?.includes("locked") || params?.["1"] === "locked") return "Unlock";
    return "Lock status change";
});

const getCalendarBlockLabel = ((block, scope, local = false) => {
    const action = block.unblock ? "Unblock" : block.reblock ? "Reblock" : "Block";
    return local ? `${action} (${scope})` : `${scope} ${action.toLowerCase()}`;
});

const GetDayBackground = (entries => {
    const length = entries.length;
    switch (length) {
        case 0: return { };
        case 1: return { "--day-color": UserColor(entries[0][1]) };
        default: {
            const edits = [ ], colors = [ ];
            for (let i = 0; i < length; i++) {
                const entry = entries[i];
                edits.push(entry[0]);
                colors.push(UserColor(entry[1]));
            }

            const angles = Weight(edits);
            const halfFeather = Math.min(MAX_HALF_FEATHER_ANGLE, Math.min(...angles) * 90);

            let boundary = 0;
            const stops = [ `${colors[length - 1]} ${-halfFeather}deg, ${colors[0]} ${halfFeather}deg` ];
            for (let i = 1; i < length; i++) {
                boundary += angles[i - 1] * 360;
                stops.push(`${colors[i - 1]} ${boundary - halfFeather}deg, ${colors[i]} ${boundary + halfFeather}deg`);
            }
            stops.push(`${colors[length - 1]} ${360 - halfFeather}deg, ${colors[0]} ${360 + halfFeather}deg`);

            return { backgroundImage: `conic-gradient(from -90deg, ${stops.join(", ")})` };
        } break;
    }
});

function RenderYearPanel(year, users, activity, events, current = false) {
    const visibleUsers = new Set();
    users.forEach(user => user.visible ? visibleUsers.add(user.name) : 0);

    const date = new Date();
    const [ currentYear, currentMonth, currentDay ] = [ date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() ];

    return $Create(
        "div",
        {
            className: `calendar-year-panel ${current ? "current" : ""}`,
            "aria-label": `${year} calendar`,
            dataset: {
                year: year
            }
        },
        Array.from({ length: 12 }, (_, month) => {
            const futureMonth = year > currentYear || year === currentYear && month > currentMonth;
            const monthStart = CreateUTCDate(year, month, 1);
            return $Create(
                "section",
                {
                    className: `calendar-month ${futureMonth ? "future" : ""}`
                },
                [
                    $Create(
                        "div",
                        {
                            className: "calendar-month-heading"
                        },
                        [
                            $Create("h2", { className: "calendar-month-title" }, MonthFormatter.format(monthStart)),
                        ]
                    ),
                    $Create(
                        "div",
                        {
                            className: "calendar-month-grid",
                            role: "group",
                            "aria-label": `${MonthFormatter.format(monthStart)} year`
                        },
                        [
                            ...weekdays.map(weekday => $Create("span", { className: "calendar-weekday", "aria-hidden": "true" }, weekday)),
                            ...Array.from({ length: (monthStart.getUTCDay() + 6) % 7 }, () =>
                                $Create("span", { className: "calendar-day-space", "aria-hidden": "true" })
                            ),
                            ...Array.from({ length: CreateUTCDate(year, month + 1, 0).getUTCDate() }, (_, i) => {
                                const day = i + 1;
                                const futureDay = futureMonth || year === currentYear && month === currentMonth && day > currentDay;
                                const date = CreateUTCDate(year, month, day);

                                const editorsToday = new Map(Array.from(activity?.get(`${month}-${day}`) ?? [ ]).filter(([ name ]) => visibleUsers.has(name)));
                                const eventsToday = (events?.get(`${month}-${day}`) ?? [ ]).filter(event => visibleUsers.has(event.username));
                                if (editorsToday.size | eventsToday.length) {
                                    const names = [ ], colorData = [ ];
                                    const entries = Array.from(users.values()).filter(user => editorsToday.has(user.name)).map(user => {
                                        names.push(user.name);
                                        colorData.push([ editorsToday.get(user.name), user.name ]);
                                        return { ...user, edits: editorsToday.get(user.name) };
                                    });

                                    const editDetails = entries.map(user => `${user.name}: ${Text.label("edit", user.edits, null, NumberFormatter)}`);

                                    let eventDetails = eventsToday.slice().sort((a, b) => a.timestamp - b.timestamp).map(event => `${event.username}: ${event.label}`);
                                    const length = eventDetails.length;
                                    if (length > MAX_LISTED_EVENTS)
                                        eventDetails = eventDetails.slice(0, MAX_LISTED_EVENTS - 1).concat([
                                            `and ${Text.label("other event", length - (MAX_LISTED_EVENTS - 1))}`
                                        ]);

                                    return $Create(
                                        "button",
                                        {
                                            className: `calendar-day active ${entries.length ? "" : "event-only"} ${futureDay ? "future" : ""}`,
                                            type: "button",
                                            "aria-label": editDetails.length | eventDetails.length
                                                ? `${DateFormatter.format(date)}. ${editDetails.concat(eventDetails).join(". ")}`
                                                : DateFormatter.format(date),
                                            dataset: {
                                                colorData: futureDay ? undefined : JSON.stringify(colorData)
                                            },
                                            style: {
                                                ...(futureDay ? { } : GetDayBackground(colorData)),
                                            }
                                        },
                                        eventsToday.length ? [ $Create("span", { className: "calendar-event-marker", "aria-hidden": "true" }, "!") ] : [ ],
                                        [
                                            [ "click", ($self, e) => {
                                                $("#tabs > .tab-button[data-tab=\"timeline\"]")?.click();
                                                $("#tab-content > .edit-timeline-page")?.goToDate(date, { instant: true });
                                            } ]
                                        ],
                                        $self => AddTooltip($self, DateFormatter.format(date), { edits: editDetails, events: eventDetails })
                                    )
                                } else return $Create("span", { className: `calendar-day inactive ${futureDay ? "future" : ""}`, "aria-hidden": "true" });
                            })
                        ]
                    )
                ]
            );
        })
    );
}

export function RenderCalendar(data, requestedYear = self.rememberedYear) {
    let oldest = Infinity, newest = -Infinity;
    const users = new Map();
    const activity = new Map(), events = new Map();

    {
        const getDayBucket = (timestamp, byYear, createBucket) => {
            const date = new Date(timestamp);
            if (Number.isNaN(date.getTime())) return null;

            const year = date.getUTCFullYear();
            oldest = Math.min(oldest, year);
            newest = Math.max(newest, year);

            const days = getOrCreate(byYear, year, () => new Map());
            return {
                date,
                bucket: getOrCreate(days, `${date.getUTCMonth()}-${date.getUTCDate()}`, createBucket)
            };
        };

        const addEvent = (username, timestamp, kind, label) => {
            const day = getDayBucket(timestamp, events, () => [ ]);
            day?.bucket.push({ username, kind, label, timestamp: day.date.getTime() });
        };

        for (const user of data) {
            users.set(user.name, { name: user.name, home: user.home, color: UserColor(user.name), visible: !hiddenUsers.has(user.name) });
            if (user.registration?.timestamp)
                addEvent(user.name, user.registration.timestamp, "registration", "Global registration");

            for (const project of user.projects || [ ]) {
                for (const edit of project.edits || [ ]) {
                    const day = getDayBucket(edit.timestamp, activity, () => new Map());
                    if (day) day.bucket.set(user.name, (day.bucket.get(user.name) || 0) + 1);
                }

                for (const block of project.blocks || [ ])
                    addEvent(user.name, block.timestamp, "local-block", getCalendarBlockLabel(block, project.code || project.project, true));
            }

            for (const block of user.blocks || [ ])
                addEvent(user.name, block.timestamp, "global-block", getCalendarBlockLabel(block, "Global"));
            for (const lock of user.locks || [ ])
                addEvent(user.name, lock.timestamp, "lock", getLockLabel(lock));
        }

        if (oldest === Infinity)
            oldest = newest = new Date().getFullYear();
    }

    const years = Array.from({ length: newest - oldest + 1 }, (_, i) => oldest + i);

    let selectedIndex, queuedIndex, year;
    let wheelLocked = false, transitionPending = false;
    {
        let temp = years.indexOf(requestedYear);
        if (temp < 0) temp = years.length - 1;
        selectedIndex = queuedIndex = temp;

        const state = window.history.state ?? { };
        year = self.rememberedYear = state.data = years[temp];
        window.history.replaceState(state, "");
    }

    const RefreshColors = (() => {
        SetUserColorSeed(PickColorSeed(Array.from(users.values())));
        StateUserColorSeed();
        for (const [ key, value ] of users) value.color = UserColor(key);
        for (const $el of $$("#tab-content *[data-username]"))
            $el.style.setProperty("--user-color", UserColor($el.dataset.username));
        for (const $el of $$("#tab-content *[data-color-data]")) {
            $el.style.removeProperty("--day-color");
            $el.style.removeProperty("background-image");
            for (const [ property, styleValue ] of Object.entries(GetDayBackground(JSON.parse($el.dataset.colorData)))) {
                if (property.includes("-"))
                    $el.style.setProperty(property, styleValue);
                else
                    $el.style[property] = styleValue;
            }
        }
    });

    const AdvanceYear = (() => {
        const $nav = $("#tab-content > .calendar-page > .calendar-nav");
        const $yearWindow = $("#tab-content > .calendar-page > .calendar-main > .calendar-header > .calendar-year-window");
        const $monthsWindow = $("#tab-content > .calendar-page > .calendar-main > .calendar-months-window");

        if (selectedIndex === queuedIndex)
            return void(transitionPending = false);

        transitionPending = true;
        const nextYear = years[queuedIndex];
        const direction = nextYear < years[selectedIndex] ? "older" : "newer";
        selectedIndex = queuedIndex;

        $$tooltips.keys().forEach($el => $el.remove());
        $$tooltips.clear();

        const $currentPanel = $(".calendar-year-panel.current", $monthsWindow);
        const $previousTitle = $(".calendar-year", $yearWindow);
        const $nextPanel = RenderYearPanel(nextYear, users, activity.get(nextYear), events.get(nextYear));
        const $nextTitle = $Create("h1", { className: "calendar-year" }, String(nextYear));

        $yearWindow.appendChild($nextTitle);
        $monthsWindow.appendChild($nextPanel);

        const $exiting = [ $currentPanel, $previousTitle ];
        const $entering = [ $nextPanel, $nextTitle ];
        for (const $element of $exiting) $element.classList.add(`exit-${direction}`);
        for (const $element of $entering) $element.classList.add(`enter-${direction}`);

        $$(":scope > .calendar-nav-button", $nav).forEach(($button, i) => {
            $button.classList.toggle("active", i === selectedIndex);
            $button.setAttribute("aria-current", i === selectedIndex ? "date" : "false");
        });
        $nav.style.setProperty("--active-year-index", selectedIndex);
        const $button = $(`:scope > .calendar-nav-button:nth-of-type(${selectedIndex + 1})`, $nav);
        $nav.scrollTo({ top: $button.offsetTop - ($nav.clientHeight - $button.offsetHeight) / 2, behavior: "smooth" });

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

            wheelLocked = false;

            const state = window.history.state ?? { };
            state.data = self.rememberedYear = years[selectedIndex];
            window.history.replaceState(state, "");

            AdvanceYear();
        };

        let remaining = $exiting.length + $entering.length;
        for (const $element of [ ...$exiting, ...$entering ])
            $element.addEventListener("animationend", () => { if (--remaining === 0) finish(); }, { once: true });

        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
        else setTimeout(finish, 360);
    });

    return $Create(
        "section",
        {
            className: "calendar-page",
            tabIndex: 0,
            "aria-label": "Calendar of account activity. Use the mouse wheel or up and down arrow keys to change years."
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
                                            $self.classList.toggle("hidden", user.visible = !user.visible);
                                            $self.setAttribute("aria-pressed", String(user.visible))
                                            $self.setAttribute("aria-label", $self.title = `${user.visible ? "Hide" : "Show"} ${user.name}`)

                                            if (user.visible) hiddenUsers.delete(user.name);
                                            else hiddenUsers.add(user.name);

                                            $$tooltips.keys().forEach($el => $el.remove());
                                            $$tooltips.clear();

                                            $("#tab-content > .page > .main").replaceWith(RenderMain(data, year));
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
                                            ? `View ${user.name}'s contributions on their home wiki`
                                            : `View ${user.name}'s global contributions`
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
                    className: "calendar-main"
                },
                [
                    $Create(
                        "div",
                        {
                            className: "calendar-header"
                        },
                        [
                            $Create(
                                "div",
                                {
                                    className: "calendar-year-window"
                                },
                                [
                                    $Create("h1", { className: "calendar-year current" }, String(year))
                                ]
                            )
                        ]
                    ),
                    $Create(
                        "div",
                        {
                            className: "calendar-months-window"
                        },
                        [
                            RenderYearPanel(year, users, activity.get(year), events.get(year), true)
                        ]
                    )
                ]
            ),
            $Create(
                "nav",
                {
                    className: "calendar-nav",
                    "aria-label": "Choose a year",
                    style: {
                        "--active-year-index": selectedIndex
                    }
                },
                years.map((year, i) => $Create(
                    "button",
                    {
                        className: "calendar-nav-button",
                        type: "button",
                        "aria-label": `Show ${year}`,
                        dataset: {
                            year: year
                        }
                    },
                    String(year),
                    [
                        [ "click", ($self, e) => {
                            queuedIndex = i;
                            if (!transitionPending) AdvanceYear();
                        } ]
                    ]
                ))
            )
        ],
        [
            [ "wheel", ($self, e) => {
                if (window.innerWidth <= MOBILE_BREAKPOINT) return;
                if (e.target instanceof Element && e.target.closest(".legend")) return;

                let delta = e.deltaY;
                switch (e.deltaMode) {
                    case WheelEvent.DOM_DELTA_LINE: {
                        delta = e.deltaY * 16;
                    } break;
                    case WheelEvent.DOM_DELTA_LINE: {
                        delta = e.deltaY * $page.clientHeight;
                    } break;
                }

                if (delta === 0) return;

                e.preventDefault();
                if (wheelLocked || transitionPending) return;

                const nextIndex = selectedIndex + Math.sign(delta);
                if (nextIndex < 0 || nextIndex >= years.length) return;

                queuedIndex = nextIndex;
                if (!transitionPending) AdvanceYear();

                wheelLocked = true;
            }, { passive: false } ],
            [ "keydown", ($self, e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();

                queuedIndex = Math.max(0, Math.min(newestIndex, queuedIndex + (e.key === "ArrowDown" ? 1 : -1)));
                if (!transitionPending) AdvanceYear();
            } ]
        ],
        $self => {
            const $nav = $(":scope > .calendar-nav", $self);
            const $button = $(`:scope > .calendar-nav-button:nth-of-type(${selectedIndex + 1})`, $nav);
            $nav.scrollTop = $button.offsetTop - ($nav.clientHeight - $button.offsetHeight) / 2;
        }
    )
}