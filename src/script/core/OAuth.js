import { Storage } from "../helpers/storage.js";

export class OAuth {
    static #CLIENT = "c2513c585c4e5227f04b90cdf6cdd479";
    static #REDIRECT_URI = `${location.origin}/callback`;
    static #WS_URL = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;

    #token;
    #refreshing;

    async authenticate() {
        try {
            this.#token = JSON.parse(Storage.getItem("token"));
            if (typeof this.#token?.access !== "string" || typeof this.#token?.refresh !== "string" || typeof this.#token?.expires !== "number")
                throw new Error("Invalid token format");

            return this.access();
        } catch (error) {
            console.error(error);
            this.#token = undefined;
        }

        let tab;
        let done = false;
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(OAuth.#WS_URL);
            ws.addEventListener("open", () => {
                ws.send("#auth");
                ws.addEventListener("message", e => {
                    const { event, data } = JSON.parse(e.data);
                    switch (event) {
                        case "ready": {
                            const params = new URLSearchParams({
                                response_type: "code",
                                client_id: OAuth.#CLIENT,
                                redirect_uri: OAuth.#REDIRECT_URI,
                                state: data.state,
                                code_challenge: data.challenge,
                                code_challenge_method: "S256"
                            });
                            tab = window.open(`https://meta.wikimedia.org/w/rest.php/oauth2/authorize?${params.toString()}`);
                        } break;
                        case "success": {
                            fetch("https://meta.wikimedia.org/w/rest.php/oauth2/access_token", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/x-www-form-urlencoded"
                                },
                                body: new URLSearchParams({
                                    grant_type: "authorization_code",
                                    code: data.code,
                                    redirect_uri: OAuth.#REDIRECT_URI,
                                    client_id: OAuth.#CLIENT,
                                    code_verifier: data.verifier
                                })
                            })
                                .then(response => {
                                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                                    return response.json();
                                })
                                .then(data => {
                                    this.#token = { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + data.expires_in * 1000 };
                                    Storage.setItem("token", JSON.stringify(this.#token));
                                    resolve({ ...this.#token });
                                })
                                .catch(error => reject({ error }));

                            done = true;
                            ws.close();
                        } break;
                        default: {
                            reject({ rejected: event });

                            done = true;
                            ws.close();
                        } break;
                    }
                });
                ws.addEventListener("close", () => {
                    if (tab) tab.close();
                    if (!done) {
                        reject({ rejected: "closed" });
                        done = true;
                    }
                });
                ws.addEventListener("error", error => {
                    reject({ error });

                    done = true;
                    ws.close();
                });
            });
        });
    }

    async access() {
        if (this.#token?.access && Date.now() < this.#token.expires) {
            Storage.setItem("token", JSON.stringify(this.#token));
            return { ...this.#token };
        } else if (this.#token.refresh)
            return this.#refreshing ??= new Promise((resolve, reject) => {
                fetch("https://meta.wikimedia.org/w/rest.php/oauth2/access_token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: new URLSearchParams({
                        grant_type: "refresh_token",
                        refresh_token: this.#token.refresh,
                        client_id: OAuth.#CLIENT
                    })
                })
                    .then(response => {
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        return response.json();
                    })
                    .then(data => {
                        this.#token = { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + data.expires_in * 1000 };
                        Storage.setItem("token", JSON.stringify(this.#token));
                        resolve({ ...this.#token });
                    })
                    .catch(error => reject({ error }));
            }).finally(() => { this.#refreshing = undefined; }); // refresh tokens rotate, so concurrent callers must share one refresh
        else
            throw new Error("No valid access or refresh token available.");
    }
}