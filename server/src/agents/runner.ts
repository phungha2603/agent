import { PositionConfig } from "../config/schema";
import { StateStore } from "../state/db";
import { getAdapter } from "./adapter";
import { bus, EVT_STATE_CHANGED } from "../events/bus";

interface ParsedOutput {
  summary: string;
  items: unknown[];
}

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
  bus.emit(EVT_STATE_CHANGED);

  const rawInbox = store.takeUnconsumed(position.inboxTopics, position.id);
  const inboxItems = rawInbox.map((row) => ({
    topic: row.topic,
    payload: JSON.parse(row.payload),
  }));

  try {
    const adapter = getAdapter(position);
    const userPrompt = buildUserPrompt(position, inboxItems);
    const { text } = await adapter.call(position.role, userPrompt, inboxItems);
    const { summary, items } = parseModelOutput(text, position);

    if (position.outboxTopic) {
      for (const item of items) {
        store.pushToQueue(position.outboxTopic, item, position.id);
      }
    }

    store.appendLog(position.id, summary, "info");
    store.updatePosition(position.id, {
      status: "done",
      lastRunAt: Date.now(),
      lastSummary: summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.appendLog(position.id, `Lỗi: ${message}`, "error");
    store.updatePosition(position.id, {
      status: "error",
      lastRunAt: Date.now(),
      lastSummary: `Lỗi: ${message}`,
    });
  } finally {
    bus.emit(EVT_STATE_CHANGED);
  }
}
