# Acorns

A Wikipedia SPI tool.

## Server Setup

#### Clone the repository
```bash
git clone https://github.com/LuniZunie/Acorns.git
cd Acorns
```

#### Install dependencies
```bash
npm install
```

#### Start the server
```bash
npm start
```

## Communication with the Server

Make sure to replace `${token}` and `${username}` with the actual token and username when connecting to the WebSocket server.
Usernames should be separated by the `|` character if you want to query multiple users at once.

```javascript
const websocket = new WebSocket("ws://localhost:3000");
websocket.addEventListener("open", () => { ws.send(`${token}:${username}`); });
websocket.addEventListener("message", ({ data }) => {
    const json = JSON.parse(data);
    switch (json.event) {
        case "progress": {
            const { done, total } = json.progress;

            /* ... */
        } break;
        case "done": {
            (async str => {
                // Decode the base64-encoded gzipped data into JSON
                const bin = atob(str);
                const len = bin.length;

                const buffer = new Uint8Array(len);
                for (let i = 0; i < len; i++)
                    buffer[i] = bin.charCodeAt(i);

                const stream = new Blob([ buffer ]).stream().pipeThrough(new DecompressionStream("gzip"));
                const decompressed= = await new Response(stream).arrayBuffer();
                const data = JSON.parse(new TextDecoder().decode(decompressed));

                /* ... */
            })(json.data);
        } break;
        case "error": {
            const { error } = json;

            /* ... */
        } break;
    }
});
websocket.addEventListener("close", () => { console.log("Connection closed"); });
websocket.addEventListener("error", error => { console.error("Connection error:", error); });
```