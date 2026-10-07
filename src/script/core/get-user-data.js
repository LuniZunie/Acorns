export function GetUserData(getToken, users, projectRules, callback = () => { }) {
    if (typeof getToken !== "function")
        throw new Error("(get-user-data) Token getter must be a function");
    if (!Array.isArray(users))
        throw new Error("(get-user-data) Usernames must be an array");
    if (!Array.isArray(projectRules))
        throw new Error("(get-user-data) Project rules must be an array");
    if (typeof callback !== "function")
        throw new Error("(get-user-data) Invalid callback");

    const worker = new Worker(new URL("../worker/get-user-data.js", import.meta.url), { type: "module" });
    let closed = false;

    const close = () => {
        if (closed) return;
        closed = true;
        worker.terminate();
    };

    worker.addEventListener("message", async event => {
        const message = event.data;

        if (message.type === "token-request") {
            try {
                const token = await getToken();
                worker.postMessage({ type: "token-response", id: message.id, token });
            } catch (error) {
                worker.postMessage({
                    type: "token-response",
                    id: message.id,
                    error: String(error)
                });
            }
        } else if (message.type === "history") {
            const state = history.state ?? { };
            history.replaceState({ ...state, ...message.state }, "");
        } else if (message.type === "result") {
            const { status, data } = message.result;
            if (status === "error") {
                const error = new Error(data.message);
                error.name = data.name;
                if (data.stack) error.stack = data.stack;

                close();
                callback({ status, data: error });
            } else if (status === "done") close();

            callback(message.result);
        }
    });

    worker.addEventListener("error", event => {
        close();
        callback({ status: "error", data: new Error(event.message) });
    });

    worker.postMessage({ type: "start", users, projectRules });
    return { close };
}