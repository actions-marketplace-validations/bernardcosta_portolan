---
summary: How Spriggs drives a model, which tools the model gets and what they refuse, the budgets of the two agents, and how providers plug in. For people changing the harness.
audience: agent
covers:
  - packages/spriggs/src/agent/loop.ts
  - packages/spriggs/src/agent/agents.ts
  - packages/spriggs/src/agent/tools.ts
  - packages/spriggs/src/agent/model.ts
  - packages/spriggs/src/agent/prompt.ts
  - packages/spriggs/src/agent/init-prompt.ts
  - packages/spriggs/src/agent/providers/
  - packages/spriggs/src/init.ts
---

# The agent harness

All model work goes through one loop (`agent/loop.ts`). An **agent** (`agent/agents.ts`) is a system prompt, a subset of the tool pool, a budget and an optional wrap-up message. There are two agents.

| Agent | Used by | Tools | Turns | Tokens | Time | Wrap-up message |
| --- | --- | --- | --- | --- | --- | --- |
| `docs`, small tier | `spriggs run`, up to 1,500 lines | `list_files`, `read_file`, `read_diff`, `write_doc`, `finish` | 30 | 600,000 | 10 min | no |
| `docs`, large tier | `spriggs run`, above 1,500 lines | same | 40 | 1,500,000 | 15 min | no |
| `init` | `spriggs init` | `list_files`, `search`, `read_file`, `write_doc`, `finish` | 120 | 2,000,000 (`SPRIGGS_INIT_TOKENS`) | 45 min | yes |

Tokens count input not served from the provider's cache, plus output.

## The loop

Each turn: check the budget, send the whole history to the provider, run the tool calls in the reply, add the results, repeat until `finish` succeeds.

- **Budget.** Over the time or token limit, or past the last turn without `finish`, the loop throws an `AgentError` that carries the usage so far.
- **Wrap-up.** For an agent with a wrap-up message, once 80% of turns, tokens or time is spent, the message is sent once as a user turn.
- **Output limit.** One reply may be up to 32,000 tokens. A reply cut at the limit has its tool calls refused with advice to write a shorter file or split it. A second cut reply ends the run.
- **No tool call.** If the model stops without calling a tool and has not finished, it is told once to call `finish`. A second time ends the run.
- **Must-read files.** Changed files whose diff was not inline must be seen before `finish`. The first `finish` with unread files is refused and lists them; the second is accepted.
- **Seen files.** A file counts as seen when its diff was inline, or a `read_diff` or `read_file` call on it succeeded and was not cut.
- **Context clearing.** When one request goes over `SPRIGGS_CONTEXT_TOKENS` input tokens (default 600,000), tool results older than the last three tool turns are replaced with a short note. Call IDs and order stay, so the model can call the tool again.
- A call to a tool the agent does not have is refused.

## The tool pool

The tools are the only way the model touches anything: no shell, no network. Paths are made relative to the repository; a path that escapes it is refused.

- `list_files(dir)`: readable files under a folder. Readable means tracked by git, plus this run's changed files (or untracked files for `init`).
- `search(pattern, path)`: `git -c core.quotePath=false grep -n -I -E --untracked` over tracked files and untracked files that git does not ignore, so it sees the same files as `list_files` and `read_file` in `init`. Non-ASCII paths come out as they are, so the generated-file filter sees the real name. The pattern is 1 to 200 characters. Generated files are dropped. At most 200 lines, each cut at 300 characters, with a note when there are more.
- `read_file(path, start, lines)`: whole lines up to 64 KB per call, with a note naming the next line to ask for. A single line over 64 KB is cut and marked. Only regular files inside the repository; symlinks are refused.
- `read_diff(path)`: the diff of one changed file, cut at 64 KB. A cut diff does not count as seen. For a new file not in git yet it says to use `read_file`.
- `write_doc(path, content)`: see the rules in [the docs contract](../reference/docs-contract.md). Also refused: content over 80,000 characters, and a path that resolves outside `docs/` through a symlink. Markdown frontmatter and `portolan.yml` are checked on every write. The first write of a file records its old content, so the run can undo it.
- `finish(title, kind, body, docs, notes, large_refactor)`: ends the run. Needs a title and a body.

## Providers

`agent/model.ts` turns `provider/model` into a provider. The order is the `--model` flag, then `SPRIGGS_MODEL`, then `anthropic/claude-opus-5-5` when `ANTHROPIC_API_KEY` is set. It fails before any network call, naming the missing variable.

A provider implements one method, `complete({ system, turns, tools, maxTokens })`, and returns the text, tool calls, usage (input, output, cached), the stop reason and the raw assistant message. The raw message is sent back unchanged on the next request.

- `AnthropicProvider` uses the Messages API with strict tool schemas. It marks the system prompt, the first user message and the last message as cache points, so each turn reuses the earlier ones. A "prompt is too long" error, or a reply stopped because the context window filled up, becomes a `ContextWindowError`. A refusal becomes an error.
- `OpenAIProvider` uses Chat Completions with strict function tools. It also serves `openrouter/` with the base URL `https://openrouter.ai/api/v1`. Context-length errors become a `ContextWindowError`. Tool errors are sent as `ERROR: <message>`.

Both clients use a five-minute request timeout. To add a provider, implement the `Provider` interface in `agent/providers/types.ts` and add a case in `model.ts`.

## Prompts

`agent/prompt.ts` holds the docs contract text and the style rule shared by both agents, the pull request system prompt, and the builder for the pull request message. `agent/init-prompt.ts` holds the cold-start prompt and builds its first message from the project name, the existing docs with summaries, the body of `docs/todo.md` from the last run (first 20,000 characters), and a file outline. `init.ts` builds that outline from the runtime's readable set (tracked files plus untracked files git does not ignore): up to 40 root files, then folders two levels deep with file counts, capped at 300 lines, or `(no files)` when there are none. The todo page path is `docs/todo.md`; after the run, `init.ts` counts its list items (lines starting with `-`, `*`, `+`, `1.` or `1)`) and removes it when there are none and the model wrote it in this run. The todo is read with the same check as `read_file` (`readableFile`), so a symlink is ignored.

## Init exit codes

`init()` returns 0 for a complete run, 1 when the post-run check fails (checked after an early stop too, so it wins), and `STOPPED_EARLY` (3) when `runAgent` threw before `finish`. In the action, code 3 still lets `scripts/open-init-pr.sh` open the pull request, with the `stopped early:` log line in its body, and a later step then fails the job. Any other non-zero code fails the step before the pull request is opened.
