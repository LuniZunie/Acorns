import { $Create } from "../helpers/DOM.js";

import { Text } from "../helpers/text.js";
import { Ratio } from "../helpers/math.js";

import { CreateChart } from "../helpers/chart.js";
import { AddHoverTooltip, ShowTooltip, HideTooltip } from "../helpers/tooltip.js";

const MAX_RANKED = 10;
const REMAINDER_COLOR = "#edf2e8";

const NumberFormatter = new Intl.NumberFormat();
const PercentFormatter = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

const Card = (function(label, value, detail) {
    return $Create("div", { className: "links-card" }, [
        $Create("span", { className: "links-card-value" }, value),
        $Create("span", { className: "links-card-label" }, label),
        detail ? $Create("span", { className: "links-card-detail" }, detail) : null
    ]);
});

const RankedRows = (function(accounts, key, isURL = false) {
    const totals = new Map();
    for (const account of accounts)
        for (const [ item, count ] of account[key]) {
            if (!totals.has(item)) totals.set(item, new Map());
            totals.get(item).set(account.name, count);
        }

    const sum = counts => Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const top = Array.from(totals)
        .sort((a, b) => sum(b[1]) - sum(a[1]) || a[0].localeCompare(b[0]))
        .slice(0, MAX_RANKED);
    const max = Math.max(1, ...top.map(([ , counts ]) => sum(counts)));

    return $Create("ol", { className: `links-domains ${isURL ? "links-urls" : ""}` }, top.map(([ item, counts ]) => $Create("li", { className: "links-domain" }, [
        isURL
            ? $Create("a", { className: "links-domain-name", href: item, target: "_blank", rel: "noopener noreferrer", title: item }, item)
            : $Create("span", { className: "links-domain-name", title: item }, item),
        $Create("div", { className: "links-domain-bar" }, accounts.filter(account => counts.has(account.name)).map(account => {
            const count = counts.get(account.name);
            const $segment = $Create("span", {
                className: "links-domain-segment",
                tabIndex: 0,
                dataset: { username: account.name },
                style: { "--user-color": account.color, width: `${count / max * 100}%` }
            });
            AddHoverTooltip($segment, () => ({
                rows: [{ color: account.color, text: `${account.name}: ${Text.label("link", count, null, NumberFormatter)}` }]
            }));
            return $segment;
        })),
        $Create("span", { className: "links-domain-count" }, NumberFormatter.format(sum(counts))),
        $Create("span", { className: "links-domain-shared", title: "Accounts that added this" }, Text.label("account", counts.size))
    ])));
});

const RankedSection = (function(title, accounts, key, isURL) {
    return $Create("section", { className: "links-overview-section" }, [
        $Create("h3", { className: "links-overview-title" }, title),
        RankedRows(accounts, key, isURL)
    ]);
});

export const RenderLinksOverview = (function(accounts) {
    if (accounts.length === 0)
        return $Create("div", { className: "links-main" }, [
            $Create("p", { className: "links-empty" }, "No accounts selected.")
        ]);

    const totalEdits = accounts.reduce((sum, account) => sum + account.total, 0);
    const linkEdits = accounts.reduce((sum, account) => sum + account.linkEdits, 0);
    const links = accounts.reduce((sum, account) => sum + account.links, 0);
    const domains = new Set(accounts.flatMap(account => Array.from(account.domains.keys())));
    const pages = new Set(accounts.flatMap(account => Array.from(account.pages)));

    return $Create("div", { className: "links-main links-overview" }, [
        $Create("div", { className: "links-cards" }, [
            Card("Edits with links", PercentFormatter.format(Ratio(linkEdits, totalEdits)), `${NumberFormatter.format(linkEdits)} of ${Text.label("edit", totalEdits, null, NumberFormatter)}`),
            Card("Links added", NumberFormatter.format(links)),
            Card("Domains", NumberFormatter.format(domains.size)),
            Card("Pages", NumberFormatter.format(pages.size))
        ]),
        $Create("section", { className: "links-overview-section" }, [
            $Create("h3", { className: "links-overview-title" }, "Accounts"),
            $Create("div", { className: "links-accounts" }, accounts.map(function(account) {
                const rate = Ratio(account.linkEdits, account.total);

                let topDomain = null, topCount = 0;
                for (const [ domain, count ] of account.domains)
                    if (count > topCount) [ topDomain, topCount ] = [ domain, count ];

                return $Create("div", { className: "links-account" }, [
                    $Create("span", {
                        className: "links-account-name",
                        dataset: { username: account.name },
                        style: { "--user-color": account.color }
                    }, account.name),
                    $Create("div", { className: "links-account-ring" }, [
                        CreateChart({
                            type: "doughnut",
                            data: {
                                labels: [ "Edits with links", "Other edits" ],
                                datasets: [{
                                    data: [ account.linkEdits, account.total - account.linkEdits ],
                                    backgroundColor: [ account.color, REMAINDER_COLOR ],
                                    borderWidth: 0
                                }]
                            },
                            options: {
                                cutout: "74%",
                                plugins: {
                                    legend: { display: false },
                                    tooltip: {
                                        enabled: false,
                                        external: ({ chart, tooltip }) => {
                                            if (tooltip.opacity === 0) return HideTooltip();

                                            const { dataIndex, label, parsed } = tooltip.dataPoints[0];
                                            const rect = chart.canvas.getBoundingClientRect();
                                            ShowTooltip(chart.canvas, { x: rect.left + rect.width / 2, y: rect.top }, label, [{
                                                color: chart.data.datasets[0].backgroundColor[dataIndex],
                                                text: `${NumberFormatter.format(parsed)} (${PercentFormatter.format(Ratio(parsed, account.total))})`
                                            }]);
                                        }
                                    }
                                }
                            }
                        }, "100%"),
                        $Create("span", { className: "links-account-percent" }, PercentFormatter.format(rate))
                    ]),
                    $Create("span", { className: "links-account-detail" }, `${NumberFormatter.format(account.linkEdits)} of ${Text.label("edit", account.total, null, NumberFormatter)}`),
                    $Create("span", { className: "links-account-detail" }, `${Text.label("link", account.links, null, NumberFormatter)} · ${Text.label("domain", account.domains.size, null, NumberFormatter)}`),
                    topDomain
                        ? $Create("span", { className: "links-account-top", title: `${topDomain} (${NumberFormatter.format(topCount)})` }, topDomain)
                        : null
                ]);
            }))
        ]),
        ...(domains.size > 0
            ? [
                RankedSection("Top domains", accounts, "domains", false),
                RankedSection("Top links", accounts, "urls", true)
            ]
            : [ $Create("p", { className: "links-empty" }, "No external links were found in the returned edits.") ]
        )
    ]);
});
