export default function(token, users, callback = () => { }) {
    if (typeof token !== "string")
        throw new Error("(get-user-data) Invalid token");
    if (!Array.isArray(users))
        throw new Error("(get-user-data) Usernames must be an array");
    if (typeof callback !== "function")
        throw new Error("(get-user-data) Invalid callback");

    users = users.filter(user => user && typeof user === "string");
    if (users.length === 0) {
        callback({ status: "progress", data: 1 });
        callback({ status: "done", data: [ ] });
        callback({ status: "websocket-close" });
        return;
    }

    const ws = new WebSocket("ws://localhost:3000");
    ws.addEventListener("open", () => { ws.send(`${token}:${users.map(user => encodeURIComponent(user)).join("|")}`); });
    ws.addEventListener("message", ({ data }) => {
        const json = JSON.parse(data);
        switch (json.event) {
            case "progress": {
                callback({ status: "progress", data: json.progress });
            } break;
            case "done": {
                const parseUser = (async str => {
                    // Decode the base64-encoded gzipped data into JSON
                    const bin = atob(str);
                    const len = bin.length;

                    const buffer = new Uint8Array(len);
                    for (let i = 0; i < len; i++)
                        buffer[i] = bin.charCodeAt(i);

                    const stream = new Blob([ buffer ]).stream().pipeThrough(new DecompressionStream("gzip"));
                    const decompressed = await new Response(stream).arrayBuffer();
                    const data = JSON.parse(new TextDecoder().decode(decompressed));

                    const __de__ = ((type, value) => {
                        if (type === "string") {
                            if (value === undefined) return "";
                            return decodeURIComponent(data.__lookup__.string[value]);
                        } else if (type === "array") {
                            if (value === undefined) return [ ];
                            return data.__lookup__.array[value].split("|").map(item => __de__("string", item));
                        }
                    });

                    if ("groups" in data) data.groups = __de__("array", data.groups);
                    else data.groups = [ ];

                    if ("rights" in data) data.rights = __de__("array", data.rights);
                    else data.rights = [ ];

                    if ("blocks" in data) data.blocks = data.blocks.map(block => ({ ...block, reason: __de__("string", block.reason) }));
                    else data.blocks = [ ];

                    if ("uploads" in data)
                        data.uploads = data.uploads.map(upload =>
                            ({ ...upload, title: __de__("string", upload.title), comment: __de__("string", upload.comment), tags: __de__("array", upload.tags) })
                        );
                    else data.uploads = [ ];

                    for (const project of data.projects) {
                        if ("blocks" in project) project.blocks = project.blocks.map(block => ({ ...block, reason: __de__("string", block.reason) }));
                        else project.blocks = [ ];

                        if ("edits" in project)
                            for (const edit of project.edits) {
                                edit.title = __de__("string", edit.title);
                                edit.comment = __de__("string", edit.comment);
                                edit.tags = __de__("array", edit.tags);

                                if ("categories" in edit) edit.categories = __de__("array", edit.categories);
                                else edit.categories = [ ];

                                if ("images" in edit) {
                                    edit.images["+"] = __de__("array", edit.images["+"]);
                                    edit.images["-"] = __de__("array", edit.images["-"]);
                                } else edit.images = { "+": [ ], "-": [ ] };

                                if ("links" in edit) {
                                    edit.links["+"] = __de__("array", edit.links["+"]);
                                    edit.links["-"] = __de__("array", edit.links["-"]);
                                } else edit.links = { "+": [ ], "-": [ ] };
                            }
                        else project.edits = [ ];
                    }

                    delete data.__lookup__;

                    return data;
                });

                Promise.all(json.data.map(parseUser)).then(data => {
                    callback({ status: "done", data });
                    ws.close();
                });
            } break;
            case "error": {
                callback({ status: "script-error", data: json.error });
                ws.close();
            } break;
        }
    });
    ws.addEventListener("close", () => {
        callback({ status: "websocket-close" });
    });
    ws.addEventListener("error", error => {
        callback({ status: "websocket-error", data: error });
        ws.close();
    });

    return { close: () => ws.close() };
}