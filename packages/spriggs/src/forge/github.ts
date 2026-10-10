import { Octokit } from "@octokit/rest";
import { type ForgeContext, SPRIGGS_EMAIL, SPRIGGS_NAME } from "../context";
import { changedFiles, commitInfo, commitMessages, git } from "../git";
import {
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
      event: { action: event.action, bodyChanged: event.changes?.body !== undefined },
      files: changedFiles(diffRevisions, this.cwd),
      diffRevisions,
    };
  }

  private async stickyComment(): Promise<{ id: number; body: string } | undefined> {
    const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
      ...this.target,
      per_page: 100,
    });
    const found = comments.find((c) => c.body?.startsWith(MARKER));
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
    const current = new Set(this.ev.pull_request.labels.map((l) => l.name));
    for (const other of LABELS) {
      if (other !== label && current.has(other)) {
        await this.octokit.issues.removeLabel({ ...this.target, name: other });
      }
    }
    if (!current.has(label)) {
      await this.octokit.issues.addLabels({ ...this.target, labels: [label] });
    }
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
        `user.name=${SPRIGGS_NAME}`,
        "-c",
        `user.email=${SPRIGGS_EMAIL}`,
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
      if (/rejected|fetch first|non-fast-forward/.test(msg)) return "superseded";
      throw new Error(msg);
    }
    this.headSha = commitInfo("HEAD", this.cwd).sha;
    return "pushed";
  }
}
