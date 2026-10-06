import { OAuth } from "./core/OAuth.js";
import getUserData from "./get-user-data.js";

(async function(oauth) {
    await oauth.authenticate();
    getUserData(() => oauth.access(), [ "LuniZunie-Mentor" ], function callback({ status, data }) {
        console.log(status, data);
    });
})(new OAuth()).catch(error => console.error(error));
