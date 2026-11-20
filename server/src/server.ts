import "dotenv/config";
import path from "path";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import { loadConfig } from "./config/loadConfig";
import { StateStore } from "./state/db";
import { Scheduler } from "./orchestrator/scheduler";
import { bus, EVT_STATE_CHANGED } from "./events/bus";

const CONFIG_PATH =
  process.env.COMPANY_CONFIG || path.join(__dirname, "config", "positions.example.yaml");
const DB_PATH = process.env.COMPANY_DB || path.join(__dirname, "..", "data", "company.db");
const PORT = Number(process.env.PORT || 3000);

const config = loadConfig(CONFIG_PATH);
const store = new StateStore(DB_PATH);
const scheduler = new Scheduler(store, config.positions, config.tickSeconds);

function snapshot() {
  const positions = config.positions.map((p) => {
    const state = store.getPosition(p.id);
    return {
      id: p.id,
      name: p.name,
      room: p.room,
      provider: p.provider,
      model: p.model,
      status: state?.status ?? "waiting_shift",
      lastRunAt: state?.lastRunAt ?? null,
      nextRunAt: state?.nextRunAt ?? null,
      lastSummary: state?.lastSummary ?? null,
    };
  });
  const logs = store.recentLogs(50).map((l) => ({
    positionId: l.positionId,
    ts: l.ts,
    level: l.level,
    message: l.message,
  }));
  return { companyName: config.name, positions, logs };
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/state", (_req, res) => {
  res.json(snapshot());
});

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  socket.emit("state", snapshot());
});

bus.on(EVT_STATE_CHANGED, () => {
  io.emit("state", snapshot());
});

httpServer.listen(PORT, () => {
  console.log(`[company] "${config.name}" đang chạy tại http://localhost:${PORT}`);
  console.log(`[company] Config: ${CONFIG_PATH}`);
  scheduler.start();
});

process.on("SIGINT", () => {
  scheduler.stop();
  process.exit(0);
});
