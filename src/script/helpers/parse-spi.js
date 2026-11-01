const WIKI_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(wikipedia|wikimedia|wikidata|mediawiki)\.org$/i;
const DEFAULT_HOST = "en.wikipedia.org";
const DEFAULT_PREFIX = "Wikipedia:Sockpuppet investigations/";

export const ParseSPIPage = (function(input) {
    let host = DEFAULT_HOST;
    let title = input.trim().replace(/^\[\[(.*)\]\]$/, "$1").replace(/^:/, "");
    if (!title) throw new Error("Enter an SPI page title or URL.");

    let fragment = "";
    if (/^https?:\/\//i.test(title) || /^[a-z0-9.-]+\.org\/wiki\//i.test(title)) {
        let url;
        try { url = new URL(/^https?:/i.test(title) ? title : `https://${title}`); }
        catch { throw new Error("That doesn't look like a valid URL."); }

        if (!WIKI_HOST.test(url.hostname)) throw new Error("Only Wikimedia project pages are supported.");
        host = url.hostname.toLowerCase();
        fragment = url.hash.slice(1);
        title = url.searchParams.get("title")
            ?? decodeURIComponent(url.pathname.replace(/^\/wiki\//, ""));
    } else {
        const hash = title.indexOf("#");
        if (hash !== -1) {
            fragment = title.slice(hash + 1);
            title = title.slice(0, hash);
        }
    }

    try { fragment = decodeURIComponent(fragment); } catch { }
    fragment = fragment.replaceAll("_", " ").trim();

    title = title.replaceAll("_", " ").trim();
    if (/^sockpuppet investigations\//i.test(title)) title = `Wikipedia:${title}`;
    else if (!title.includes(":") && !title.includes("/")) title = `${DEFAULT_PREFIX}${title}`;

    return { host, title, section: fragment };
});

export const FetchWikitext = (async function({ host, title }, signal) {
    const url = new URL(`https://${host}/w/api.php`);
    for (const [ key, value ] of Object.entries({
        action: "parse",
        page: title,
        prop: "wikitext",
        redirects: "1",
        format: "json",
        formatversion: "2",
        origin: "*"
    })) url.searchParams.set(key, value);

    let response;
    try { response = await fetch(url, { signal }); }
    catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error("Couldn't reach Wikipedia. Check your connection and try again.", { cause: error });
    }
    if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}.`);

    const json = await response.json();
    if (json.error) {
        if (json.error.code === "missingtitle") throw new Error(`The page "${title}" doesn't exist.`);
        throw new Error(json.error.info ?? "Wikipedia returned an error.");
    }
    return json.parse.wikitext;
});

const HEADING = /^(={2,6})[ \t]*(.+?)[ \t]*\1[ \t]*$/;

const CleanHeading = (function(text) {
    return text
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
        .replace(/\{\{[^}]*\}\}/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/'{2,}/g, "")
        .trim();
});

const FindTemplateEnd = (function(text, start) {
    let depth = 0;
    for (let i = start; i < text.length - 1; i++) {
        const pair = text.slice(i, i + 2);
        if (pair === "{{") { depth++; i++; }
        else if (pair === "}}" && --depth === 0) return i + 2;
    }
    return -1;
});

const SplitArguments = (function(body) {
    const args = [ ];
    let depth = 0, current = "";
    for (let i = 0; i < body.length; i++) {
        const pair = body.slice(i, i + 2);
        if (pair === "{{" || pair === "[[") { depth++; current += pair; i++; }
        else if (pair === "}}" || pair === "]]") { depth--; current += pair; i++; }
        else if (body[i] === "|" && depth === 0) { args.push(current); current = ""; }
        else current += body[i];
    }
    args.push(current);
    return args;
});

const CleanUsername = (function(value) {
    const cleaned = value
        .replace(/\[\[:?([^\]|]*)(?:\|[^\]]*)?\]\]/g, "$1")
        .replace(/^\s*(?:user|user talk)\s*:\s*/i, "")
        .trim();
    return cleaned && !/[{}[\]<>|]/.test(cleaned) ? cleaned : null;
});

export const ExtractSocklistUsers = (function(wikitext) {
    const users = new Set();
    const start = /\{\{\s*(?:template\s*:\s*)?sock[ _]?list\s*(?=[|}])/gi;

    for (const match of wikitext.matchAll(start)) {
        const end = FindTemplateEnd(wikitext, match.index);
        if (end === -1) continue;

        const body = wikitext.slice(match.index + match[0].length, end - 2);
        for (const arg of SplitArguments(body)) {
            const separator = arg.indexOf("=");
            const key = separator === -1 ? null : arg.slice(0, separator);
            if (key !== null && !/^\s*\d+\s*$/.test(key)) continue;

            const user = CleanUsername(separator === -1 ? arg : arg.slice(separator + 1));
            if (user) users.add(user);
        }
    }
    return [ ...users ];
});

export const GetSPISections = (function(wikitext) {
    const lines = wikitext.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
    const sections = [ ];

    let section = null, subsection = null;
    const finish = () => {
        if (!section) return;
        section.users = subsection ? ExtractSocklistUsers(subsection.lines.join("\n")) : [ ];
        sections.push(section);
    };

    const anchorCounts = new Map();

    for (const line of lines) {
        const heading = HEADING.exec(line);
        const level = heading?.[1].length;

        let anchor = "";
        if (heading) {
            const base = CleanHeading(heading[2]);
            const count = (anchorCounts.get(base.toLowerCase()) ?? 0) + 1;
            anchorCounts.set(base.toLowerCase(), count);
            anchor = count === 1 ? base : `${base} ${count}`;
        }

        if (level <= 3) {
            finish();
            if (level === 3) {
                section = { title: CleanHeading(heading[2]), anchor, users: [ ] };
                subsection = null;
            } else section = subsection = null;
        } else if (section && !subsection && level === 4)
            subsection = { lines: [ ] };
        else if (subsection && level === 4)
            subsection = { ...subsection, closed: true };
        else if (subsection && !subsection.closed)
            subsection.lines.push(line);
    }
    finish();

    return sections;
});
