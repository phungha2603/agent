import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { CompanyConfig } from "./schema";

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
  return parsed;
}
