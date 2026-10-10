import Anthropic from "@anthropic-ai/sdk";
import type { Completion, Provider, ToolDef, Turn } from "./types";

export class AnthropicProvider implements Provider {
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 5 * 60 * 1000 });
  }

  async complete(req: {
    system: string;
    turns: Turn[];
    tools: ToolDef[];
    maxTokens: number;
  }): Promise<Completion> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      // Cache the stable prefix: tools, system prompt and the first user message. Later turns hit it.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        strict: true,
        input_schema: t.schema as Anthropic.Tool.InputSchema,
      })),
      messages: req.turns.map(toMessage),
    });
    if (response.stop_reason === "refusal") {
      throw new Error(`model refused: ${response.stop_details?.category ?? "unknown category"}`);
    }
    return {
      text: response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n"),
      calls: response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input })),
      usage: {
        input:
          response.usage.input_tokens +
          (response.usage.cache_read_input_tokens ?? 0) +
          (response.usage.cache_creation_input_tokens ?? 0),
        output: response.usage.output_tokens,
        cached: response.usage.cache_read_input_tokens ?? 0,
      },
      stop: response.stop_reason ?? "unknown",
      raw: response.content,
    };
  }
}

function toMessage(turn: Turn, index: number): Anthropic.MessageParam {
  switch (turn.role) {
    case "user":
      return index === 0
        ? {
            role: "user",
            content: [{ type: "text", text: turn.text, cache_control: { type: "ephemeral" } }],
          }
        : { role: "user", content: turn.text };
    case "assistant":
      // Echo the content blocks back unchanged, thinking blocks included.
      return { role: "assistant", content: turn.raw as Anthropic.ContentBlockParam[] };
    case "tool":
      return {
        role: "user",
        content: turn.results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.content,
          is_error: r.isError,
        })),
      };
  }
}
