// Provider-neutral shapes for the agent loop. Each provider maps these to its own wire format.

export type ToolDef = {
  name: string;
  description: string;
  /** JSON schema of the input: an object with `additionalProperties: false` and every property required. */
  schema: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; input: unknown };

export type Turn =
  | { role: "user"; text: string }
  /** `raw` is the provider's own assistant message, echoed back unchanged on the next request. */
  | { role: "assistant"; text: string; calls: ToolCall[]; raw: unknown }
  | { role: "tool"; results: { id: string; content: string; isError: boolean }[] };

/** `cached` is the part of `input` served from the provider's prompt cache. */
export type Usage = { input: number; output: number; cached: number };

export type Completion = {
  text: string;
  calls: ToolCall[];
  usage: Usage;
  /** Provider's stop reason, for logs. */
  stop: string;
  raw: unknown;
};

export interface Provider {
  readonly model: string;
  complete(req: {
    system: string;
    turns: Turn[];
    tools: ToolDef[];
    maxTokens: number;
  }): Promise<Completion>;
}
