import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

interface GameState {
  isLocked: boolean;
  firstBuzzer: string | null;
  buzzedAt: number | null;
  players: string[];
  roundId: number;
}

// Memory state for the buzzer app
let gameState: GameState = {
  isLocked: false,
  firstBuzzer: null,
  buzzedAt: null,
  players: [],
  roundId: 1
};

// SSE Connected clients
let clients: express.Response[] = [];

// Broadcast state to all connected clients
function broadcastState() {
  const data = `data: ${JSON.stringify(gameState)}\n\n`;
  clients.forEach(client => {
    try {
      client.write(data);
    } catch (err) {
      // Ignore write errors for disconnected clients
    }
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Support JSON body parsing
  app.use(express.json());

  // API Routes
  app.get("/api/state", (req, res) => {
    res.json(gameState);
  });

  // SSE Stream
  app.get("/api/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Send initial state immediately
    res.write(`data: ${JSON.stringify(gameState)}\n\n`);

    clients.push(res);

    req.on("close", () => {
      clients = clients.filter(client => client !== res);
    });
  });

  // Join Room
  app.post("/api/join", (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "請輸入有效的姓名" });
    }

    const trimmedName = name.trim();
    if (!gameState.players.includes(trimmedName)) {
      gameState.players.push(trimmedName);
      broadcastState();
    }
    res.json({ success: true, gameState });
  });

  // Buzz In
  app.post("/api/buzz", (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "請提供有效的玩家姓名" });
    }

    const trimmedName = name.trim();

    // Auto add player to list if they aren't there yet
    if (!gameState.players.includes(trimmedName)) {
      gameState.players.push(trimmedName);
    }

    if (!gameState.isLocked) {
      gameState.isLocked = true;
      gameState.firstBuzzer = trimmedName;
      gameState.buzzedAt = Date.now();
      broadcastState();
      res.json({ success: true, isFirst: true, firstBuzzer: trimmedName });
    } else {
      res.json({ success: false, isFirst: false, firstBuzzer: gameState.firstBuzzer });
    }
  });

  // Reset buzzer for next round
  app.post("/api/reset", (req, res) => {
    gameState.isLocked = false;
    gameState.firstBuzzer = null;
    gameState.buzzedAt = null;
    gameState.roundId += 1;
    broadcastState();
    res.json({ success: true, gameState });
  });

  // Clear all players & reset room
  app.post("/api/clear-all", (req, res) => {
    gameState.isLocked = false;
    gameState.firstBuzzer = null;
    gameState.buzzedAt = null;
    gameState.players = [];
    gameState.roundId += 1;
    broadcastState();
    res.json({ success: true, gameState });
  });

  // Serve static assets or mount Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Buzzer Server running on port ${PORT}`);
  });
}

startServer();
