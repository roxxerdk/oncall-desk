import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "node:http";
import { Server } from "socket.io";
import aiRouter from "./routes/ai.js";
import { registerSignaling } from "./signaling.js";

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3001);
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.disable("x-powered-by");
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json({ limit: "20kb" }));
app.use("/api/ai", aiRouter);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST"],
  },
});

registerSignaling(io);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "oncall-desk-backend",
  });
});

app.use((err, _req, res, _next) => {
  console.error("Request error:", err.message);

  res.status(500).json({
    error: "Internal server error",
  });
});

server.listen(PORT, () => {
  console.log(`OnCall Desk backend listening on port ${PORT}`);
});
