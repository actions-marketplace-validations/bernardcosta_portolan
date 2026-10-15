---
summary: What happens, step by step, when `spriggs init` checks the docs of a whole repository against the code and fills the gaps, and how the GitHub Action turns the result into a pull request.
covers:
  - packages/spriggs/src/init.ts
  - packages/spriggs/src/agent/init-prompt.ts
  - packages/spriggs/src/agent/agents.ts
  - packages/spriggs/src/report.ts
  - scripts/open-init-pr.sh
  - action.yml
---

# The cold start (`spriggs init`)

A pull request run only sees one diff. The cold start is for a repository with no docs yet, or with docs far behind the code. Run it again whenever the docs fall behind; each run starts with what the last one left in `docs/todo.md`. The code is in `packages/spriggs/src/init.ts`.

To start it locally, run `bun run spriggs init` from the repository root (see [setup.md](../setup.md)). To start it from the GitHub Action, see [In CI](#in-ci).

`init` never commits. It leaves its pages in the working tree. Locally you review and commit them yourself, then open a pull request. In CI the action commits them and opens a pull request.

## Steps

1. **Pick the model.** Same rules as a pull request run (see [configuration.md](../reference/configuration.md#how-the-model-is-picked)). A missing model or key stops here.
2. **Load the project.** Spriggs reads `docs/portolan.yml`. A broken file only prints a warning. It lists the existing docs with their summaries, and reads the body of `docs/todo.md` from the last run. The todo gets the same check as `read_file`: a symlink is ignored.
3. **Build the file outline.** The readable files are the tracked files plus untracked files that git does not ignore (`git ls-files --others --exclude-standard`). So init works before the first commit, and ignored files such as `.env` stay hidden. The outline lists root files (at most 40), then each folder two levels deep with its file count, capped at 300 lines.
4. **Run the init agent.** The first message holds the project name, the existing docs, the todo from the last run (first 20,000 characters, its headings one level down) and the outline, and ends with "Begin with the survey." The system prompt (`agent/init-prompt.ts`) tells the model to:
   - **Survey**: start with the open todo items, then read manifests, the README, CI files and entry points;
   - **Plan**: before any page, write `docs/todo.md` with a **To write** list (path, what it covers, the code it rests on) and a **To check** list (existing pages to check against the code), keeping the open items of the last run, most important first;
   - **Work**: write `portolan.yml` if missing, `overview.md`, `setup.md` and one page per big part of the repository, grouped in folders, and check the existing pages. After each page, rewrite the todo so it lists only what is left; a page checked only in part stays under **To check**;
   - **Finish** when both lists are empty, or when told the budget is nearly spent.

   Existing docs keep every fact the code supports, and the model changes what the code contradicts. It may also clean up: replace repeated text with a link and move a section to the page where it belongs. Docs describe how things work now, so it removes history and migration notes (the change entries keep the history) and text about files, commands, options or behaviour that the code no longer has. It names each change in its note. The todo is treated as data, like any other repository file. Tools and budget are in [agent-harness.md](agent-harness.md). When 80% of the budget is spent, the model is told once to stop exploring, make the todo accurate and finish; the console logs `budget: nearly spent; told the model to wrap up`.

   When the model calls `finish`, one check runs first. A relative link in a page under `docs/` that points to a file or heading that is not there refuses that finish once, with the list of dead links; only links from or to a page this run wrote count. A second `finish` is accepted. See [Hard checks](agent-harness.md#hard-checks).
5. **Catch an early stop.** If the budget, the context window or the model gives out, the error is caught. The pages written so far stay. The console logs `stopped early:` with the reason and the tokens used. The stop reason is kept on one line, and is never empty ("unknown error" when there is no message).
6. **Post-run check.** `enforce.ts` checks every written file with the same rules as a pull request run, but with no line cap and without the working-tree check. See [the docs contract](../reference/docs-contract.md#what-the-post-run-check-refuses). If it fails, Spriggs prints the reason, leaves the files for you to review, and exits with code 1.
7. **Count the todo.** Spriggs counts list items in the body of `docs/todo.md`. Bullets (`-`, `*`, `+`) and numbered items (`1.` or `1)`) count. If none are left and the model wrote the todo in this run, Spriggs deletes the file. It never deletes a todo the model did not write.
8. **Print the report** between the lines `--- init result ---` and `--- end ---`.

## The report

The report is markdown, headed "Spriggs: cold start report". It is written like the sticky comment of a pull request run. In order:

- a **Stopped early** line with the reason, when the run stopped before `finish`;
- the files written, new ones marked "(new page)", or "I wrote no pages.";
- "N items left to write or check", pointing to `docs/todo.md`; or "I wrote and checked every page I planned." when the run finished with nothing left. A run that stopped early with no todo makes neither claim;
- "I removed `docs/todo.md`: nothing is left." when the run cleared a todo from an earlier run;
- "A note from the run:" with the model's note, if any;
- a line with the model name, tokens and turns.

The note, the stop reason and the file paths are flattened to one line each: line breaks and control characters become spaces. So no model text can start a line of its own and pass for a marker line or a CI workflow command. In the note, `@` mentions, issue references and links are put in code. The same holds for the note in the sticky comment of a pull request run. GitHub does not notify, link or close anything inside code, so a note cannot ping people or close an issue when the pull request is merged.

## Exit codes

| Code | Means |
| --- | --- |
| 0 | The run finished and the check passed |
| 1 | The post-run check failed (this wins over an early stop), or an unexpected error |
| 3 | The run stopped before `finish`; the pages written so far stay and `docs/todo.md` lists what is left |

## In CI

The same Spriggs workflow runs both commands. The action's `command` input is empty by default, and then the event decides: a pull request runs `run`, and a start by hand (`workflow_dispatch`) runs `init`. Set `command: run` or `command: init` to force one. So to allow the cold start, add `workflow_dispatch:` under `on:` in your Spriggs workflow, then open **Actions → spriggs → Run workflow**. GitHub shows the button only once the workflow file is on the default branch. A separate init workflow with `command: init` still works, but is not needed once `workflow_dispatch:` is in the main workflow.

The action runs `spriggs init` and saves its output to a log. It then runs `scripts/open-init-pr.sh` when the exit code is 0 or 3. The script:

1. stops with no pull request if nothing under `docs/` changed;
2. creates the branch `spriggs/init-<run id>` and commits only `docs/`, with the message `docs: Spriggs catches the docs up with the code`, authored as `github-actions[bot]`, or as `<slug>[bot]` when the action runs as a GitHub App (`SPRIGGS_APP_SLUG` is set);
3. pushes the branch, passing the token to git for that one command only. It never pushes to the branch the workflow ran on;
4. opens a pull request with the same title against the branch the workflow ran on, with the report (minus its marker lines) as the body. If the log holds no report, the body is one line saying Spriggs checked the docs against the code and filled the gaps it found.

Review the pages like any other change; they are a draft from the code.

On exit code 3 the action still opens the pull request with the pages written so far, and the report in its body starts with the **Stopped early** reason. Then the job fails with an error that points to `docs/todo.md`. If the post-run check fails, or init exits with any other code, the step fails and no pull request is opened. See [the action reference](../reference/github-action.md).

With the workflow's own token, the repository setting **Actions → General → Allow GitHub Actions to create and approve pull requests** must be on, or GitHub refuses to open the pull request. With a GitHub App it is not needed.