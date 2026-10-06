import { OAuth } from "./core/oauth.js";
import getUserData from "./get-user-data.js";

new OAuth()
    .then(async function(oauth) {
        await oauth.authenticate();
        getUserData(() => oauth.access(), [ "LuniZunie-Mentor" ], function callback({ status, data }) {
            console.log(status, data);
        });
    })
    .catch(error => console.error(error));
