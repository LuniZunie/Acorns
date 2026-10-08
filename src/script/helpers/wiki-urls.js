const encodeTitle = title => encodeURIComponent(title.replaceAll(" ", "_"));

export const GetOrigin = project => new URL(`https://${project}`).origin;

export const GetPageURL = (project, title) =>
    new URL(`/wiki/${encodeTitle(title)}`, GetOrigin(project)).href;

export const GetContributionsURL = (project, username) =>
    new URL(`/wiki/Special:Contributions/${encodeTitle(username)}`, GetOrigin(project)).href;

export const GetGlobalContributionsURL = username =>
    new URL(`/wiki/Special:GlobalContributions/${encodeTitle(username)}`, "https://meta.wikimedia.org").href;

export function GetDiffURL(project, revid, parentid) {
    const url = new URL("/w/index.php", GetOrigin(project));
    url.searchParams.set("diff", revid);
    url.searchParams.set("oldid", parentid);
    return url.href;
}

export function GetLogURL(project, logid) {
    const url = new URL("/w/index.php", GetOrigin(project));
    url.searchParams.set("title", "Special:Log");
    url.searchParams.set("logid", logid);
    return url.href;
}