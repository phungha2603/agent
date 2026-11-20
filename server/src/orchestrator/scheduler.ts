import { PositionConfig } from "../config/schema";
import { StateStore } from "../state/db";
import { runShift } from "../agents/runner";
import { bus, EVT_STATE_CHANGED } from "../events/bus";
import { nextDailyTimestamp } from "./time";

export class Scheduler {
  private timer?: NodeJS.Timeout;
  private runningIds = new Set<string>();

  constructor(
    private store: StateStore,
    private positions: PositionConfig[],
    private tickSeconds: number
  ) {}

  start() {
    for (const p of this.positions) {
      this.store.ensurePosition(p.id);
      this.store.updatePosition(p.id, { nextRunAt: this.computeNextRunAt(p) });
    }
    bus.emit(EVT_STATE_CHANGED);
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error("Lỗi scheduler tick:", e));
    }, this.tickSeconds * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private computeNextRunAt(p: PositionConfig): number | null {
    if (p.schedule.kind === "daily") return nextDailyTimestamp(p.schedule.times);
    if (p.schedule.kind === "interval") {
      const state = this.store.getPosition(p.id);
      const base = state?.lastRunAt ?? Date.now();
      return base + p.schedule.minutes * 60_000;
    }
    return null; // "on_inbox" has no fixed clock time
  }

  private async tick() {
    const now = Date.now();
    for (const p of this.positions) {
      if (this.runningIds.has(p.id)) continue;

      let due: boolean;
      if (p.schedule.kind === "on_inbox") {
        due = p.inboxTopics.some((topic) => this.store.countUnconsumed(topic) > 0);
      } else {
        const state = this.store.getPosition(p.id);
        const nextRunAt = state?.nextRunAt ?? this.computeNextRunAt(p);
        due = nextRunAt !== null && now >= nextRunAt;
      }
      if (!due) continue;

      this.runningIds.add(p.id);
      runShift(this.store, p)
        .catch((e) => console.error(`Lỗi khi chạy vị trí ${p.id}:`, e))
        .finally(() => {
          this.runningIds.delete(p.id);
          this.store.updatePosition(p.id, { nextRunAt: this.computeNextRunAt(p) });
          bus.emit(EVT_STATE_CHANGED);
        });
    }
  }
}
