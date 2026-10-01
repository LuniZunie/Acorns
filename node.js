import fetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";

const RATE_LIMIT = {
    base: 2e3 / 6e4, // 2000 requests per minute (https://mediawiki.org/wiki/Wikimedia_APIs/Rate_limits#Limits),
    types: {

    }
};

if (Object.values(RATE_LIMIT.types).reduce((a, b) => a + b, 0) > 1)
    throw new Error("Rate limit types exceed base limit");

const mwFetch = (async function(url, params = { }) {
    return await this.sessionFetch(`${url}/w/api.php`, {
        method: "POST",
        headers: {
            "User-Agent": "Acorns/1.0 (https://github.com/LuniZunie/Acorns)",
            "Authorization": `Bearer ${process.env.TOKEN}`,
        },
        body: new URLSearchParams({
            ...params,
            format: "json",
            formatversion: "2"
        })
    });
}).bind({ sessionFetch: fetchCookie(fetch, new CookieJar()) });

mwFetch("https://meta.wikimedia.org", {
	"action": "query",
	"meta": "globaluserinfo",
    "guiprop": "merged"
})  .then(response => response.json())
    .then(data => {
        console.log(data.query.globaluserinfo.merged);
    }).catch(error => {
        console.error(error);
    });