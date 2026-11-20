import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { CompanyConfig } from "./schema";

/** Catches the config mistakes most likely when hand-editing/adding many
 * positions: a topic nobody reads, a topic nobody writes, or a non-mock
 * position missing the env var it needs. The first two are just warnings
 * (the position still runs, it just never gets/sends anything on that
 * topic); a missing API key is fatal — better to fail at startup than have
 * that position silently error on every shift. */
function validateCompanyConfig(config: CompanyConfig, configPath: string) {
  const producers = new Map<string, string[]>(); // topic -> position ids that write it
  const consumers = new Map<string, string[]>(); // topic -> position ids that read it

  for (const p of config.positions) {
    if (p.outboxTopic) {
      producers.set(p.outboxTopic, [...(producers.get(p.outboxTopic) ?? []), p.id]);
    }
    for (const topic of p.inboxTopics) {
      consumers.set(topic, [...(consumers.get(topic) ?? []), p.id]);
    }
  }

  for (const [topic, from] of producers) {
    if (!consumers.has(topic)) {
      console.warn(
        `[config] Cảnh báo: topic "${topic}" (do ${from.join(", ")} tạo ra) không có vị trí nào đọc — dữ liệu sẽ không bao giờ được xử lý tiếp.`
      );
    }
  }
  for (const [topic, to] of consumers) {
    if (!producers.has(topic)) {
      console.warn(
        `[config] Cảnh báo: topic "${topic}" (${to.join(", ")} đang chờ đọc) không có vị trí nào tạo ra — hộp thư đến sẽ luôn trống.`
      );
    }
  }

  for (const p of config.positions) {
    if (p.provider === "mock") continue;
    if (!p.apiKeyEnv || !process.env[p.apiKeyEnv]) {
      throw new Error(
        `Config tại ${configPath}: vị trí "${p.id}" dùng provider "${p.provider}" nhưng biến môi trường ` +
          `${p.apiKeyEnv ? `"${p.apiKeyEnv}"` : "(apiKeyEnv chưa khai báo)"} không có giá trị. ` +
          `Set biến này (xem .env.example) hoặc đổi provider về "mock" trước khi chạy.`
      );
    }
  }
}

export function loadConfig(configPath: string): CompanyConfig {
  const resolved = path.resolve(configPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = yaml.load(raw) as CompanyConfig;

  if (!parsed || !Array.isArray(parsed.positions)) {
    throw new Error(`Config tại ${resolved} thiếu "positions"`);
  }
  const ids = new Set<string>();
  for (const p of parsed.positions) {
    if (ids.has(p.id)) {
      throw new Error(`Position id trùng lặp: ${p.id}`);
    }
    ids.add(p.id);
  }
  if (!parsed.tickSeconds) parsed.tickSeconds = 15;
  if (parsed.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: parsed.timezone });
    } catch {
      throw new Error(`"timezone" không hợp lệ trong config: ${parsed.timezone}`);
    }
  }
  validateCompanyConfig(parsed, resolved);
  return parsed;
}
