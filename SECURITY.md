# Security policy

## Supported versions

Only the latest `v1` release gets security fixes. Pin `bernardcosta/portolan@v1` to receive them, or pin a full commit SHA and update it when a fix is released.

## Report a vulnerability

Do not open a public issue. Report it privately through [GitHub's vulnerability reporting](https://github.com/bernardcosta/portolan/security/advisories/new). Include the steps to reproduce it and the version or commit you used.

You will get a reply within 7 days. When the fix is released, the advisory is published and you are credited, unless you ask not to be.

## Scope

Spriggs runs in your CI with your model provider key and a GitHub token. These are in scope:

- A way for a pull request (its code, description or commits) to make Spriggs change files outside `docs/`, run code, or send data anywhere other than the model provider.
- A way for the model to see or leak `GITHUB_TOKEN` or the provider key.
- A way for a pull request from a fork to get the repository's secrets through the action.

Docs that Spriggs gets wrong are bugs, not vulnerabilities. Open an issue for them.
