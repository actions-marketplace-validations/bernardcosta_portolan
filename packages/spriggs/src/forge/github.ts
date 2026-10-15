import { Octokit } from "@octokit/rest";
import { DEFAULT_IDENTITY, type ForgeContext, type Identity } from "../context";
import { changedFiles, commitInfo, commitMessages, git } from "../git";
import {
  type Debt,
  type Forge,
  LABELS,
  type Label,
  type PushResult,
  type RunMarker,
  type StatusState,
} from "./types";

const MARKER = "<!-- spriggs";
const MARKER_RE = /^<!-- spriggs body=([0-9a-f]+) head=([0-9a-f]+) -->/;

/** The parts of the pull_request webhook payload Spriggs reads. */
type PullRequestEvent = {
  action: string;
  changes?: { body?: unknown };
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    user: { login: string };
    labels: { name: string }[];
    base: { sha: string; ref: string };
    head: { sha: string; ref: string; repo: { full_name: string } | null };
  };
  repository: { name: string; owner: { login: string }; html_url: string; default_branch: string };
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export class GitHubForge implements Forge {
  private readonly octokit: Octokit;
  private readonly token: string;
  private readonly eventPath: string;
  private event?: PullRequestEvent;
  private headSha = "";
  private identity: Identity = DEFAULT_IDENTITY;

  constructor(private readonly cwd = process.cwd()) {
    this.token = required("GITHUB_TOKEN");
    this.octokit = new Octokit({ auth: this.token });
    this.eventPath = required("GITHUB_EVENT_PATH");
  }

  private get ev(): PullRequestEvent {
    if (!this.event) throw new Error("getContext() must run first");
    return this.event;
  }

  private get target() {
    const { repository, pull_request } = this.ev;
    return {
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pull_request.number,
    };
  }

  async getContext(): Promise<ForgeContext> {
    const event = (await Bun.file(this.eventPath).json()) as PullRequestEvent;
    if (!event.pull_request) throw new Error("event is not a pull_request event");
    this.event = event;
    const { pull_request: pr, repository } = event;
    const head = commitInfo(pr.head.sha, this.cwd);
    this.headSha = pr.head.sha;
    this.identity = await this.resolveIdentity();
    const diffRevisions = [`${pr.base.sha}...${pr.head.sha}`];
    return {
      repo: {
        owner: repository.owner.login,
        name: repository.name,
        url: repository.html_url,
        defaultBranch: repository.default_branch,
      },
      base: { sha: pr.base.sha, ref: pr.base.ref },
      head: {
        sha: pr.head.sha,
        ref: pr.head.ref,
        repoFullName: pr.head.repo?.full_name ?? "",
        authorEmail: head.authorEmail,
        subject: head.subject,
      },
      pr: {
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        author: pr.user.login,
        labels: pr.labels.map((l) => l.name),
      },
      commits: commitMessages(pr.base.sha, pr.head.sha, this.cwd),
      self: this.identity,
      selfEmails: [...new Set([DEFAULT_IDENTITY.email, this.identity.email])],
      event: { action: event.action, bodyChanged: event.changes?.body !== undefined },
      files: changedFiles(diffRevisions, this.cwd),
      diffRevisions,
    };
  }

  /**
   * With a GitHub App token the workflow sets SPRIGGS_APP_SLUG; commits are then authored as
   * `<slug>[bot] <id+slug[bot]@users.noreply.github.com>`, the address GitHub links to the App.
   */
  private async resolveIdentity(): Promise<Identity> {
    const slug = process.env.SPRIGGS_APP_SLUG;
    if (!slug) return DEFAULT_IDENTITY;
    const name = `${slug}[bot]`;
    const { data } = await this.octokit.users.getByUsername({ username: name });
    return { name, email: `${data.id}+${name}@users.noreply.github.com` };
  }

  private async stickyComment(): Promise<{ id: number; body: string } | undefined> {
    const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
      ...this.target,
      per_page: 100,
    });
    // Only Spriggs's own comment: anyone can post text that starts with the marker.
    const own = new Set([DEFAULT_IDENTITY.name, this.identity.name]);
    const found = comments.find(
      (c) => c.body?.startsWith(MARKER) && c.user?.login !== undefined && own.has(c.user.login),
    );
    return found ? { id: found.id, body: found.body ?? "" } : undefined;
  }

  async previousRun(): Promise<RunMarker | undefined> {
    const m = MARKER_RE.exec((await this.stickyComment())?.body ?? "");
    return m?.[1] && m[2] ? { bodyHash: m[1], headSha: m[2] } : undefined;
  }

  async upsertComment(markdown: string, marker: RunMarker): Promise<void> {
    const body = `<!-- spriggs body=${marker.bodyHash} head=${marker.headSha} -->\n${markdown}`;
    const existing = await this.stickyComment();
    if (existing) {
      await this.octokit.issues.updateComment({ ...this.target, comment_id: existing.id, body });
    } else {
      await this.octokit.issues.createComment({ ...this.target, body });
    }
  }

  async setLabel(label: Label): Promise<void> {
    await this.labelPr(this.ev.pull_request.number, label);
  }

  /** Sets one docs:* label on a pull request and removes the others. */
  private async labelPr(issue_number: number, label: Label): Promise<void> {
    const target = { ...this.target, issue_number };
    // The labels now, not the event payload's: a queued run's payload is older than the last run.
    const { data } = await this.octokit.issues.listLabelsOnIssue({ ...target, per_page: 100 });
    const current = new Set(data.map((l) => l.name));
    for (const other of LABELS) {
      if (other !== label && current.has(other)) {
        await this.octokit.issues.removeLabel({ ...target, name: other }).catch((e) => {
          if ((e as { status?: number }).status !== 404) throw e; // already gone
        });
      }
    }
    if (!current.has(label)) {
      await this.octokit.issues.addLabels({ ...target, labels: [label] });
    }
  }

  async docsDebt(limit: number): Promise<Debt[]> {
    const { owner, repo } = this.target;
    // The 100 most recently updated closed pull requests on the base branch: older debt is for the cold start.
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state: "closed",
      base: this.ev.pull_request.base.ref,
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });
    const open = data
      .filter(
        (p) =>
          p.merged_at &&
          p.number !== this.ev.pull_request.number &&
          p.labels.some((l) => l.name === "docs:needs-input" || l.name === "docs:partial"),
      )
      .slice(0, limit);
    return Promise.all(
      open.map(async (p) => {
        const files = await this.octokit.pulls.listFiles({
          owner,
          repo,
          pull_number: p.number,
          per_page: 100,
        });
        return { number: p.number, title: p.title, files: files.data.map((f) => f.filename) };
      }),
    );
  }

  async clearDebt(prs: number[]): Promise<void> {
    for (const pr of prs) await this.labelPr(pr, "docs:done");
  }

  async setStatus(state: StatusState, description: string): Promise<void> {
    const { owner, repo } = this.target;
    await this.octokit.repos.createCommitStatus({
      owner,
      repo,
      sha: this.headSha,
      context: "spriggs",
      state,
      description: description.slice(0, 140),
    });
  }

  async commitAndPush(message: string): Promise<PushResult> {
    git(["add", "--all", "docs"], this.cwd);
    if (!git(["diff", "--cached", "--name-only"], this.cwd).trim()) return "nothing";
    git(
      [
        "-c",
        `user.name=${this.identity.name}`,
        "-c",
        `user.email=${this.identity.email}`,
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        message,
      ],
      this.cwd,
    );
    // The token goes to git for this one command only; it is never stored in git config.
    const auth = Buffer.from(`x-access-token:${this.token}`).toString("base64");
    try {
      git(
        [
          "-c",
          `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`,
          "push",
          "--quiet",
          "origin",
          `HEAD:refs/heads/${this.ev.pull_request.head.ref}`,
        ],
        this.cwd,
      );
    } catch (e) {
      const msg = (e as Error).message.replace(auth, "***");
      // A race with a newer push, not a refusal such as "[remote rejected] ... protected branch".
      if (/\[rejected\]|fetch first|non-fast-forward/.test(msg)) return "superseded";
      throw new Error(msg);
    }
    this.headSha = commitInfo("HEAD", this.cwd).sha;
    return "pushed";
  }
}
