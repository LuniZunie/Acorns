const ws = new WebSocket("ws://localhost:3000");
ws.addEventListener("open", () => {
    ws.send("#ping");
    ws.addEventListener("message", event => {
        if (event.data === "pong") {
            document.body.querySelector("p").textContent = "Connected to server.";
            ws.close();
        } else {
            document.body.querySelector("p").textContent = "Unexpected message from server.";
            console.warn("Unexpected message from server:", event.data);
        }
    });
    ws.addEventListener("error", error => {
        document.body.querySelector("p").textContent = "Error connecting to server.";
        console.error("WebSocket error:", error);
    });
});