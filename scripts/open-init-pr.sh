#!/usr/bin/env bash
# After `spriggs init` in CI: commit docs/ to a new branch and open a pull request with it.
# Never pushes to the branch the workflow ran on. Needs GH_TOKEN; SPRIGGS_APP_SLUG when the token is an App's.
set -euo pipefail

if [ -z "$(git status --porcelain -- docs)" ]; then
  echo "spriggs init changed nothing under docs/; no pull request opened"
  exit 0
fi

name="github-actions[bot]"
email="41898282+github-actions[bot]@users.noreply.github.com"
if [ -n "${SPRIGGS_APP_SLUG:-}" ]; then
  name="${SPRIGGS_APP_SLUG}[bot]"
  email="$(gh api "users/${name}" --jq .id)+${name}@users.noreply.github.com"
fi

base="$GITHUB_REF_NAME"
branch="spriggs/init-${GITHUB_RUN_ID}"
title="docs: first set of docs from spriggs init"

git switch --quiet -c "$branch"
git add --all docs
git -c "user.name=$name" -c "user.email=$email" -c core.hooksPath=/dev/null commit --quiet -m "$title"

# The token goes to git for this one command only; it is never stored in git config.
auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
echo "::add-mask::$auth"
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" \
  push --quiet origin "HEAD:refs/heads/$branch"

body="$(mktemp)"
{
  echo "Spriggs explored the repository and wrote these pages. Review them like any other change: the pages are a first draft from the code, not a record of intent."
  echo
  # A run that stopped early says why.
  grep '^stopped early: ' "${SPRIGGS_INIT_LOG:-/dev/null}" || true
  # The result block of the run, without its two marker lines and the hint meant for a local run.
  sed -n '/^--- init result ---$/,/^--- end ---$/p' "${SPRIGGS_INIT_LOG:-/dev/null}" |
    grep -v -e '^--- ' -e '^Review the changes in docs/' || true
} > "$body"

gh pr create --base "$base" --head "$branch" --title "$title" --body-file "$body"
