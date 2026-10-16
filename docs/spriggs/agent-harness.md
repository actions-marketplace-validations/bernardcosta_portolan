---
summary: How Spriggs drives a model, which tools the model gets and what they refuse, the budgets of the three agents, and how providers plug in. For people changing the harness.
audience: agent
covers:
  - packages/spriggs/src/agent/loop.ts
  - packages/spriggs/src/agent/agents.ts
  - packages/spriggs/src/agent/tools.ts
  - packages/spriggs/src/agent/model.ts
  - packages/spriggs/src/agent/prompt.ts
  - packages/spriggs/src/agent/survey-prompt.ts
  - packages/spriggs/src/agent/providers/
  - packages/spriggs/src/checks/
  - packages/spriggs/src/survey.ts
---

# The agent harness

All model work goes through one loop (`agent/loop.ts`). An **agent** (`agent/agents.ts`) is a system prompt, a subset of the tool pool, a budget and an optional wrap-up message. There are three agents.

| Agent | Used by | Tools | Turns | Tokens | Time | Wrap-up message |
| --- | --- | --- | --- | --- | --- | --- |
| `docs`, small tier | `spriggs run`, up to 1,500 lines | `list_files`, `search`, `read_file`, `read_diff`, `write_doc`, `move_doc`, `delete_doc`, `finish` | 30 | 600,000 | 10 min | no |
| `docs`, large tier | `spriggs run`, above 1,500 lines | same | 40 | 1,500,000 | 15 min | no |
| `survey` | `spriggs survey` | `list_files`, `search`, `read_file`, `write_doc`, `move_doc`, `delete_doc`, `finish` | 120 | 2,000,000 (`SPRIGGS_SURVEY_TOKENS`) | 45 min | yes |
| `verify` | `spriggs survey`, the check pass | `list_files`, `search`, `read_file`, `write_doc`, `finish` | 60 | 1,000,000 | 20 min | yes |

Tokens count input not served from the provider's cache, plus output. Cached input is left out of the budget, but it is billed and shows in the reported cost. The history can grow to the model's full context window before anything is cleared, so a model with a larger window raises the worst-case cost of a run: a pull request author can drive any run toward `turns × window` cached tokens. Choose the model with that in mind. The budget is checked only between turns, so the action's workflow keeps a 60-minute job timeout as a backstop.

The `verify` budget is per checker, and up to three checkers run at the same time, so the check pass of one survey may spend several times that. See [The check pass](#the-check-pass).

## The loop

Each turn: check the budget, send the whole history to the provider, run the tool calls in the reply, add the results, repeat until `finish` succeeds.

The console log shows each turn: the turn number and the model's text, then one line per tool call with its main argument (the path, the search pattern, the page and its line count, or `from -> to` for a move), and the reason when a call was refused. The text is cut at 400 characters. Model text, paths and refusals are put on one line each, and every log line starts with Spriggs's own text, so nothing from the model or the repository can pass for a CI workflow command.

- **Budget.** Over the time or token limit, or past the last turn without `finish`, the loop throws an `AgentError` that carries the usage so far.
- **Wrap-up.** For an agent with a wrap-up message, once 80% of turns, tokens or time is spent, the message is sent once as a user turn, and the console logs `budget: nearly spent; told the model to wrap up`.
- **Output limit.** One reply may be up to 32,000 tokens. A reply cut at the limit has its tool calls refused with advice to write a shorter file or split it, and the console logs `reply cut at the output limit; asked for a shorter one`. A second cut reply ends the run.
- **No tool call.** If the model stops without calling a tool and has not finished, it is told once to call `finish`. A second time ends the run.
- **Hard checks.** A tool call for `finish` that succeeds is held while the run's checks are run over the docs (see [Hard checks](#hard-checks)). The first `finish` with problems is refused and its result thrown away; a second `finish` is accepted as it is.
- **Seen files.** A file counts as seen when its diff was inline, or a `read_diff` or `read_file` call on it succeeded and was not cut.
- **Context clearing.** When the provider rejects a request because it does not fit the model's context window, tool results older than the last three tool turns are replaced with a short note and the request is sent again. Call IDs and order stay, so the model can call the tool again. This works for any window size, and the prompt cache breaks only when a clear happens. The console logs `context: cleared N older tool result(s)`. A request the provider billed before it stopped at the window's edge still counts toward the budget and the cost. If there is nothing left to clear, the time budget is spent, or the second request still does not fit, the run fails.
- A call to a tool the agent does not have is refused.

## The check pass

`survey.ts` runs a second pass over the result of the survey agent. It runs only when the survey agent finished, and its agents are called checkers.

- **Which pages.** The markdown pages this run wrote or moved that still exist on disk, `docs/todo.md` aside. A page the run deleted is not checked, and neither is a page the run only read.
- **Batches.** At most three pages per batch, balanced by size: the largest page goes to the lightest batch. At most three batches are checked at the same time, each in a fresh conversation, so a checker does not trust what the run wrote.
- **One batch, one runtime.** A checker may only `write_doc` the pages of its own batch, so it cannot create, move or delete a page. It reads the same files as the run. It gets no hard checks, because it may only correct pages that already exist. Its writes are validated on the way in like any other, and the post-run check reads each changed page back from disk, so it checks the corrected text too; it looks only at the pages the survey agent changed.
- **Its own budget.** Each checker has the `verify` budget above. One that runs out of budget stops on its own: the corrections it already wrote stay, the console logs `verify stopped: <reason>`, and the run goes on.
- **The log.** `verify: checking N page(s) in M batch(es)`, then `verify: done:` with the tokens.
- **The report.** The checkers' notes become one list item per line under **Checked against the code after writing**, and their tokens and turns are added to the run's totals.

## Hard checks

Some of the docs contract can be proved by code, with no model. Those checks live in `checks/`, one file each. A **hard check** has a `name` for the log, `advice` shown to the model, and a `run(state)` that returns one line per problem, or nothing when the docs pass. `runHardChecks` runs the checks in order and builds one message: `Not yet. Fix these, then call finish again.`, then the advice and the problem lines of each failed check. The console logs the check name and the number of problems, not the lines themselves. `runAgent` takes the checks as `checks`; a run with no checks refuses nothing.

- **Changed files not read** (`checks/unread.ts`): changed files whose diff was not inline and that the model has not read. It must read them with `read_diff` or `read_file`. Seen works as in the loop rule above.
- **Dead links** (`checks/links.ts`): relative links in the markdown pages under `docs/` that point to a file that does not exist or, for a markdown page, to a heading it does not have. The anchors are the ones GitHub gives a page: one per heading, lower case, punctuation removed, spaces turned into hyphens, with `-1`, `-2` and so on when a heading repeats, plus any `<a id>` or `<a name>`. Skipped: change entries, fenced code, inline code, HTML comments, and links with a scheme such as `http:` or `mailto:`. The check has two scopes. A pull request run uses `run`: only a link from a page this run wrote, or to a page this run wrote, counts, so a dead link people left elsewhere does not block the model. `spriggs survey` uses `all`: every link in `docs/` counts, apart from change entries and `docs/api/`, because the survey's job is the whole doc set. In both scopes a page the model moved or deleted counts as written, so a link to its old path is caught. A relative link that leaves the repository is reported as a missing file.

Which run uses which check: a pull request run uses both; `spriggs survey` uses the link check in the `all` scope; the [check pass](#the-check-pass) uses none.

## The tool pool

The tools are the only way the model touches anything: no shell, no network. Paths are made relative to the repository (`safeRel`); a path that escapes it, or that holds any control character (a line break, an escape code, a null byte), is refused. So a path cannot forge a line in the log or the report.

The three tools that change a page under `docs/` (`write_doc`, `move_doc` and `delete_doc`) share one set of path rules: under `docs/`, not under `docs/api/` or `docs/changes/`, `.md`/`.yml`/`.html` only, at most two folders deep, and no symlink out of `docs/`. The required pages `docs/overview.md`, `docs/setup.md` and `docs/portolan.yml` may be edited in place, never moved or deleted. Each of the three records the content of a path before its first change this run, so a failed `spriggs run` puts everything back.

- `list_files(dir)`: readable files under a folder. Readable means tracked by git, plus this run's changed files (or untracked files that git does not ignore, for the survey).
- `search(pattern, path)`: `git -c core.quotePath=false grep -n -I -P --untracked` over tracked files and untracked files that git does not ignore, so it sees the same files as `list_files` and `read_file` in the survey. The pattern is a Perl-compatible regular expression, so `\b`, `\d` and `(?i)` work. When git was built without Perl regex (PCRE) support, the search runs again with `-E` (POSIX extended), and the result starts with a note saying `\b` and `\d` do not work there. Non-ASCII paths come out as they are, so the generated-file filter sees the real name. The pattern is 1 to 200 characters. Binary and generated files are dropped. At most 200 lines, each cut at 300 characters, with a note when there are more. The tool description tells the model that a pattern finds only the words in it, so it should try several patterns and wordings and run them together.
- `read_file(path, start, lines)`: whole lines up to 64 KB per call, with a note naming the next line to ask for. A single line over 64 KB is cut and marked. Only regular files inside the repository; symlinks are refused.
- `read_diff(path)`: the diff of one changed file, cut at 64 KB. A cut diff does not count as seen. For a new file not in git yet it says to use `read_file`.
- `write_doc(path, content)`: see the rules above and in [the docs contract](../reference/docs-contract.md). Also refused: content over 80,000 characters. In a repository with no `docs/` folder yet, it creates the folder. Markdown frontmatter and `portolan.yml` are checked on every write.
- `move_doc(from, to)`: moves or renames one page under `docs/`. The content stays the same; to change it too, move first, then `write_doc`. Refused: the required pages as source or target, a source that does not exist, a target that already exists, and a page whose content would not be valid at the new path (the model is told to write it there with `write_doc`). The model then searches `docs/` for links to the old path and fixes them.
- `delete_doc(path)`: deletes one page under `docs/`, when its whole subject is gone from the code or another page already says all of it. Refused: the required pages, and a path that does not exist. The model then fixes the links to it.
- `finish(title, kind, body, docs, notes, large_refactor)`: ends the run. Needs a title and a body.

## Providers

`agent/model.ts` turns `provider/model` into a provider. The order is the `--model` flag, then `SPRIGGS_MODEL`, then `anthropic/claude-opus-5-5` when `ANTHROPIC_API_KEY` is set. It fails before any network call, naming the missing variable.

A provider implements one method, `complete({ system, turns, tools, maxTokens })`, and returns the text, tool calls, usage (input, output, cached), the stop reason and the raw assistant message. The raw message is sent back unchanged on the next request.

- `AnthropicProvider` uses the Messages API with strict tool schemas. It marks the system prompt, the first user message and the last message as cache points, so each turn reuses the earlier ones. An error whose text says the prompt is too long or names the context window becomes a `ContextWindowError`; the older wording, `input length and max_tokens exceed context limit`, is matched too. A reply that stops because the context window filled up becomes one as well, and that error carries the usage it was billed for, so the loop counts it before it clears and retries. A refusal becomes an error.
- `OpenAIProvider` uses Chat Completions with strict function tools. It also serves `openrouter/` with the base URL `https://openrouter.ai/api/v1`. Context-length errors become a `ContextWindowError`. Tool errors are sent as `ERROR: <message>`.

Both clients use a five-minute request timeout. To add a provider, implement the `Provider` interface in `agent/providers/types.ts` and add a case in `model.ts`.

## Prompts

`agent/prompt.ts` holds the docs contract text and the style rule shared by the agents that write pages, the pull request system prompt, and the builder for the pull request message. The contract text asks the model to search `docs/` for links to a heading or page it renames or moves and to fix them: the rule the link check enforces. The pull request prompt has an "Old facts" rule: when a change renames, removes or changes something a reader relies on, the model searches `docs/` in several wordings for pages that still state the old fact and fixes them, even when their `covers` do not match the diff (see [pull-request-run.md](pull-request-run.md#6-agent-run)). It also has a "Moved and removed areas" rule: when the change renames or moves an area that has its own page, the model moves the page with `move_doc` so its path matches the new name; when the change removes the whole subject of a page, it deletes the page with `delete_doc`. `agent/survey-prompt.ts` holds the survey prompt, the checker prompt, and the builders for their first messages. The survey message holds the project name, the existing docs with summaries, the body of `docs/todo.md` from the last run (first 20,000 characters) and a file outline; the checker message holds the pages of one batch. The survey prompt tells the model to move a page whose path no longer fits its subject and to delete a page whose subject is gone, and to name each move and deletion in its notes. The checker prompt tells it to correct only the claims the code does not support, to keep every other line as it is, and to name each correction as "page: what it said -> what the code does (file:line)". `survey.ts` builds the outline from the runtime's readable set (tracked files plus untracked files git does not ignore): up to 40 root files, then folders two levels deep with file counts, capped at 300 lines, or `(no files)` when there are none. The todo page path is `docs/todo.md`; after the run, `survey.ts` counts its list items (lines starting with `-`, `*`, `+`, `1.` or `1)`) and removes it when there are none and the model wrote it in this run. The todo is read with the same check as `read_file` (`readableFile`), so a symlink is ignored.

## Survey exit codes

`survey()` returns 0 for a complete run, 1 when the post-run check fails (checked after an early stop too, so it wins), and `STOPPED_EARLY` (3) when `runAgent` threw before `finish`. The `check failed:` line printed for code 1 is flattened to one line. In the action, code 3 still lets `scripts/open-survey-pr.sh` open the pull request, with the report's **Stopped early** line in its body, and a later step then fails the job. Any other non-zero code fails the step before the pull request is opened. The check pass does not change the exit code: a checker that stops is logged and the run goes on.
