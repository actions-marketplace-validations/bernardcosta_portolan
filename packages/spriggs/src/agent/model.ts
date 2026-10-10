import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider } from "./providers/openai";
import type { Provider } from "./providers/types";

const DEFAULT_ANTHROPIC_MODEL = "anthropic/claude-opus-5-5";

/**
 * `provider/model` -> a Provider. Precedence: the --model flag, then SPRIGGS_MODEL, then a default
 * chosen from which key is present. Fails before any network call, naming the missing variable.
 */
export function resolveProvider(flagModel?: string, env = process.env): Provider {
  return resolveSpec(
    flagModel || env.SPRIGGS_MODEL || (env.ANTHROPIC_API_KEY ? DEFAULT_ANTHROPIC_MODEL : ""),
    env,
  );
}

/** The model for the triage phase: `SPRIGGS_TRIAGE_MODEL`, else the main model. */
export function resolveTriageProvider(main: Provider, env = process.env): Provider {
  return env.SPRIGGS_TRIAGE_MODEL ? resolveSpec(env.SPRIGGS_TRIAGE_MODEL, env) : main;
}

function resolveSpec(spec: string, env: NodeJS.ProcessEnv): Provider {
  if (!spec) {
    throw new Error(
      "no model configured: set SPRIGGS_MODEL (provider/model) and the provider's API key, e.g. ANTHROPIC_API_KEY",
    );
  }
  const slash = spec.indexOf("/");
  if (slash < 1) throw new Error(`SPRIGGS_MODEL must be provider/model, got "${spec}"`);
  const provider = spec.slice(0, slash);
  const model = spec.slice(slash + 1);

  const key = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set (needed for model ${spec})`);
    return value;
  };
  switch (provider) {
    case "anthropic":
      return new AnthropicProvider(model, key("ANTHROPIC_API_KEY"));
    case "openai":
      return new OpenAIProvider(model, key("OPENAI_API_KEY"));
    case "openrouter":
      return new OpenAIProvider(model, key("OPENROUTER_API_KEY"), "https://openrouter.ai/api/v1");
    default:
      throw new Error(
        `unknown provider "${provider}" in model ${spec}; use anthropic, openai or openrouter`,
      );
  }
}
