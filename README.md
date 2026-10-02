# Acorns

A Wikipedia SPI tool.

## Server Setup

#### Clone the repository
```bash
git clone https://github.com/your-username/wikipedia-acorns.git
cd wikipedia-acorns
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

```javascript
const ws = new WebSocket("ws://localhost:3000");
ws.addEventListener("open", () => ws.send(`${token}:${username}`));
ws.addEventListener("message", ({ data }) => console.log(JSON.parse(data)));
ws.addEventListener("error", console.error);
```