---
summary: What happens, step by step, when Spriggs runs on one pull request, and how each outcome turns into a label, a commit status and a comment.
covers:
  - packages/spriggs/src/run.ts
  - packages/spriggs/src/gate/signals.ts
  - packages/spriggs/src/gate/decide.ts
  - packages/spriggs/src/report.ts
  - packages/spriggs/src/agent/prompt.ts
---

# A pull request run

`portolan spriggs run` (and the GitHub Action, which calls it) goes through the same steps every time. The code is in `packages/spriggs/src/run.ts`.

1. Read the context
2. Skip rules
3. Signals (gate stage one)
4. Verdict (gate stage two)
5. Agent run
6. Post-run check
7. Change entry
8. Commit and push
9. Report

## 1. Read the context

The forge builds the pull request context: title, description, labels, commits oldest first, changed files with line counts, and the diff. See [forges.md](forges.md). Spriggs also loads `docs/portolan.yml`; a broken file only prints a warning.

## 2. Skip rules

A skipped run exits with code 0. It posts nothing, sets no status and leaves the label as it was. Spriggs skips when:

- the pull request comes from a fork or from `dependabot[bot]`;
- the head branch is the repository's default branch (CI only);
- no files changed;
- only files under `docs/` changed;
- the event is an edit of the description, and either the body did not change or the pull request is not labelled `docs:needs-input` or `docs:partial`;
- the head commit was made by Spriggs itself (CI only; a description edit is the exception, so a rerun after the author adds a reason still works).

## 3. Signals

Stage one of the gate reads plain facts, with no model:

- whether there is a description, whether it has a **Why** section (the text under a heading named "Why", HTML comments removed), and its word count;
- the Conventional Commits type, from the title or else the first commit subject that has one, and the kind it maps to;
- whether the change is breaking: the title or a commit subject has `!` after its type (for example `feat!:`), or the description or a commit body has a line that starts with `BREAKING CHANGE:` (or `BREAKING-CHANGE:`). The words quoted inside a sentence do not count;
- linked issue IDs (`#123` by default, or `issues.pattern` from `portolan.yml`);
- files and lines changed. Lockfiles and similar generated files (`*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `go.sum`, `Cargo.lock` and others) are not counted and not shown to the model;
- whether the change touches an API (`api/` folders, `.proto`, `.graphql`, OpenAPI files), a schema or migration, or configuration files (YAML, TOML, JSON, `.env.example` outside `docs/`). These are shown in the comment only; they do not change the verdict.

## 4. Verdict

Stage two is a set of rules (`decide.ts`). A reason counts as stated when there is a Why section or the description has at least 20 words.

| Change size (counted lines) | Reason stated | Verdict |
| --- | --- | --- |
| Over the limit (5,000, or `SPRIGGS_MAX_LINES`) | either | abstain: too large |
| Up to 1,500 | yes | proceed, small tier |
| Up to 1,500 | no | partial: reason missing, small tier |
| 1,501 up to the limit | yes | proceed, large tier |
| 1,501 up to the limit | no | abstain: reason missing |

On abstain, Spriggs writes nothing and sets `docs:needs-input`. The tier picks the agent's budget (see [agent-harness.md](agent-harness.md)).

Spriggs also notes drift. The sticky comment stores a hash of the description and the head commit. If the description is the same as last time but new commits arrived, the comment shows a **Heads up** with the number of new commits, and the model is told to prefer the commit messages for them. Spriggs's own docs commit is not counted. This never blocks.

## 5. Agent run

Spriggs picks the model (see [configuration.md](../reference/configuration.md#how-the-model-is-picked)). A missing model or key fails the run here. The model gets one message with:

- the title, description and commits (subject and body), marked as untrusted author data;
- the gate's facts;
- the changed files with line counts;
- every tracked file under `docs/` except change entries. Markdown pages show their `summary` (and `audience: agent` when set). Other files, such as `portolan.yml`, show the path only. Specs under `docs/api/` are marked as read-only;
- the docs whose `covers` match the diff (see [the docs contract](../reference/docs-contract.md#how-covers-is-used));
- as many whole-file diffs as fit in about 320 KB (about 5,000 changed lines). A file's diff is never cut in the middle. Files that do not fit are listed as "not shown", and the model must read them before it finishes; the first `finish` without them is refused, a second one is accepted.

The model is told to edit existing pages in place. It creates a new page only when the change adds a new area with its own behaviour (a service, an API, a command group, a data format), no page's `covers` touches it, and the facts do not fit in one section of an existing page. A new page always gets a `summary` and `covers`. The model does not split, move or delete pages. When it edits a page that has no `covers`, it adds them.

`covers` alone does not find every page a change makes stale. When the change renames, removes or changes something a reader relies on (an environment variable, flag, command, endpoint, header, field, file, default value, limit or behaviour), the model is told to search `docs/` with the `search` tool for every page that still states the old fact, and fix it, even when the page's `covers` do not match the diff. It searches in several wordings: the old name, the old value as a number and as a word, synonyms and other phrasings, and what readers were told follows from the old behaviour. Search matches words, not meaning, so a fact stated only as a paraphrase can still be missed.

After the run, Spriggs counts which changed files the model saw (inline, or read with `read_diff` or `read_file`; a `read_diff` result cut at 64 KB does not count) and logs `coverage: read N/M`.

If the conversation no longer fits the model's context window, the provider rejects the request; nothing is cut. The run fails with a message that says the change does not fit. To fix it, use a model with a larger window, lower `SPRIGGS_CONTEXT_TOKENS` so older tool results are cleared sooner (see [agent-harness.md](agent-harness.md#the-loop)), or split the pull request. A run that runs out of turns, tokens or time before `finish` also fails.

## 6. Post-run check

`enforce.ts` checks every file the model wrote. In CI it also checks that nothing else in the working tree changed. The rules are in [the docs contract](../reference/docs-contract.md#what-the-post-run-check-refuses). On any failure, every write is undone.

## 7. Change entry

The run is partial when the verdict was partial (`reason-missing`) or when some changed files went unread (`diff-too-large`). The entry is written unless the change is `internal` and not a large refactor. In `--local` mode it is printed to the console instead of written, since there is no pull request number. See [the docs contract](../reference/docs-contract.md#change-entries) for the format.

## 8. Commit and push

When there are doc edits or an entry, Spriggs commits everything under `docs/` with the message `docs: <title>` (one line, at most 72 characters) and pushes it to the pull request branch. If the push loses a race with a newer push, the run logs `superseded` and exits with code 0 without reporting; the newer push starts its own run. After a push, the comment's hidden marker and the commit status name the new docs commit.

## 9. Report

Each run that is not skipped or superseded posts the sticky comment, sets one label and sets the `spriggs` status:

| Outcome | Label | Status |
| --- | --- | --- |
| Docs or entry written, everything read, reason stated | `docs:done` | success |
| Nothing to write, everything read | `docs:none` | success |
| Reason missing, or changed files left unread | `docs:partial` | success |
| Gate abstained | `docs:needs-input` | success, or failure when the change is breaking or `SPRIGGS_BLOCKING=true` |
| Failed (configuration, agent error, budget, context window, check, entry or push) | `docs:needs-input` | failure |

The status text is one line of at most 140 characters, starting with `done:`, `partial:` or `stopped:`. A failure uses the first 140 characters of the reason instead. The one exception is a configuration error (no model, or no key for it): its status text is `Spriggs is not configured`, and the reason is in the comment. The comment's first line is the label in bold and what it means. Then come any **Heads up** note and, when the repository had no markdown pages under `docs/` (change entries aside) at the start of the run, a **No docs yet** note. That note says a pull request run only covers one change, points to the cold start (start the Spriggs workflow by hand from the Actions tab), and says the workflow needs `workflow_dispatch:` under `on:` for that. Then come the files in the `docs:` commit (new ones marked "(new page)"), any note from the model, any unread files under **Not read:**, a line with the model name, tokens and turns, and a folded **What I saw** table of the signals, including the size and the line limit.
