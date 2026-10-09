import { $, $$, $Create, $Text } from "../helpers/DOM.js";
import { SetUserColorSeed, StateUserColorSeed, UserColor } from "../helpers/username-to-color.js";
import { PickColorSeed } from "../helpers/pick-color-seed.js";
import {
    GetContributionsURL,
    GetDiffURL,
    GetGlobalContributionsURL,
    GetOrigin,
    GetPageURL
} from "../helpers/wiki-urls.js";
import { Text } from "../helpers/text.js";

const DRAG_THRESHOLD = 5;

const LINK_MODE_DOMAIN = "domain";
const LINK_MODE_FULL = "full";

const LINK_MODES = [
    [ LINK_MODE_DOMAIN, "Domains" ],
    [ LINK_MODE_FULL, "Full links" ]
];

const ARCHIVE_TODAY_HOSTS = new Set([
    "archive.today", "archive.is", "archive.ph", "archive.fo", "archive.li", "archive.vn", "archive.md"
]);
const WEB_ARCHIVE_HOSTS = new Set([ "web.archive.org", "wayback.archive.org", "archive.org" ]);
const WEB_ARCHIVE_PATH = /^\/web\/[^/]+\/(.+)$/;

const SECOND_LEVEL_LABELS = new Set([
    "ac", "co", "com", "edu", "go", "gob", "gov", "govt", "ltd", "me", "mil", "ne", "net", "or", "org", "plc", "sch"
]);

const NumberFormatter = new Intl.NumberFormat();
const DateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const TimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" });

const expanded = { [LINK_MODE_DOMAIN]: new Set(), [LINK_MODE_FULL]: new Set() };
const hiddenAccounts = new Set();

const FormatTimestamp = (timestamp => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return `${DateFormatter.format(date)}, ${TimeFormatter.format(date)} UTC`;
});

const ResolveArchivedLink = (link => {
    try {
        const url = new URL(link);
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        let target;

        if (WEB_ARCHIVE_HOSTS.has(host)) {
            const match = url.pathname.match(WEB_ARCHIVE_PATH);
            if (!match) return link;
            target = match[1];
        } else if (ARCHIVE_TODAY_HOSTS.has(host)) {
            const match = url.pathname.match(/\/(https?:\/\/|https?%3A%2F%2F)/i);
            if (!match) return link;
            target = url.pathname.slice(match.index + 1);
            if (/^https?%3A%2F%2F/i.test(target)) target = decodeURIComponent(target);
        } else return link;

        target = (target + url.search + url.hash).replace(/^(https?):\/+/i, "$1://");
        if (!/^https?:\/\//i.test(target)) target = `http://${target}`;

        new URL(target);
        return target;
    } catch {
        return link;
    }
});

const GetDomain = (link => {
    try {
        const url = new URL(link);
        if (!/^https?:$/.test(url.protocol)) return null;

        const host = url.hostname.toLowerCase();
        if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return host;

        const parts = host.split(".");
        const isCountryCodeSuffix = parts.length > 2 && parts.at(-1).length === 2 && SECOND_LEVEL_LABELS.has(parts.at(-2));
        return parts.slice(isCountryCodeSuffix ? -3 : -2).join(".");
    } catch {
        return null;
    }
});

function* GetAddedLinks(result) {
    for (const project of result.projects || [ ])
        for (const edit of project.edits || [ ]) {
            const added = edit.links?.["+"];
            if (!Array.isArray(added)) continue;

            for (const link of added) {
                if (typeof link !== "string") continue;
                const target = ResolveArchivedLink(link), domain = GetDomain(target);
                if (domain) yield { link, target, domain, edit, project: project.project };
            }
        }
}

function AggregateLinks(results, mode = LINK_MODE_DOMAIN) {
    const groups = new Map();
    for (const result of results || [ ])
        for (const { link, target, domain, edit, project } of GetAddedLinks(result)) {
            const label = mode === LINK_MODE_FULL ? target : domain;
            if (!groups.has(label))
                groups.set(label, { label, domain, additions: 0, accounts: new Set(), pages: new Set(), edits: [ ] });

            const group = groups.get(label);
            group.additions++;
            if (result.name) group.accounts.add(result.name);
            if (edit.title) group.pages.add(edit.title);
            group.edits.push({ ...edit, name: result.name, project, domain, link, date: new Date(edit.timestamp).valueOf() });
        }

    return [ ...groups.values() ].sort((a, b) =>
        b.accounts.size - a.accounts.size ||
        b.pages.size - a.pages.size ||
        b.additions - a.additions ||
        a.label.localeCompare(b.label)
    );
}

const CreateOptionalLink = ((className, href, title, $$children) => href
        ? $Create("a", { className, href, title,  target: "_blank", rel: "noopener noreferrer", }, $$children)
        : $Create("span", { className }, $$children));

function RenderMain(data, mode) {
    const links = AggregateLinks(data.filter(result => !hiddenAccounts.has(result.name)), mode);
    return $Create(
        "div",
        {
            className: "links-main"
        },
        links.length === 0
            ? [ $Create("p", { className: "links-empty" }, "No external links were found in the returned edits.") ]
            : [ $Create(
                "list",
                {
                    className: "links-list",
                    role: "list"
                },
                links.map(link => {
                    const drag = { dragging: false, x: 0, y: 0 };
                    return $Create(
                        "article",
                        {
                            className: "link-item",
                            role: "listitem"
                        },
                        [
                            $Create(
                                "div",
                                {
                                    className: `link-item-header ${expanded[mode].has(link.label) ? "expanded" : ""}`,
                                    "aria-expanded": expanded[mode].has(link.label)
                                },
                                [
                                    $Create(
                                        "button",
                                        {
                                            className: "link-button",
                                            type: "button",
                                        },
                                        [
                                            $Create("span", { className: "link-chevron" }, "▾"),
                                            $Create("span", { className: "link-label" }, link.label)
                                        ]
                                    ),
                                    $Create(
                                        "div",
                                        {
                                            className: "link-breakdown"
                                        },
                                        [
                                            $Create("span", { className: "link-stat" }, Text.label("account", link.accounts.size, null, NumberFormatter)),
                                            $Create("span", { className: "link-stat" }, Text.label("page", link.pages.size, null, NumberFormatter)),
                                            $Create("span", { className: "link-stat" }, Text.label("addition", link.additions, null, NumberFormatter))
                                        ]
                                    )
                                ],
                                [
                                    [ "mousedown", ($self, e) => {
                                        drag.dragging = false;
                                        drag.x = e.clientX;
                                        drag.y = e.clientY;
                                        if (e.detail > 1) e.preventDefault();
                                    } ],
                                    [ "mousemove", ($self, e) => {
                                        if (!drag.dragging && Math.hypot(drag.x - e.clientX, drag.y - e.clientY) >= DRAG_THRESHOLD)
                                            drag.dragging = true;
                                    } ],
                                    [ "click", ($self, e) => {
                                        if (drag.dragging) return;

                                        const expand = $self.getAttribute("aria-expanded") !== "true";
                                        $self.setAttribute("aria-expanded", String(expand));
                                        $self.classList.toggle("expanded", expand);

                                        $(":scope > .links-edit-list", $self.parentElement).classList.toggle("hidden", !expand);

                                        if (expand) expanded[mode].add(link.label);
                                        else expanded[mode].delete(link.label);
                                    } ]
                                ]
                            ),
                            $Create(
                                "div",
                                {
                                    className: `links-edit-list ${expanded[mode].has(link.label) ? "" : "hidden"}`,
                                },
                                link.edits.sort((a, b) => a.date - b.date).map(edit => $Create(
                                    "article",
                                    {
                                        className: "links-edit-row",
                                        dataset: {
                                            username: edit.name
                                        },
                                        style: {
                                            "--user-color":
                                            UserColor(edit.name)
                                        }
                                    },
                                    [
                                        $Create(
                                            "div",
                                            {
                                                className: "links-edit-meta"
                                            },
                                            [
                                                CreateOptionalLink(
                                                    "links-edit-timestamp",
                                                    edit.project && edit.revid !== undefined ? GetDiffURL(edit.project, edit.revid, edit.parentid) : null,
                                                    "Open edit diff",
                                                    [
                                                        $Create("time", { dateTime: edit.timestamp || undefined }, FormatTimestamp(edit.timestamp))
                                                    ]
                                                ),
                                                CreateOptionalLink(
                                                    "links-edit-account",
                                                    edit.project && edit.name ? GetContributionsURL(edit.project, edit.name) : null,
                                                    "Open user contributions",
                                                    edit.name || "Unknown account"
                                                )
                                            ]
                                        ),
                                        $Create(
                                            "div",
                                            {
                                                className: "links-edit-page",
                                            },
                                            [
                                                CreateOptionalLink(
                                                    "links-edit-project",
                                                    edit.project ? GetOrigin(edit.project) : null,
                                                    "Open project",
                                                    edit.project || "Unknown project"
                                                ),
                                                $Create("span", { className: "links-edit-separator", "aria-hidden": "true" }),
                                                CreateOptionalLink(
                                                    "links-edit-title",
                                                    edit.project && edit.title ? GetPageURL(edit.project, edit.title) : null,
                                                    "Open page",
                                                    edit.title || "Unknown page"
                                                )
                                            ]
                                        )
                                    ]
                                ))
                            )
                        ]
                    );
                })
            ) ]
    )
}

export function RenderLinks(data, requestedMode = self.rememberedMode) {
    let mode = LINK_MODES.find(([ value ]) => value === requestedMode)?.[0] || LINK_MODES[0][0];

    const state = window.history.state ?? { };
    self.rememberedMode = state.data = mode;
    window.history.replaceState(state, "");

    const users = data.map(user => ({ name: user.name, home: user.home, color: UserColor(user.name), visible: !hiddenAccounts.has(user.name) }));
    const RefreshColors = () => {
        SetUserColorSeed(PickColorSeed(users));
        StateUserColorSeed();
        for (const user of users) user.color = UserColor(user.name);
        for (const $element of $$("#tab-content *[data-username]"))
            $element.style.setProperty("--user-color", UserColor($element.dataset.username));
    };

    return $Create(
        "section",
        {
            className: "links-page",
            tabIndex: 0,
            "aria-label": "External links added by accounts"
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
                        users.map(user => $Create(
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

                                            if (user.visible) hiddenAccounts.delete(user.name);
                                            else hiddenAccounts.add(user.name);

                                            $("#tab-content > .page > .main").replaceWith(RenderMain(data, mode));
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
            RenderMain(data, mode),
            $Create(
                "div",
                {
                    className: "links-controls",
                    dataset: {
                        mode: mode
                    },
                    style: {
                        "--mode": String(LINK_MODES.findIndex(([ value ]) => value === mode))
                    }
                },
                LINK_MODES.map(([ value, label ]) => $Create(
                    "button",
                    {
                        className: `links-mode-button ${value === mode ? "active" : ""}`,
                        type: "button",
                        "aria-pressed": String(value === mode),
                        dataset: {
                            mode: value
                        }
                    },
                    label,
                    [
                        [ "click", ($self, e) => {
                            const $parent = $self.parentElement;
                            if (value === $parent.dataset.mode) return;
                            mode = value;

                            const state = window.history.state ?? { };
                            self.rememberedMode = state.data = mode;
                            window.history.replaceState(state, "");

                            $parent.dataset.mode = value;
                            $parent.style.setProperty("--mode", String(LINK_MODES.findIndex(([ value ]) => value === mode)));
                            $$(":scope > .links-mode-button.active", $parent).forEach($button => {
                                $button.classList.remove("active");
                                $button.setAttribute("aria-pressed", "false");
                            });

                            $self.classList.add("active");
                            $self.setAttribute("aria-pressed", "true");

                            $("#tab-content > .links-page > .links-main").replaceWith(RenderMain(data, mode));
                        } ]
                    ]
                ))
            )
        ]
    );
}