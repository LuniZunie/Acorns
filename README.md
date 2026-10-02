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
const ws = new WebSocket("ws://localhost:3000");
ws.addEventListener("open", () => ws.send(`${token}:${username}`));
ws.addEventListener("message", ({ data }) => {
    const json = JSON.parse(data);
    switch (json.event) {
        case "progress": {
            console.log(`Progress: ${json.progress.done}/${json.progress.total} (${((json.progress.done / json.progress.total) * 100).toFixed(2)}%)`);
        } break;
        case "done": {
            console.log("Data received:", json.data);
        } break;
        case "error": {
            console.error("Error:", json.error);
        } break;
    }
});
ws.addEventListener("error", console.error);
```