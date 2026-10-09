export const GetUserData = (function(getToken, users, projectRules, callback = () => { }) {
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
    const close = (() => {
        if (closed) return;
        closed = true;
        worker.terminate();
    });

    worker.addEventListener("message", async function(e) {
        const message = e.data;
        switch (message.type) {
            case "token-request": {
                try {
                    worker.postMessage({ type: "token-response", id: message.id, token: await getToken() });
                } catch (error) { worker.postMessage({ type: "token-response", id: message.id, error: String(error) }); }
            } break;
            case "history": {
                const state = history.state ?? { };
                history.replaceState({ ...state, ...message.state, submit: false, reload: true }, "");
                history.pushState({ ...state, ...message.state }, "");
            } break;
            case "result": {
                const { status, data } = message.result;
                if (status === "error") {
                    const error = new Error(data.message);
                    error.name = data.name;
                    if (data.stack) error.stack = data.stack;

                    close();
                    callback({ status, data: error });
                } else if (status === "done") close();

                callback(message.result);
            } break;
            default: console.warn(`Unknown message type from WebWorker: ${message.type}.`, message);
        }
    });

    worker.addEventListener("error", e => {
        close();
        callback({ status: "error", data: new Error(e.message) });
    });

    worker.postMessage({ type: "start", users, projectRules });
    return { close };
});