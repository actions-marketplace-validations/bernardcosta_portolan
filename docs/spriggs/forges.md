---
summary: The Forge layer is how Spriggs talks to a code host. It covers the interface, the GitHub forge used in CI, the local forge behind --local, and how the sticky comment, labels, status and push work.
audience: agent
covers:
  - packages/spriggs/src/forge/types.ts
  - packages/spriggs/src/forge/github.ts
  - packages/spriggs/src/forge/local.ts
  - packages/spriggs/src/context.ts
  - packages/spriggs/src/git.ts
  - packages/spriggs/src/cli.ts
---

# Forges

The run never talks to GitHub directly. It talks to a `Forge` (`forge/types.ts`). The CLI picks `LocalForge` for `run --local --base <ref>` and `GitHubForge` otherwise.

```ts
interface Forge {
  getContext(): Promise<ForgeContext>;
  previousRun(): Promise<RunMarker | undefined>;
  upsertComment(markdown: string, marker: RunMarker): Promise<void>;
  setLabel(label: Label): Promise<void>;          // exactly one docs:* label
  setStatus(state: StatusState, description: string): Promise<void>;
  docsDebt(limit: number): Promise<Debt[]>;       // merged PRs with unchecked docs, newest first
  clearDebt(prs: number[]): Promise<void>;        // marks them docs:done
  commitAndPush(message: string): Promise<PushResult>; // "pushed" | "superseded" | "nothing" | "local"
}
```

`Debt` is one merged pull request whose docs were never fully updated: its number, its title and its changed file paths. The run gives those paths to the model, because the docs must match the code as it is now, not the old diff. See [A pull request run](pull-request-run.md#5-docs-debt).

`ForgeContext` (`context.ts`) is the normalised pull request: repository, base and head, the pull request itself (absent locally), commits oldest first, the event (absent locally), changed files with additions and deletions, the `git diff` arguments that reproduce them, Spriggs's own identity, and every email Spriggs may have committed with. To support another code host, implement this interface.

## Git helpers

`git.ts` runs git with `core.quotePath=false`, so paths with non-ASCII characters come out as they are. Changed files come from `git diff --numstat -z`; renames are keyed by the new path and binary files count as 0 lines. Commit messages come from `git log --reverse` between base and head.

## GitHubForge

Needs `GITHUB_TOKEN` and `GITHUB_EVENT_PATH`, which GitHub Actions sets. It reads a `pull_request` event; any other event is an error.

- **Diff.** `base.sha...head.sha` (the changes on the branch since the merge-base).
- **Identity.** By default `github-actions[bot]`. When `SPRIGGS_APP_SLUG` is set (the action does this when it mints a GitHub App token), Spriggs looks up `<slug>[bot]` and commits as `<slug>[bot] <id+slug[bot]@users.noreply.github.com>`. Commits by either identity count as Spriggs's own.
- **Sticky comment.** The comment starts with a hidden line `<!-- spriggs body=<hash> head=<sha> -->`. Only a comment with that start, posted by one of Spriggs's identities, counts. The run updates it, or creates it when there is none. The hash and SHA let the next run spot a description that did not move with the code.
- **Label.** Reads the labels as they are now (not from the event, which may be old for a queued run), removes the other `docs:*` labels and adds the new one if missing. The same code sets a label on another pull request when debt is cleared.
- **Status.** A commit status with context `spriggs`, description cut at 140 characters. It goes on the pull request's head commit, or on Spriggs's docs commit when the run pushed one.
- **Docs debt.** Lists closed pull requests on the pull request's base branch, sorted by the most recently updated, 100 at a time. It keeps those that were merged, are not this pull request, and carry `docs:needs-input` or `docs:partial`, newest first, up to the limit the run asks for. For each one it reads the changed files (100 at a time). A pull request merged with `docs:done` that still missed a fact is not returned: only the labels say there is debt.
- **Clear debt.** Sets `docs:done` on the given pull requests and removes their other `docs:*` labels.
- **Commit and push.** Stages everything under `docs/`, commits with hooks turned off, and pushes to the pull request's head branch. The token goes to git through an HTTP header for that one command; it is not stored in git config and is masked in errors. A push rejected because the branch moved (`[rejected]`, `non-fast-forward`, `fetch first`) returns `superseded`. Any other refusal, such as a protected branch, is an error. With nothing staged it returns `nothing`.

## LocalForge

Used by `run --local --base <ref>`. No GitHub and no `origin` remote needed.

- **Diff.** The working copy (uncommitted changes and untracked files, which count as all added lines) against the merge-base of `<ref>` and `HEAD`.
- **Pull request.** Only when `--reason <text>` is given: then the description is a **Why** section holding that text, the title is the head commit's subject, and the number is 0.
- **Report.** The comment, label and status are printed to the console.
- **Docs debt.** There is none: `docsDebt` returns an empty list and `clearDebt` does nothing.
- **Commit.** Nothing is committed. It prints the would-be commit message and a summary of the changes under `docs/`, and returns `local`.
- There is no previous run, so there is no drift note.
