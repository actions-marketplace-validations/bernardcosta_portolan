---
summary: What happens, step by step, when `spriggs survey` checks the docs of a whole repository against the code and fills the gaps, and how the GitHub Action turns the result into a pull request.
covers:
  - packages/spriggs/src/survey.ts
  - packages/spriggs/src/agent/survey-prompt.ts
  - packages/spriggs/src/agent/agents.ts
  - packages/spriggs/src/checks/links.ts
  - packages/spriggs/src/report.ts
  - packages/spriggs/src/verify.ts
  - scripts/open-survey-pr.sh
  - action.yml
---

# The survey (`spriggs survey`)

A pull request run only sees one diff. The survey is for a repository with no docs yet, or with docs far behind the code. Run it again whenever the docs may have fallen behind; each run starts with what the last one left in `docs/todo.md`. The code is in `packages/spriggs/src/survey.ts`.

To run it locally, run `bun run spriggs survey` from the repository root (see [setup.md](../setup.md)). To run it from the GitHub Action, see [In CI](#in-ci).

The survey never commits. It leaves its pages in the working tree. Locally you review and commit them yourself, then open a pull request. In CI the action commits them and opens a pull request.

## Steps

1. **Pick the model.** Same rules as a pull request run (see [configuration.md](../reference/configuration.md#how-the-model-is-picked)). A missing model or key stops here.
2. **Load the project.** Spriggs reads `docs/portolan.yml`. A broken file only prints a warning. It lists the existing docs with their summaries, and reads the body of `docs/todo.md` from the last run. The todo gets the same check as `read_file`: a symlink is ignored.
3. **Build the file outline.** The readable files are the tracked files plus untracked files that git does not ignore (`git ls-files --others --exclude-standard`). So the survey works before the first commit, and ignored files such as `.env` stay hidden. The outline lists root files (at most 40), then each folder two levels deep with its file count, capped at 300 lines.
4. **Run the survey agent.** The first message holds the project name, the existing docs, the todo from the last run (first 20,000 characters, its headings one level down) and the outline, and ends with "Begin by exploring." The system prompt (`agent/survey-prompt.ts`) tells the model to:
   - **Explore**: start with the open todo items, then read manifests, the README, CI files and entry points;
   - **Plan**: before any page, write `docs/todo.md` with a **To write** list (path, what it covers, the code it rests on) and a **To check** list (existing pages to check against the code), keeping the open items of the last run, most important first;
   - **Work**: write `portolan.yml` if missing, `overview.md`, `setup.md` and one page per big part of the repository, grouped in folders, and check the existing pages. After each page, rewrite the todo so it lists only what is left; a page checked only in part stays under **To check**;
   - **Finish** when both lists are empty, or when told the budget is nearly spent.

   Existing docs keep every fact the code supports, and the model changes what the code contradicts. It may also clean up: replace repeated text with a link and move a section to the page where it belongs. Docs describe how things work now, so it removes history and migration notes (the change entries keep the history) and text about files, commands, options or behaviour that the code no longer has. It moves a page with `move_doc` when its path no longer fits its subject, and deletes a page with `delete_doc` when its whole subject is gone from the code or another page already says all of it. It fixes the links to a page it moves or deletes, and names each change, move and deletion in its note. The todo is treated as data, like any other repository file. Tools and budget are in [agent-harness.md](agent-harness.md). When 80% of the budget is spent, the model is told once to stop exploring, make the todo accurate and finish; the console logs `budget: nearly spent; told the model to wrap up`.

   When the model calls `finish`, one check runs first. A relative link in any page under `docs/` that points to a file or heading that is not there refuses that finish once, with the list of dead links. Change entries and `docs/api/` are skipped. A second `finish` is accepted. See [Hard checks](agent-harness.md#hard-checks).
5. **Check the pages it wrote.** When the survey agent finished, a second set of agents checks the result. Each checker gets a fresh conversation, its own budget (60 turns, 1,000,000 tokens, 20 minutes) and a batch of the markdown pages this run wrote or moved (up to 40,000 characters and six pages a batch), so it does not trust what the run wrote. It reads the code again and corrects the claims the code does not support with `edit_doc`, and touches nothing else on the page. At most three checkers run at the same time, and the check budget `SPRIGGS_CHECK_TOKENS` (default 3,000,000 uncached tokens, three checkers) sets how many a survey may start; the pages that do not fit are named in the report as not checked. The console logs `verify: checking N page(s) in M batch(es)` and then `verify: done:` with the tokens. A checker that runs out of budget stops on its own: the corrections it already wrote stay, the console logs `verify stopped: <reason>`, and the run goes on. A checker may only change the pages of its own batch, so it cannot add or delete a page, and it has no `finish` checks of its own. The checkers share the run's record of file changes, so the post-run check reads the corrected pages too. Pages this run deleted, and `docs/todo.md`, are not checked. A run that stopped early runs no checkers. The same check pass runs after a pull request run, once its docs agent has finished, over the pages that run wrote and the pages whose `covers` match the change (see [pull-request-run.md](pull-request-run.md#7-check-pass)); a run that finds the docs already current writes nothing and starts no checker. With `SPRIGGS_EFFORT=low` no checker runs at all, and the survey agent gets half its token budget.
6. **Catch an early stop.** If the budget, the context window or the model gives out, the error is caught. The pages written so far stay. The console logs `stopped early:` with the reason; when the loop itself ended the run — the budget, the model not calling `finish`, or a reply cut at the output limit twice — the tokens used so far come with it. A context-window error or another error from the provider carries no token count. The stop reason is kept on one line, and is never empty ("unknown error" when there is no message).
7. **Post-run check.** `enforce.ts` checks every file the model changed, including deleted pages, with the same rules as a pull request run, but with no line cap and without the working-tree check. See [the docs contract](../reference/docs-contract.md#what-the-post-run-check-refuses). If it fails, Spriggs prints the reason, leaves the files for you to review, and exits with code 1.
8. **Count the todo.** Spriggs counts list items in the body of `docs/todo.md`. Bullets (`-`, `*`, `+`) and numbered items (`1.` or `1)`) count. If none are left and the model wrote the todo in this run, Spriggs deletes the file. It never deletes a todo the model did not write.
9. **Print the report** between the lines `--- survey result ---` and `--- end ---`.

## The report

The report is markdown, headed "Spriggs: survey report". It is written like the sticky comment of a pull request run. In order:

- a **Stopped early** line with the reason, when the run stopped before `finish`;
- the files written or deleted, new ones marked "(new page)" and deleted ones marked "(deleted)", or "I wrote no pages.";
- "N items left to write or check", pointing to `docs/todo.md`; or "I wrote and checked every page I planned." when the run finished with nothing left. A run that stopped early with no todo makes neither claim;
- "I removed `docs/todo.md`: nothing is left." when the run cleared a todo from an earlier run;
- "A note from the run:" with the model's note, if any;
- "**Checked against the code after writing:**" with the check pass's notes, one list item per line: its corrections, the pages a stopped checker could not check, and the pages left out by the check budget. The whole section is left out when the pass did not run;
- a line with the model name, tokens and turns, the check pass's tokens and turns included, when the run knows them; a stop on an error that carries no usage leaves the line out.

The stop reason and the file paths are flattened to one line each: line breaks and control characters become spaces, so neither can start a line of its own. The note keeps its line breaks: its other control characters become spaces, and a line that begins with `---` is escaped, so it cannot pass for a marker line of the report. In the note, `@` mentions, issue references and links are put in code. The note in the sticky comment of a pull request run gets that same treatment for `@` mentions, issue references and links, but it is not flattened and a line that begins with `---` is left as it is. GitHub does not notify, link or close anything inside code, so a note cannot ping people or close an issue when the pull request is merged.

## Exit codes

| Code | Means |
| --- | --- |
| 0 | The run finished and the check passed |
| 1 | The post-run check failed (this wins over an early stop), or an unexpected error |
| 3 | The run stopped before `finish`; the pages written so far stay and `docs/todo.md` lists what is left, when the model wrote a todo |

## In CI

The same Spriggs workflow runs both commands. The action's `command` input is empty by default, and then the event decides: a pull request runs `run`, and a start by hand (`workflow_dispatch`) runs `survey`. Set `command: run` or `command: survey` to force one. So to allow the survey, add `workflow_dispatch:` under `on:` in your Spriggs workflow, then open **Actions → spriggs → Run workflow**. GitHub shows the button only once the workflow file is on the default branch. A separate workflow with `command: survey` still works, but is not needed once `workflow_dispatch:` is in the main workflow.

The action runs `spriggs survey` and saves its output to a log. It then runs `scripts/open-survey-pr.sh` when the exit code is 0 or 3. The script:

1. stops with no pull request if nothing under `docs/` changed;
2. creates the branch `spriggs/survey-<run id>` and commits only `docs/`, with the message `docs: Spriggs catches the docs up with the code`, authored as `github-actions[bot]`, or as `<slug>[bot]` when the action runs as a GitHub App (`SPRIGGS_APP_SLUG` is set);
3. pushes the branch, passing the token to git for that one command only. It never pushes to the branch the workflow ran on;
4. opens a pull request with the same title against the branch the workflow ran on, with the report (minus its marker lines) as the body. If the log holds no report, the body is one line saying Spriggs checked the docs against the code and filled the gaps it found.

Review the pages like any other change; they are a draft from the code.

On exit code 3 the action still opens the pull request with the pages written so far, and the report in its body names the **Stopped early** reason near the top. Then the job fails with an error that points to `docs/todo.md`. If the post-run check fails, or the survey exits with any other code, the step fails and no pull request is opened. See [the action reference](../reference/github-action.md).

With the workflow's own token, the repository setting **Actions → General → Allow GitHub Actions to create and approve pull requests** must be on, or GitHub refuses to open the pull request. With a GitHub App it is not needed.
