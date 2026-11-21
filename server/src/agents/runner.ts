import { PositionConfig } from "../config/schema";
import { StateStore } from "../state/db";
import { getAdapter } from "./adapter";
import { bus, EVT_STATE_CHANGED } from "../events/bus";

interface ParsedOutput {
  summary: string;
  items: unknown[];
}

/** Safety circuit breaker: if a company's config accidentally wires positions
 * into a cycle (A's outbox feeds B's inbox and vice versa), on_inbox
 * positions would otherwise re-trigger each other indefinitely — cheap with
 * the mock provider, but a real LLM provider would burn API spend non-stop.
 * Each queue item's depth = 1 + the deepest inbox item that produced it; once
 * a chain gets this deep it's almost certainly a loop, so new items past the
 * limit are dropped instead of forwarded. */
const MAX_CHAIN_DEPTH = 8;

/** If a shift fails after already consuming inbox items (network error, rate
 * limit, provider outage...), those items must not just vanish — they're put
 * back as unconsumed so a later shift retries them, up to this many times
 * before being left consumed (dropped) with a clear log line explaining why. */
const MAX_RETRIES = 3;

function buildUserPrompt(position: PositionConfig, inboxItems: { topic: string; payload: unknown }[]) {
  return [
    `Bạn đang đảm nhận vị trí "${position.name}" trong một công ty mô phỏng.`,
    `Đầu việc đang chờ trong hộp thư đến (đến từ các vị trí khác):`,
    JSON.stringify({ items: inboxItems }, null, 2),
    position.outboxTopic
      ? `Nếu tạo ra kết quả cần chuyển tiếp cho vị trí khác (topic "${position.outboxTopic}"), hãy liệt kê trong "items".`
      : `Vị trí này không chuyển tiếp việc cho ai khác — có thể để "items" rỗng.`,
    position.outputSchemaHint ? `Gợi ý định dạng item: ${position.outputSchemaHint}` : "",
    `Trả lời DUY NHẤT bằng JSON hợp lệ dạng {"summary": "<1 dòng tóm tắt bạn vừa làm gì>", "items": [...]}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseModelOutput(text: string, position: PositionConfig): ParsedOutput {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary : text.slice(0, 200),
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };
    } catch {
      // fall through to plain-text fallback below
    }
  }
  return { summary: text.slice(0, 200) || `${position.name} đã chạy xong`, items: [] };
}

export async function runShift(store: StateStore, position: PositionConfig): Promise<void> {
  store.updatePosition(position.id, { status: "running" });
  // The dashboard's history/time-scrubber view reconstructs "what status was
  // this position in at some past timestamp T" by taking the latest
  // level:"status" log row with ts <= T — `appendLog`'s "info"/"error" rows
  // carry a human summary, not a parseable status, and `positions.status`
  // itself has no history (each update overwrites it in place).
  store.appendLog(position.id, "running", "status");
  bus.emit(EVT_STATE_CHANGED);

  const rawInbox = store.takeUnconsumed(position.inboxTopics, position.id);
  const inboxItems = rawInbox.map((row) => ({
    topic: row.topic,
    payload: JSON.parse(row.payload),
  }));
  const nextDepth = rawInbox.length > 0 ? Math.max(...rawInbox.map((row) => row.depth)) + 1 : 0;

  try {
    const adapter = getAdapter(position);
    const userPrompt = buildUserPrompt(position, inboxItems);
    const { text } = await adapter.call(position.role, userPrompt, inboxItems);
    const { summary, items } = parseModelOutput(text, position);

    if (position.outboxTopic) {
      if (nextDepth > MAX_CHAIN_DEPTH) {
        store.appendLog(
          position.id,
          `Đã bỏ ${items.length} mục: vượt quá độ sâu chuỗi tối đa (${MAX_CHAIN_DEPTH}) — kiểm tra cấu hình có vòng lặp inbox/outbox không.`,
          "error"
        );
      } else {
        for (const item of items) {
          store.pushToQueue(position.outboxTopic, item, position.id, nextDepth);
        }
      }
    }

    store.appendLog(position.id, summary, "info");
    store.appendLog(position.id, "done", "status");
    store.updatePosition(position.id, {
      status: "done",
      lastRunAt: Date.now(),
      lastSummary: summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let retryNote = "";
    if (rawInbox.length > 0) {
      const { requeued, dropped } = store.requeueOrDrop(rawInbox, MAX_RETRIES);
      retryNote =
        requeued > 0 && dropped > 0
          ? ` (${requeued} mục sẽ thử lại, ${dropped} mục đã bỏ sau ${MAX_RETRIES} lần lỗi)`
          : requeued > 0
            ? ` (${requeued} mục sẽ thử lại ở lượt sau)`
            : ` (${dropped} mục đã bỏ sau ${MAX_RETRIES} lần lỗi)`;
    }
    store.appendLog(position.id, `Lỗi: ${message}${retryNote}`, "error");
    store.appendLog(position.id, "error", "status");
    store.updatePosition(position.id, {
      status: "error",
      lastRunAt: Date.now(),
      lastSummary: `Lỗi: ${message}`,
    });
  } finally {
    bus.emit(EVT_STATE_CHANGED);
  }
}
