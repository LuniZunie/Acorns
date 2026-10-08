import { $ } from "../helpers/query-selector.js";
import { SetUserColorSeed, StateUserColorSeed, UserColor } from "../helpers/username-to-color.js";
import { PickColorSeed } from "../helpers/pick-color-seed.js";
import {
    GetContributionsURL,
    GetDiffURL,
    GetGlobalContributionsURL,
    GetOrigin,
    GetPageURL
} from "../helpers/wiki-urls.js";

const LINK_MODE_DOMAIN = "domain";
const LINK_MODE_FULL = "full";

const LINK_MODES = [
    [ LINK_MODE_DOMAIN, "Domains" ],
    [ LINK_MODE_FULL, "Full links" ]
];

const ARCHIVE_HOST = "web.archive.org";
const ARCHIVE_PATH = /^\/web\/[^/]+\/(.+)$/;

const SECOND_LEVEL_LABELS = new Set([
    "ac", "co", "com", "edu", "go", "gob", "gov", "govt", "ltd", "me", "mil", "ne", "net", "or", "org", "plc", "sch"
]);

const dateFormatter = new Intl.DateTimeFormat(undefined, {
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

const hiddenAccounts = new Set();

const normalizeLinkMode = value => value === LINK_MODE_FULL ? LINK_MODE_FULL : LINK_MODE_DOMAIN;

const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`;

const getAccount = result => String(result.user || "").trim();

const resolveArchivedLink = link => {
    try {
        const url = new URL(link);
        if (url.hostname.toLowerCase() !== ARCHIVE_HOST) return link;

        const match = url.pathname.match(ARCHIVE_PATH);
        if (!match) return link;

        let target = (match[1] + url.search + url.hash).replace(/^(https?):\/+/i, "$1://");
        if (!/^https?:\/\//i.test(target)) target = `http://${target}`;

        new URL(target);
        return target;
    } catch {
        return link;
    }
};

const getRegistrableDomain = host => {
    if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return host;

    const parts = host.split(".");
    const isCountryCodeSuffix = parts.length > 2 &&
        parts.at(-1).length === 2 &&
        SECOND_LEVEL_LABELS.has(parts.at(-2));

    return parts.slice(isCountryCodeSuffix ? -3 : -2).join(".");
};

const getDomain = link => {
    try {
        const url = new URL(link);
        if (!/^https?:$/.test(url.protocol)) return null;
        return getRegistrableDomain(url.hostname.toLowerCase());
    } catch {
        return null;
    }
};

function* getAddedLinks(result) {
    for (const project of result.projects || [ ])
        for (const edit of project.edits || [ ]) {
            const added = edit.links?.["+"];
            if (!Array.isArray(added)) continue;

            for (const link of added) {
                if (typeof link !== "string") continue;

                const target = resolveArchivedLink(link);
                const domain = getDomain(target);
                if (domain) yield { link, target, domain, edit, project: project.project };
            }
        }
}

export function AggregateLinks(results, mode = LINK_MODE_DOMAIN) {
    const full = normalizeLinkMode(mode) === LINK_MODE_FULL;
    const groups = new Map();

    for (const result of results || [ ]) {
        const account = getAccount(result);

        for (const { link, target, domain, edit, project } of getAddedLinks(result)) {
            const label = full ? target : domain;
            if (!groups.has(label))
                groups.set(label, { label, domain, additions: 0, accounts: new Set(), pages: new Set(), edits: [ ] });

            const group = groups.get(label);
            group.additions++;
            if (account) group.accounts.add(account);
            if (edit.title) group.pages.add(edit.title);
            group.edits.push({ ...edit, user: account, project, domain, link, date: new Date(edit.timestamp).valueOf() });
        }
    }

    return [ ...groups.values() ].sort((a, b) =>
        b.accounts.size - a.accounts.size ||
        b.pages.size - a.pages.size ||
        b.additions - a.additions ||
        a.label.localeCompare(b.label)
    );
}

const create = (tag, className, textContent) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent !== undefined) element.textContent = textContent;
    return element;
};

const createLink = (className, href, text, title) => {
    const link = create("a", className, text);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (title !== undefined) link.title = title;
    return link;
};

const saveLinksMode = mode => {
    const state = window.history.state ?? { };
    state.data = mode;
    window.history.replaceState(state, "");
};

const formatTimestamp = timestamp => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return `${dateFormatter.format(date)}, ${timeFormatter.format(date)} UTC`;
};

const createOptionalLink = (className, href, text, title) =>
    href ? createLink(className, href, text, title) : create("span", className, text);

const createEditRow = edit => {
    const { project, title, user } = edit;

    const row = create("article", "links-edit-row");
    row.dataset.username = user;
    row.style.setProperty("--user-color", UserColor(user));

    const timestamp = createOptionalLink(
        "links-edit-timestamp",
        project && edit.revid !== undefined ? GetDiffURL(project, edit.revid, edit.parentid) : null,
        undefined,
        "View edit diff"
    );
    const time = create("time", undefined, formatTimestamp(edit.timestamp));
    if (edit.timestamp) time.dateTime = edit.timestamp;
    timestamp.append(time);

    const meta = create("div", "links-edit-meta");
    meta.append(
        timestamp,
        createOptionalLink(
            "links-edit-account",
            project && user ? GetContributionsURL(project, user) : null,
            user || "Unknown account"
        )
    );

    const separator = create("span", "links-edit-separator");
    separator.setAttribute("aria-hidden", "true");

    const page = create("div", "links-edit-page");
    page.append(
        createOptionalLink("links-edit-project", project ? GetOrigin(project) : null, project || "Unknown project"),
        separator,
        createOptionalLink("links-edit-title", project && title ? GetPageURL(project, title) : null, title || "Untitled edit", title)
    );

    row.append(meta, page);
    return row;
};

const createLinkItem = link => {
    const item = create("article", "link-item");
    item.setAttribute("role", "listitem");

    const details = create("div", "links-edit-list");
    details.hidden = true;
    details.append(...link.edits.sort((a, b) => a.date - b.date).map(createEditRow));

    const title = create("button", "link-button");
    title.type = "button";
    title.setAttribute("aria-expanded", "false");
    title.append(create("span", "link-chevron", "▾"), create("span", "link-label", link.label));

    const breakdown = create("div", "link-breakdown");
    breakdown.append(
        create("span", "link-stat", plural(link.accounts.size, "account")),
        create("span", "link-stat", plural(link.pages.size, "page")),
        create("span", "link-stat", plural(link.additions, "addition"))
    );

    const header = create("div", "link-item-header");
    header.append(title, breakdown);
    header.addEventListener("click", () => {
        const expanded = title.getAttribute("aria-expanded") === "true";
        title.setAttribute("aria-expanded", String(!expanded));
        item.classList.toggle("expanded", !expanded);
        details.hidden = expanded;
    });

    item.append(header, details);
    return item;
};

const updateSwatch = ($swatch, user) => {
    const label = `${user.visible ? "Hide" : "Show"} ${user.name}`;
    $swatch.classList.toggle("is-hidden", !user.visible);
    $swatch.setAttribute("aria-pressed", String(user.visible));
    $swatch.setAttribute("aria-label", label);
    $swatch.title = label;
};

const createLegend = (users, onToggle, onRefresh) => {
    const $legend = create("aside", "links-legend");
    $legend.setAttribute("aria-label", "Filter accounts");
    $legend.hidden = users.length === 0;

    const $list = create("ul", "links-legend-list");
    $legend.append(create("h2", "links-legend-title", "Accounts"), $list);

    for (const user of users) {
        const $swatch = create("button", "links-legend-swatch");
        $swatch.type = "button";
        $swatch.dataset.username = user.name;
        $swatch.style.setProperty("--user-color", user.color);
        updateSwatch($swatch, user);
        $swatch.addEventListener("click", () => {
            user.visible = !user.visible;
            updateSwatch($swatch, user);
            onToggle(user);
        });

        const $username = createLink(
            "links-legend-username",
            user.home ? GetContributionsURL(user.home, user.name) : GetGlobalContributionsURL(user.name),
            user.name,
            user.home
                ? `View ${user.name}'s contributions on their home wiki`
                : `View ${user.name}'s global contributions`
        );

        const $item = create("li", "links-legend-item");
        $item.append($swatch, $username);
        $list.append($item);
    }

    const $icon = create("span", "links-refresh-icon", "\u21bb");
    $icon.setAttribute("aria-hidden", "true");

    const $refresh = create("button", "links-refresh-colors");
    $refresh.type = "button";
    $refresh.setAttribute("aria-label", "New colors");
    $refresh.append($icon, document.createTextNode("New colors"));
    $refresh.addEventListener("click", () => {
        onRefresh();
        $icon.classList.remove("rotating");
        void $icon.offsetWidth;
        $icon.classList.add("rotating");
    });
    $legend.append($refresh);

    return $legend;
};

const createModeSwitch = (initialMode, onSelect) => {
    const $switch = create("div", "links-mode-switch");
    $switch.setAttribute("role", "group");
    $switch.setAttribute("aria-label", "Link display mode");

    const $buttons = LINK_MODES.map(([ value, label ]) => {
        const $button = create("button", "links-mode-button", label);
        $button.type = "button";
        $button.dataset.mode = value;
        $button.addEventListener("click", () => {
            if (value === $switch.dataset.mode) return;
            apply(value);
            onSelect(value);
        });
        return $button;
    });

    function apply(mode) {
        $switch.dataset.mode = mode;
        $switch.style.setProperty("--mode", String(LINK_MODES.findIndex(([ value ]) => value === mode)));
        for (const $button of $buttons) {
            const active = $button.dataset.mode === mode;
            $button.classList.toggle("active", active);
            $button.setAttribute("aria-pressed", String(active));
        }
    }

    $switch.append(create("span", "links-mode-indicator"), ...$buttons);
    apply(initialMode);
    return $switch;
};

export function RenderLinks(data, requestedMode) {
    let mode = normalizeLinkMode(requestedMode);

    const homes = new Map();
    for (const result of data || [ ]) {
        const name = getAccount(result);
        if (name && !homes.has(name)) homes.set(name, result.home || null);
    }

    const accounts = [ ...homes.keys() ];
    const users = accounts.map(name => ({
        name,
        home: homes.get(name),
        color: UserColor(name),
        visible: !hiddenAccounts.has(name)
    }));

    const $summary = create("p", "links-summary");
    const $main = create("div", "links-main");

    const render = () => {
        const visibleResults = data.filter(result => !hiddenAccounts.has(getAccount(result)));
        const links = AggregateLinks(visibleResults, mode);
        $summary.textContent = `${plural(links.length, "link")} found`;

        if (links.length === 0) {
            $main.replaceChildren(create("p", "links-empty", "No external links were found in the returned edits."));
            return;
        }

        const $list = create("div", "links-list");
        $list.setAttribute("role", "list");
        $list.append(...links.map(createLinkItem));
        $main.replaceChildren($list);
    };

    const $page = create("section", "links-page");
    $page.setAttribute("aria-label", "External links added by accounts");

    const refreshColors = () => {
        SetUserColorSeed(PickColorSeed(users));
        StateUserColorSeed();
        for (const $element of $page.querySelectorAll("[data-username]"))
            $element.style.setProperty("--user-color", UserColor($element.dataset.username));
    };

    const $legend = createLegend(users, ({ name, visible }) => {
        if (visible) hiddenAccounts.delete(name);
        else hiddenAccounts.add(name);
        render();
    }, refreshColors);

    const $controls = create("div", "links-controls");
    $controls.append(
        createModeSwitch(mode, nextMode => {
            mode = nextMode;
            saveLinksMode(mode);
            render();
        }),
        $summary
    );

    $page.append($legend, $main, $controls);
    render();

    $("#tab-content").replaceChildren($page);
}