---
summary: What happens, step by step, when `spriggs init` writes a first set of docs for a whole repository, and how the GitHub Action turns the result into a pull request.
covers:
  - packages/spriggs/src/init.ts
  - packages/spriggs/src/agent/init-prompt.ts
  - packages/spriggs/src/agent/agents.ts
  - packages/spriggs/src/report.ts
  - scripts/open-init-pr.sh
---

# The cold start (`spriggs init`)

A pull request run only sees one diff. The cold start is for a repository with no docs yet, or with docs far behind the code. It is run once. The code is in `packages/spriggs/src/init.ts`. For how to start it, locally or from the action, see [setup.md](../setup.md#cold-start-spriggs-init).

`init` never commits. It leaves its pages in the working tree. Locally you review and commit them yourself. In CI the action commits them and opens a pull request (see [In CI](#in-ci)).

## Steps

1. **Pick the model.** Same rules as a pull request run (see the Model section of [setup.md](../setup.md#model)). A missing model or key stops here.
2. **Load the project.** Spriggs reads `docs/portolan.yml`. A broken file only prints a warning. It lists the existing docs with their summaries.
3. **Build the file outline.** The readable files are the tracked files plus untracked files that git does not ignore (`git ls-files --others --exclude-standard`). So init works before the first commit, and ignored files such as `.env` stay hidden. The outline lists root files (at most 40), then each folder two levels deep with its file count, capped at 300 lines.
4. **Run the init agent.** The first message holds the project name, the existing docs and the outline, and ends with "Begin with the survey." The system prompt (`agent/init-prompt.ts`) tells the model to survey, plan in `docs/todo.md`, write pages in order, and keep the todo up to date. Tools, budget and the wrap-up message are in [agent-harness.md](agent-harness.md).
5. **Catch an early stop.** If the budget, the context window or the model gives out, the error is caught. The pages written so far stay. The stop reason is kept on one line, and is never empty ("unknown error" when there is no message).
6. **Post-run check.** `enforce.ts` checks every written file with the same rules as a pull request run, but with no line cap and without the working-tree check. See [the docs contract](../reference/docs-contract.md#what-the-post-run-check-refuses). If it fails, Spriggs prints the reason, leaves the files for you to review, and exits with code 1.
7. **Count the todo.** Spriggs counts list items in the body of `docs/todo.md`. Bullets (`-`, `*`, `+`) and numbered items (`1.` or `1)`) count. With none left, it deletes the file and leaves it out of the report.
8. **Print the report** between the lines `--- init result ---` and `--- end ---`.

## The report

The report is markdown, headed "Spriggs: cold start report". In order:

- a **Stopped early** line with the reason, when the run stopped before `finish`;
- the files written, new ones marked "(new page)", or "I wrote no pages.";
- "N pages planned but not written", pointing to `docs/todo.md`; or "I wrote every page I planned." when the run finished with nothing left. A run that stopped early with no todo makes neither claim;
- "A note from the run:" with the model's note, if any;
- a line with the model name, tokens and turns.

The note, the stop reason and the file paths are flattened to one line each: line breaks and control characters become spaces. So no model text can start a line of its own and pass for a marker line or a CI workflow command.

## Exit codes

| Code | Means |
| --- | --- |
| 0 | The run finished and the check passed |
| 1 | The post-run check failed (this wins over an early stop), or an unexpected error |
| 3 | The run stopped before `finish`; `docs/todo.md` lists what is left |

## In CI

The action runs `spriggs init` and saves its output to a log. It then runs `scripts/open-init-pr.sh` when the exit code is 0 or 3. The script:

1. stops with no pull request if nothing under `docs/` changed;
2. creates the branch `spriggs/init-<run id>` and commits only `docs/`, with the message `docs: first set of docs from spriggs init`, authored as `github-actions[bot]` or as the App's bot when `SPRIGGS_APP_SLUG` is set;
3. pushes the branch, passing the token to git for that one command only;
4. opens a pull request against the branch the workflow ran on, with the report (minus its marker lines) as the body, or one fallback line if the log has no report.

On exit code 3 the action then fails the job with an error that points to `docs/todo.md`. See [the action reference](../reference/github-action.md).
