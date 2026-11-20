import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export type PositionStatus = "waiting_shift" | "running" | "done" | "error";

export interface PositionState {
  id: string;
  status: PositionStatus;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastSummary: string | null;
}

export interface QueueItem {
  id: number;
  topic: string;
  payload: string; // JSON
  createdBy: string;
  createdAt: number;
  consumedBy: string | null;
  consumedAt: number | null;
  depth: number;
}

export interface LogEntry {
  id: number;
  positionId: string;
  ts: number;
  level: "info" | "error";
  message: string;
}

export class StateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'waiting_shift',
        lastRunAt INTEGER,
        nextRunAt INTEGER,
        lastSummary TEXT
      );
      CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        payload TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        consumedBy TEXT,
        consumedAt INTEGER,
        depth INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_queue_topic_unconsumed
        ON queue (topic, consumedAt);
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        positionId TEXT NOT NULL,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL
      );
    `);
  }

  ensurePosition(id: string) {
    this.db
      .prepare(`INSERT OR IGNORE INTO positions (id, status) VALUES (?, 'waiting_shift')`)
      .run(id);
  }

  getPosition(id: string): PositionState | undefined {
    return this.db.prepare(`SELECT * FROM positions WHERE id = ?`).get(id) as
      | PositionState
      | undefined;
  }

  getAllPositions(): PositionState[] {
    return this.db.prepare(`SELECT * FROM positions`).all() as PositionState[];
  }

  updatePosition(id: string, patch: Partial<Omit<PositionState, "id">>) {
    const current = this.getPosition(id);
    if (!current) {
      this.ensurePosition(id);
    }
    const next = { ...this.getPosition(id)!, ...patch };
    this.db
      .prepare(
        `UPDATE positions SET status = ?, lastRunAt = ?, nextRunAt = ?, lastSummary = ? WHERE id = ?`
      )
      .run(next.status, next.lastRunAt, next.nextRunAt, next.lastSummary, id);
    return next;
  }

  pushToQueue(topic: string, payload: unknown, createdBy: string, depth = 0) {
    this.db
      .prepare(
        `INSERT INTO queue (topic, payload, createdBy, createdAt, depth) VALUES (?, ?, ?, ?, ?)`
      )
      .run(topic, JSON.stringify(payload), createdBy, Date.now(), depth);
  }

  countUnconsumed(topic: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM queue WHERE topic = ? AND consumedAt IS NULL`
      )
      .get(topic) as { n: number };
    return row.n;
  }

  /** Pops (marks consumed) and returns all unconsumed items for the given topics. */
  takeUnconsumed(topics: string[], consumedBy: string): QueueItem[] {
    if (topics.length === 0) return [];
    const placeholders = topics.map(() => "?").join(",");
    const items = this.db
      .prepare(
        `SELECT * FROM queue WHERE topic IN (${placeholders}) AND consumedAt IS NULL ORDER BY createdAt ASC`
      )
      .all(...topics) as QueueItem[];
    if (items.length === 0) return items;
    const now = Date.now();
    const update = this.db.prepare(
      `UPDATE queue SET consumedBy = ?, consumedAt = ? WHERE id = ?`
    );
    const tx = this.db.transaction((rows: QueueItem[]) => {
      for (const row of rows) update.run(consumedBy, now, row.id);
    });
    tx(items);
    return items;
  }

  appendLog(positionId: string, message: string, level: "info" | "error" = "info") {
    this.db
      .prepare(
        `INSERT INTO logs (positionId, ts, level, message) VALUES (?, ?, ?, ?)`
      )
      .run(positionId, Date.now(), level, message);
  }

  recentLogs(limit = 100): LogEntry[] {
    return this.db
      .prepare(`SELECT * FROM logs ORDER BY id DESC LIMIT ?`)
      .all(limit) as LogEntry[];
  }
}
