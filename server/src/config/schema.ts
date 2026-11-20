export type Provider = "anthropic" | "openai" | "mock";

export type Schedule =
  | { kind: "daily"; times: string[] } // "HH:MM" 24h, in the company's timezone (see CompanyConfig.timezone)
  | { kind: "interval"; minutes: number }
  | { kind: "on_inbox" }; // runs as soon as something lands in its inbox

export interface PositionConfig {
  id: string;
  name: string; // "Sales · Tìm liên hệ"
  room: string; // "Phòng Sales" — groups positions in the UI
  role: string; // system prompt describing the job
  provider: Provider;
  model: string;
  apiKeyEnv?: string; // env var holding the API key (not needed for "mock")
  baseUrl?: string; // for OpenAI-compatible endpoints other than api.openai.com
  inboxTopics: string[]; // topics this position consumes from
  outboxTopic?: string; // topic this position publishes to
  outputSchemaHint?: string; // free text telling the model what JSON shape to emit
  schedule: Schedule;
}

export interface CompanyConfig {
  name: string;
  tickSeconds: number;
  /** IANA zone (e.g. "Asia/Ho_Chi_Minh") that "daily" schedule times are
   * interpreted in. Omitted: falls back to the server process's own local
   * time — fine for local dev, but on most PaaS hosts that's UTC, so a
   * deployed company should usually set this explicitly. */
  timezone?: string;
  positions: PositionConfig[];
}
