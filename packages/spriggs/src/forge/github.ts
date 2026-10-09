import { Octokit } from "@octokit/rest";
import type { ForgeContext } from "../context";
import { changedFiles, commitInfo, commitSubjects } from "../git";
import { type Forge, LABELS, type Label, type StatusState } from "./types";

const MARKER = "<!-- spriggs -->";

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
  private readonly eventPath: string;
  private event?: PullRequestEvent;

  constructor(private readonly cwd = process.cwd()) {
    this.octokit = new Octokit({ auth: required("GITHUB_TOKEN") });
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
        commits: commitSubjects(pr.base.sha, pr.head.sha, this.cwd),
      },
      event: { action: event.action, bodyChanged: event.changes?.body !== undefined },
      files: changedFiles([`${pr.base.sha}...${pr.head.sha}`], this.cwd),
    };
  }

  async upsertComment(markdown: string): Promise<void> {
    const body = `${MARKER}\n${markdown}`;
    const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
      ...this.target,
      per_page: 100,
    });
    const existing = comments.find((c) => c.body?.startsWith(MARKER));
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
      sha: this.ev.pull_request.head.sha,
      context: "spriggs",
      state,
      description: description.slice(0, 140),
    });
  }
}
