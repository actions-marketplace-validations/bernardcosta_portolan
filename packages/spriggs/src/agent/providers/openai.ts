import OpenAI from "openai";
import {
  type Completion,
  ContextWindowError,
  type Provider,
  type ToolDef,
  type Turn,
} from "./types";

/** Chat Completions with tools. Covers OpenAI, OpenRouter and other compatible endpoints via `baseURL`. */
export class OpenAIProvider implements Provider {
  private readonly client: OpenAI;

  constructor(
    readonly model: string,
    apiKey: string,
    baseURL?: string,
  ) {
    this.client = new OpenAI({ apiKey, timeout: 5 * 60 * 1000, ...(baseURL ? { baseURL } : {}) });
  }

  async complete(req: {
    system: string;
    turns: Turn[];
    tools: ToolDef[];
    maxTokens: number;
  }): Promise<Completion> {
    const response = await this.client.chat.completions
      .create({
        model: this.model,
        max_completion_tokens: req.maxTokens,
        messages: [{ role: "system", content: req.system }, ...req.turns.flatMap(toMessages)],
        tools: req.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.schema,
            strict: true,
          },
        })),
      })
      .catch((e: unknown) => {
        if (
          e instanceof OpenAI.BadRequestError &&
          /context_length|context length|too many tokens/i.test(e.message)
        ) {
          throw new ContextWindowError(this.model, e.message);
        }
        throw e;
      });
    const choice = response.choices[0];
    if (!choice) throw new Error("provider returned no choices");
    const message = choice.message;
    const calls = (message.tool_calls ?? []).flatMap((tc) => {
      if (tc.type !== "function") return [];
      let input: unknown;
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = {};
      }
      return [{ id: tc.id, name: tc.function.name, input }];
    });
    return {
      text: message.content ?? "",
      calls,
      usage: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
        cached: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      stop: choice.finish_reason ?? "unknown",
      raw: message,
    };
  }
}

function toMessages(turn: Turn): OpenAI.ChatCompletionMessageParam[] {
  switch (turn.role) {
    case "user":
      return [{ role: "user", content: turn.text }];
    case "assistant":
      return [turn.raw as OpenAI.ChatCompletionMessageParam];
    case "tool":
      return turn.results.map((r) => ({
        role: "tool",
        tool_call_id: r.id,
        content: r.isError ? `ERROR: ${r.content}` : r.content,
      }));
  }
}
