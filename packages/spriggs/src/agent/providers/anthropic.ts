import Anthropic from "@anthropic-ai/sdk";
import {
  type Completion,
  ContextWindowError,
  type Provider,
  type ToolDef,
  type Turn,
} from "./types";

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
    const response = await this.client.messages
      .create({
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
        messages: req.turns.map((t, i) => toMessage(t, i, i === req.turns.length - 1)),
      })
      .catch((e: unknown) => {
        if (
          e instanceof Anthropic.BadRequestError &&
          /prompt is too long|context window|exceed context limit/i.test(e.message)
        ) {
          throw new ContextWindowError(this.model, e.message);
        }
        throw e;
      });
    const usage = {
      input:
        response.usage.input_tokens +
        (response.usage.cache_read_input_tokens ?? 0) +
        (response.usage.cache_creation_input_tokens ?? 0),
      output: response.usage.output_tokens,
      cached: response.usage.cache_read_input_tokens ?? 0,
    };
    if (response.stop_reason === "model_context_window_exceeded") {
      throw new ContextWindowError(this.model, "the reply did not fit", usage);
    }
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
      usage,
      stop: response.stop_reason ?? "unknown",
      raw: response.content,
    };
  }
}

const CACHE = { cache_control: { type: "ephemeral" as const } };

/**
 * Cache breakpoints: the first user message (the stable prefix) and the last message of each request,
 * so the next turn reuses everything sent so far. With the system prompt that is three of the four allowed.
 */
function toMessage(turn: Turn, index: number, last: boolean): Anthropic.MessageParam {
  const mark = index === 0 || last ? CACHE : {};
  switch (turn.role) {
    case "user":
      return { role: "user", content: [{ type: "text", text: turn.text, ...mark }] };
    case "assistant": {
      // Echo the content blocks back unchanged, thinking blocks included. The API rejects an empty
      // non-final assistant message, so an empty reply becomes a placeholder.
      const raw = turn.raw as Anthropic.ContentBlockParam[];
      return {
        role: "assistant",
        content: raw.length ? raw : [{ type: "text", text: "(no reply)" }],
      };
    }
    case "tool":
      return {
        role: "user",
        content: turn.results.map((r, i) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.content,
          is_error: r.isError,
          ...(last && i === turn.results.length - 1 ? CACHE : {}),
        })),
      };
  }
}
