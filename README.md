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
ws.addEventListener("message", ({ data }) => console.log(JSON.parse(data)));
ws.addEventListener("error", console.error);
```