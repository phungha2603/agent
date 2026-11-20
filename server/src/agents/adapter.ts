import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { PositionConfig } from "../config/schema";

export interface AgentCallResult {
  text: string;
}

export interface InboxItem {
  topic: string;
  payload: Record<string, unknown>;
}

export interface LLMAdapter {
  /** `inboxItems` is passed alongside the rendered prompts purely so MockAdapter can
   *  simulate realistically without re-parsing text; real adapters ignore it. */
  call(systemPrompt: string, userPrompt: string, inboxItems: InboxItem[]): Promise<AgentCallResult>;
}

function mockTransform(positionId: string, input: Record<string, unknown> | null): Record<string, unknown> {
  const n = Math.floor(100 + Math.random() * 900);
  switch (positionId) {
    case "sourcing":
      return { company: `Công ty Demo ${n}`, industry: "Bán lẻ" };
    case "sales_contact":
      return { ...input, email: `contact${n}@demo.test`, phone: `09${n}xxxxxx` };
    case "marketing_outreach":
      return {
        ...input,
        message: `Xin chào ${input?.company ?? "quý khách"}, chúng tôi muốn giới thiệu sản phẩm...`,
      };
    case "purchasing":
      return { item: `Vật tư ${n}`, quantity: Math.ceil(Math.random() * 5) };
    default:
      return { ...input, note: `đã xử lý bởi ${positionId}` };
  }
}

/** No API key needed — lets you run/demo the whole orchestration for free. */
class MockAdapter implements LLMAdapter {
  constructor(private position: PositionConfig) {}

  async call(_systemPrompt: string, _userPrompt: string, inboxItems: InboxItem[]): Promise<AgentCallResult> {
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));

    const items: unknown[] = [];
    if (this.position.outboxTopic) {
      if (inboxItems.length > 0) {
        for (const inbox of inboxItems) items.push(mockTransform(this.position.id, inbox.payload));
      } else if (this.position.inboxTopics.length === 0) {
        // a "generator" position with no inbox — invents new work each shift
        items.push(mockTransform(this.position.id, null));
      }
    }

    const summary =
      items.length > 0
        ? `[mock] ${this.position.name} đã tạo ${items.length} mục mới`
        : inboxItems.length > 0
          ? `[mock] ${this.position.name} đã xử lý ${inboxItems.length} mục (không tạo đầu ra mới)`
          : `[mock] ${this.position.name} không có việc mới`;

    return { text: JSON.stringify({ summary, items }) };
  }
}

class AnthropicAdapter implements LLMAdapter {
  private client: Anthropic;
  constructor(private position: PositionConfig, apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async call(systemPrompt: string, userPrompt: string, _inboxItems: InboxItem[]): Promise<AgentCallResult> {
    const resp = await this.client.messages.create({
      model: this.position.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return { text };
  }
}

class OpenAICompatAdapter implements LLMAdapter {
  private client: OpenAI;
  constructor(private position: PositionConfig, apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async call(systemPrompt: string, userPrompt: string, _inboxItems: InboxItem[]): Promise<AgentCallResult> {
    const resp = await this.client.chat.completions.create({
      model: this.position.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    return { text: resp.choices[0]?.message?.content ?? "" };
  }
}

export function getAdapter(position: PositionConfig): LLMAdapter {
  switch (position.provider) {
    case "mock":
      return new MockAdapter(position);
    case "anthropic": {
      const key = position.apiKeyEnv ? process.env[position.apiKeyEnv] : undefined;
      if (!key) {
        throw new Error(
          `Position "${position.id}" dùng provider anthropic nhưng thiếu env var ${position.apiKeyEnv}`
        );
      }
      return new AnthropicAdapter(position, key);
    }
    case "openai": {
      const key = position.apiKeyEnv ? process.env[position.apiKeyEnv] : undefined;
      if (!key) {
        throw new Error(
          `Position "${position.id}" dùng provider openai nhưng thiếu env var ${position.apiKeyEnv}`
        );
      }
      return new OpenAICompatAdapter(position, key, position.baseUrl);
    }
    default:
      throw new Error(`Provider không hỗ trợ: ${position.provider}`);
  }
}
