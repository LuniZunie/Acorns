import { $Create, $Text } from "./DOM.js";

const MAX_ACCOUNTS = 8;
const DEFAULT_ACCOUNTS = 3;
const WIDTHS = [ "72%", "55%", "86%", "63%", "78%" ];

const daysOfWeek = [ "Mo", "Tu", "We", "Th", "Fr", "Sa", "Su" ];
const hoursOfDay = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const linkModes = [ "Overview", "Domains", "Full links" ];
const linkModeValues = [ "overview", "domain", "full" ];

const Block = (function(className = "", style, tag = "div", text) {
    return $Create(tag, { className: `skeleton ${className}`.trim(), style }, text);
});
const Line = (function(i = 0, className = "") {
    return Block(`skeleton-line ${className}`, { width: WIDTHS[i % WIDTHS.length] }, "span");
});
const Repeat = (function(count, create) { return Array.from({ length: count }, (_, i) => create(i)); });

const Legend = (function(accounts) {
    return $Create("aside", { className: "legend" }, [
        $Create("h2", { className: "legend-title" }, "Accounts"),
        $Create("ul", { className: "legend-list" }, Repeat(accounts, i => $Create("li", { className: "legend-item" }, [
            Block("legend-swatch", undefined, "span"),
            Line(i)
        ]))),
        $Create("div", { className: "refresh-colors" }, [
            $Create("span", { className: "refresh-icon" }, "\u21bb"),
            $Text("New colors")
        ])
    ]);
});

const Timecards = (function(accounts) {
    const cell = (extra = "") => Block(`cell ${extra}`.trim());
    return $Create("div", { className: "timecard-page" }, Repeat(Math.min(accounts, 4), () => $Create("section", { className: "timecard" }, [
        Block("timecard-caption", { width: "40%", margin: "0 auto" }),
        $Create("div", { className: "timecard-table" }, [
            $Create("div"),
            ...hoursOfDay.map(hour => $Create("div", { className: "hour-label" }, hour)),
            $Create("div", { className: "spacer" }),
            $Create("div"),
            ...daysOfWeek.flatMap(day => [
                $Create("div", { className: "day-label" }, day),
                ...Repeat(24, () => cell()),
                $Create("div", { className: "spacer" }),
                cell("summary-cell")
            ]),
            ...Repeat(27, () => $Create("div", { className: "spacer" })),
            $Create("div"),
            ...Repeat(24, () => cell("summary-cell")),
            $Create("div", { className: "spacer" }),
            $Create("div")
        ])
    ])));
});

const Calendar = (function(accounts) {
    return $Create("section", { className: "calendar-page" }, [
        Legend(accounts),
        $Create("div", { className: "calendar-main" }, [
            $Create("div", { className: "calendar-header" }, [
                $Create("div", { className: "calendar-year-window" }, [
                    Block("skeleton-year")
                ])
            ]),
            $Create("div", { className: "calendar-months-window" }, [
                $Create("div", { className: "calendar-year-panel" }, Repeat(12, () => $Create("section", { className: "calendar-month" }, [
                    $Create("div", { className: "calendar-month-heading" }, [
                        Block("calendar-month-title", undefined, "h2", "Month")
                    ]),
                    $Create("div", { className: "calendar-month-grid" }, [
                        ...Repeat(7, () => $Create("span", { className: "calendar-weekday" })),
                        ...Repeat(30, () => $Create("span", { className: "calendar-day" }))
                    ])
                ])))
            ])
        ]),
        $Create("nav", { className: "calendar-nav" }, Repeat(5, () => Block("calendar-nav-button")))
    ]);
});

const Timeline = (function(accounts) {
    const entry = i => $Create("article", { className: "edit-timeline-entry" }, [
        $Create("div", { className: "edit-timeline-meta" }, [
            Block("skeleton-line", { width: "4.5rem" }, "span"),
            Line(i)
        ]),
        $Create("div", { className: "edit-timeline-page-links" }, [
            Block("edit-timeline-kind", { width: "3.5rem" }, "span", "Edit"),
            Line(i + 2)
        ])
    ]);

    return $Create("section", { className: "edit-timeline-page" }, [
        Legend(accounts),
        $Create("div", { className: "edit-timeline-days" }, Repeat(3, day => $Create("section", { className: "edit-timeline-day" }, [
            $Create("h2", { className: "edit-timeline-date" }, [
                Block("skeleton-line", { width: "9rem" }, "span")
            ]),
            ...Repeat(6, i => entry(i + day))
        ]))),
        $Create("nav", { className: "edit-timeline-navigation" }, Repeat(5, i => Block(`edit-timeline-date-button position-${i}`, undefined, "div", "Jan 01")))
    ]);
});

const LinksState = (function(state) {
    const [ mode, reverts, search ] = String(state ?? "").split(";");
    return {
        mode: linkModeValues.includes(mode) ? mode : linkModeValues.includes(self.rememberedMode) ? self.rememberedMode : linkModeValues[0],
        reverts: reverts === undefined ? Boolean(self.reverts) : reverts === "true",
        search: search ?? self.search ?? ""
    };
});

const LinksOverview = (function(accounts) {
    return $Create("div", { className: "links-main links-overview" }, [
        $Create("div", { className: "links-cards" }, [ "Edits with links", "Links added", "Domains", "Pages" ].map((label, i) => $Create("div", { className: "links-card" }, [
            Block("links-card-value", { width: "45%" }, "span", "0"),
            $Create("span", { className: "links-card-label" }, label),
            i === 0 ? Block("links-card-detail", { width: "70%" }, "span", "0") : null
        ]))),
        $Create("section", { className: "links-overview-section" }, [
            $Create("h3", { className: "links-overview-title" }, "Accounts"),
            $Create("div", { className: "links-accounts" }, Repeat(Math.min(accounts, 4), i => $Create("div", { className: "links-account" }, [
                Line(i, "links-account-name"),
                $Create("div", { className: "links-account-ring" }, [
                    Block("skeleton-circle")
                ]),
                Block("links-account-detail", { width: "60%" }, "span", "0")
            ])))
        ])
    ]);
});

const LinksList = (function(state) {
    return $Create("div", { className: "links-main" }, [
        $Create("div", { className: "links-filter-bar" }, [
            $Create("input", { className: "links-search", type: "text", placeholder: "Search", value: state.search, disabled: "", tabindex: "-1" }),
            $Create("div", { className: "links-reverts-toggle", style: { "--active-index": Number(!state.reverts) } }, [
                $Create("div", { className: "links-reverts-button" }, "Show reverts"),
                $Create("div", { className: "links-reverts-button" }, "Hide reverts")
            ])
        ]),
        $Create("div", { className: "links-list" }, Repeat(8, i => $Create("div", { className: "link-item" }, [
            $Create("div", { className: "link-item-header" }, [
                Line(i, "link-button"),
                $Create("div", { className: "link-breakdown" }, [
                    Block("link-stat", { width: "4rem" }, "span", "0"),
                    Block("link-stat", { width: "4rem" }, "span", "0")
                ])
            ])
        ])))
    ]);
});

const Links = (function(accounts, data) {
    const state = LinksState(data);
    const { mode } = state;
    return $Create("section", { className: "links-page" }, [
        Legend(accounts),
        mode === "overview" ? LinksOverview(accounts) : LinksList(state),
        $Create("div", { className: "links-controls", style: { "--mode": String(linkModeValues.indexOf(mode)) } }, linkModes.map((label, i) => $Create(
            "div",
            { className: `links-mode-button ${linkModeValues[i] === mode ? "active" : ""}` },
            label
        )))
    ]);
});

export const CreateTabSkeleton = (function(tab, { accounts, state } = { }) {
    const count = Math.min(Math.max(Number(accounts) || DEFAULT_ACCOUNTS, 1), MAX_ACCOUNTS);

    let $page;
    switch (tab) {
        case "timecards": $page = Timecards(count); break;
        case "calendar": $page = Calendar(count); break;
        case "timeline": $page = Timeline(count); break;
        case "links": $page = Links(count, state); break;
        default: return null;
    }

    $page.classList.add("tab-skeleton");
    $page.setAttribute("role", "status");
    $page.setAttribute("aria-busy", "true");
    $page.setAttribute("aria-label", "Loading");
    for (const $child of $page.children) $child.setAttribute("aria-hidden", "true");

    return $page;
});
