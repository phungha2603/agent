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
const scheduler = new Scheduler(store, config.positions, config.tickSeconds, config.timezone);

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

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[company] Nhận ${signal}, đang dừng (chờ ca đang chạy xong, tối đa 10s)...`);
  scheduler.stop();
  await scheduler.drain(10_000);
  store.checkpoint();
  store.close();
  httpServer.close(() => process.exit(0));
  // In case something (an open socket, a stuck connection) keeps the server
  // from closing cleanly, don't let the process hang past Docker's own stop
  // timeout — just exit; checkpoint()/close() above already ran.
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
