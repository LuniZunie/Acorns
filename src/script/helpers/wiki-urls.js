const EncodeTitle = (function(title) { return encodeURIComponent(title.replaceAll(" ", "_")); });

export const GetOrigin = (function(project) { return new URL(`https://${project}`).origin; });
export const GetPageURL = (function(project, title) { return new URL(`/wiki/${EncodeTitle(title)}`, GetOrigin(project)).href; });

export const GetContributionsURL = (function(project, username) {
    return new URL(`/wiki/Special:Contributions/${EncodeTitle(username)}`, GetOrigin(project)).href;
});
export const GetGlobalContributionsURL = (function(project, username) {
    return new URL(`/wiki/Special:GlobalContributions/${EncodeTitle(username)}`, "https://meta.wikimedia.org").href;
});

export const GetDiffURL = (function(project, revid, parentid) {
    const url = new URL("/w/index.php", GetOrigin(project));
    url.searchParams.set("diff", revid);
    url.searchParams.set("oldid", parentid);
    return url.href;
});

export const GetLogURL = (function(project, logid) {
    const url = new URL("/w/index.php", GetOrigin(project));
    url.searchParams.set("title", "Special:Log");
    url.searchParams.set("logid", logid);
    return url.href;
});