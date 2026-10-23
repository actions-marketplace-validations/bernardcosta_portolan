---
summary: What happens, step by step, when Spriggs runs on one pull request, and how each outcome turns into a label, a commit status and a comment.
covers:
  - packages/spriggs/src/run.ts
  - packages/spriggs/src/gate/signals.ts
  - packages/spriggs/src/gate/decide.ts
  - packages/spriggs/src/report.ts
  - packages/spriggs/src/agent/prompt.ts
  - packages/spriggs/src/agent/survey-prompt.ts
  - packages/spriggs/src/verify.ts
  - packages/spriggs/src/docs/tree.ts
---

# A pull request run

`portolan spriggs run` (and the GitHub Action, which calls it) goes through the same steps every time. The code is in `packages/spriggs/src/run.ts`.

1. Read the context
2. Skip rules
3. Signals (gate stage one)
4. Verdict (gate stage two)
5. Docs debt
6. Agent run
7. Check pass
8. Post-run check
9. Change entry
10. Commit and push
11. Report

## 1. Read the context

The forge builds the pull request context: title, description, labels, commits oldest first, changed files with line counts, and the `git diff` arguments that reproduce the change. See [forges.md](forges.md). Spriggs then builds the per-file diffs from those arguments. Spriggs also loads `docs/portolan.yml`; a broken file only prints a warning.

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
- files and lines changed. Lockfiles and similar generated files (`*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `go.sum`, `Cargo.lock` and others) add no lines and their diffs are left out of the message to the model. They still count as changed files, and the changed-file list marks them as generated and ignored;
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

On abstain, Spriggs writes nothing and sets `docs:needs-input`, unless the docs are already current, which it checks first (see [Docs already current](#docs-already-current)). The tier picks the agent's budget (see [agent-harness.md](agent-harness.md)).

Spriggs also notes drift. The sticky comment stores a hash of the description and the head commit. If the description is the same as last time but new commits arrived, the comment shows a **Heads up** with the number of new commits, and the model is told to prefer the commit messages for them. Spriggs's own docs commit is not counted. This never blocks.

### Docs already current

A pull request can bring its own docs: a person or a coding agent updated `docs/` and added a change entry before the push. In CI, after the verdict, Spriggs looks for the newest commit in the pull request that adds a file under `docs/changes/`. When no commit after it touches a file outside `docs/`, the docs are current. A merge commit counts as code, so a merge of the base branch after the docs gives a full run. The entry name must be a plain `docs/changes/<name>.md` (letters, digits, `.`, `_` and `-`); any other name gives a full run. The entry must still be at that path at the head, as a plain file, and must have no `pr`. So an entry that Spriggs wrote (it always sets `pr`), or one that was renamed or deleted later, gives a full run.

When the docs are current, Spriggs runs no model and commits nothing, and it skips the steps below up to the report. It runs the checks that need no model: the entry fields, the frontmatter of the doc pages the pull request changed, and the [dead links](agent-harness.md#hard-checks) from or to those pages. The comment names the entry and lists any problem in a code block. A code commit pushed after the docs makes the next run a full run, and that run rewrites the same entry (see [Change entries](../reference/docs-contract.md#change-entries)).

## 5. Docs debt

A run reads only its own diff. So a pull request whose run failed or only read part of the change could be merged with its docs still unchecked. Those runs left the label `docs:needs-input` or `docs:partial` behind, and that is the debt.

Before the agent runs, Spriggs asks the forge for the merged pull requests on the base branch that still carry one of those labels (`docsDebt` in [forge/types.ts](forges.md)). It looks at the 100 most recently updated closed pull requests and keeps the newest 10 of them (`MAX_DEBT` in `run.ts`). More than 10 is a job for the survey. A lookup error only prints a warning; the run goes on without debt.

The agent message gets a section listing each debt pull request by number, title and changed file paths. Paths, not the old diff: the docs must match the code as it is now, so the model reads the files it needs. Generated files are left out, and the title is marked as untrusted data.

A run that ends `docs:done` or `docs:none` marks those pull requests `docs:done`, so a later run does not see them again. A partial or failed run clears nothing and leaves the debt for the next run, and neither does a run that found the docs already current: that run never looks at the debt. If the lookup found more than 10, the comment says so and points to the survey.

Two things follow from this. The debt is cleared when this pull request's run succeeds, not when this pull request is merged, so a pull request that is then closed unmerged loses the catch-up edits and the debt label with it. And on an older pull request, `docs:done` means "a later run checked it", not "its own run did". A pull request that was merged with `docs:done` and still missed a fact is not seen as debt.

## 6. Agent run

Spriggs picks the model (see [configuration.md](../reference/configuration.md#how-the-model-is-picked)). A missing model or key fails the run here. Once 80% of the agent's turns, tokens or time is spent, the loop sends it one wrap-up message: read only the changed files it still needs, write the edits it has evidence for, then call `finish`. The model gets one message with:

- the title, description and commits (subject and body), marked as untrusted author data;
- the gate's facts;
- the changed files with line counts;
- the docs debt, when there is any (see [step 5](#5-docs-debt));
- every tracked file under `docs/` except change entries. Markdown pages show their `summary` (and `audience: agent` when set). Other files, such as `portolan.yml`, show the path only. Specs under `docs/api/` are marked as read-only;
- the docs whose `covers` match the diff (see [the docs contract](../reference/docs-contract.md#how-covers-is-used));
- as many whole-file diffs as fit in about 320 KB (about 5,000 changed lines). A file's diff is never cut in the middle. Files that do not fit are listed as "not shown", and the model must read them before it finishes; the first `finish` that leaves them unread is refused, a second one is accepted.

Two checks run when the model calls `finish`. The first finish with unread changed files, or with a relative link from or to a page this run wrote that points to a file or heading that is not there, is refused with the list of problems; a second `finish` is accepted as it is. See [Hard checks](agent-harness.md#hard-checks).

The model is told to edit existing pages in place. It creates a new page only when the change adds a new area with its own behaviour (a service, an API, a command group, a data format), no page's `covers` touches it, and the facts do not fit in one section of an existing page. A new page always gets a `summary` and `covers`. When the change renames or moves an area that has its own page, it moves that page with `move_doc`, so the path matches the new name; when the change removes the whole subject of a page, it deletes the page with `delete_doc`. Otherwise it keeps pages where they are. When it edits a page that has no `covers`, it adds them.

`covers` alone does not find every page a change makes stale. When the change renames, removes or changes something a reader relies on (an environment variable, flag, command, endpoint, header, field, file, default value, limit or behaviour), the model is told to search `docs/` with the `search` tool for every page that still states the old fact, and fix it, even when the page's `covers` do not match the diff. It searches in several wordings: the old name, the old value as a number and as a word, synonyms and other phrasings, and what readers were told follows from the old behaviour. Search matches words, not meaning, so a fact stated only as a paraphrase can still be missed. The same rule covers links: when it renames or renumbers a heading, or moves, renames or deletes a page, it searches `docs/` for links to the old anchor or path and fixes them.

After the run, Spriggs counts which changed files the model saw (inline, or read with `read_diff` or `read_file`; a `read_diff` result cut at 64 KB does not count) and logs `coverage: read N/M`.

If the conversation no longer fits the model's context window, the provider rejects the request; nothing is cut. Spriggs clears older tool results and sends it again (see [agent-harness.md](agent-harness.md#the-loop)). If it still does not fit, the run fails with a message that says the change does not fit. To fix it, use a model with a larger window, or split the pull request. A run that runs out of turns, tokens or time before `finish` also fails.

## 7. Check pass

When the docs agent has finished, a second set of agents reads pages back against the code. Each checker gets a fresh conversation, so it does not trust what the run wrote, its own budget, and a batch of pages; a batch holds up to 40,000 characters and six pages. Up to three checkers run at the same time, and the check budget `SPRIGGS_CHECK_TOKENS` sets how many a run may start (three by default). See [The check pass](agent-harness.md#the-check-pass). The pages are:

- the markdown pages this run wrote or moved, first;
- then every page whose `covers` match a changed file, whether or not the run touched it, the closest match first. These are the pages that may still state a fact this change makes stale. The pages that do not fit the check budget are left out and named in the comment.

A page the run deleted is not checked, and a page the run only read is checked only when its `covers` match a changed file. The checker message lists the changed files too, generated files aside, and marks each page "written by this run" or "covers changed code": on the first kind the checker tests every claim, on the second only the claims the changed files can affect. A checker may only `edit_doc` the pages of its own batch, so it cannot create, move or delete a page, and it has no `finish` checks of its own. A checker that runs out of budget stops on its own: the corrections it already wrote stay, the console logs `verify stopped: <reason>`, its pages do not count as checked, a note names them in the comment, and the run goes on. The console logs `verify: checking N page(s) in M batch(es)` and then `verify: done:` with the tokens. With `SPRIGGS_EFFORT=low` this step is skipped and no page is checked again (see [configuration.md](../reference/configuration.md)).

The corrections count as the run's own. A checker shares the run's record of file changes, so the [post-run check](#8-post-run-check) validates the corrected pages too and undoes them with everything else when it fails. A page a checker corrected joins the `docs:` commit even when the docs agent wrote nothing, and the checker's tokens and turns are added to the run's totals.

## 8. Post-run check

`enforce.ts` checks every file the model changed, including the pages it deleted and any page the check pass corrected. In CI it also checks that nothing else in the working tree changed. The rules are in [the docs contract](../reference/docs-contract.md#what-the-post-run-check-refuses). On any failure, every write, move and deletion is undone.

## 9. Change entry

The run is partial when the verdict was partial (`reason-missing`) or when some changed files went unread (`diff-too-large`). The entry is written unless the change is `internal` and not a large refactor. In `--local` mode it is printed to the console instead of written, since there is no pull request number. See [the docs contract](../reference/docs-contract.md#change-entries) for the format.

## 10. Commit and push

When there are doc edits or an entry, Spriggs commits everything under `docs/` with the message `docs: <title>` (one line; the title is cut at 72 characters) and pushes it to the pull request branch. If the push loses a race with a newer push, the run logs `superseded` and exits with code 0 without reporting; the newer push starts its own run. After a push, the comment's hidden marker and the commit status name the new docs commit.

## 11. Report

Each run that is not skipped or superseded posts the sticky comment, sets one label and sets the `spriggs` status:

| Outcome | Label | Status |
| --- | --- | --- |
| Docs or entry written, everything read, reason stated | `docs:done` | success |
| Nothing to write, everything read, reason stated | `docs:none` | success |
| Reason missing, or changed files left unread | `docs:partial` | success |
| Gate abstained | `docs:needs-input` | success, or failure when the change is breaking or `SPRIGGS_BLOCKING=true` |
| Docs already current, checks pass | `docs:done` | success |
| Docs already current, a check found a problem | `docs:needs-input` | failure |
| Failed (configuration, agent error, budget, context window, check, entry or push) | `docs:needs-input` | failure |

On a run that succeeds and on a gate stop, the status text is one line of at most 140 characters, starting with `done:`, `partial:` or `stopped:`. A failure uses the reason and the raw error, cut at 140 characters. Two failures are different: a run that found the docs already current and a problem sets `stopped: the docs in this pull request have problems`, and a configuration error (no model, or no key for it) sets `Spriggs is not configured`, with the reason in the comment. The comment opens with a heading and a line of introduction; then comes the label in bold and what it means. A failed run that has a raw error puts it just after the reason, in a fenced code block, so it reads as a block and markdown inside it does nothing; the fence is longer than any run of backticks in the text. A post-run check failure and a context-window failure carry no raw error, so their reason is the whole line. Then come any **Heads up** note and, when the repository had no markdown pages under `docs/` (change entries aside) at the start of the run, a **No docs yet** note. That note says a pull request run only covers one change, points to the survey (start the Spriggs workflow by hand from the Actions tab), and says the workflow needs `workflow_dispatch:` under `on:` for that. Then come the files in the `docs:` commit (new ones marked "(new page)", deleted ones marked "(deleted)"). When the check pass read any page, the next line says the docs were checked against the code after the run, with the checkers' notes under it as one list item per line: the corrections in plain words, and the pages a stopped checker could not check. With no notes, the line says nothing was found to fix. When no checker finished, the line says the docs could not be checked. Then come a line naming the debt pull requests this run caught up on, a **More docs debt** note when there were more than 10, any note from the model, any unread files under **Not read:**, a line with the model name, tokens and turns (the check pass's included), and a folded **What I saw** table of the signals, including the size and the line limit. A failed run leaves the check pass line out.

In the model's note, `@` mentions, issue references (`#12`, `owner/repo#12`, `GH-12`) and links are put in code, and a lone backtick becomes `'`. GitHub does not notify, link or close anything inside code, so the note cannot ping people or close an issue. The commit message is not treated this way: a title with "fixes #12" in `docs: <title>` can still close that issue on merge.
