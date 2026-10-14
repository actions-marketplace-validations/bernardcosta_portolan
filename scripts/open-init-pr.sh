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
title="docs: Spriggs catches the docs up with the code"

git switch --quiet -c "$branch"
git add --all docs
git -c "user.name=$name" -c "user.email=$email" -c core.hooksPath=/dev/null commit --quiet -m "$title"

# The token goes to git for this one command only; it is never stored in git config.
auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
echo "::add-mask::$auth"
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" \
  push --quiet origin "HEAD:refs/heads/$branch"

body="$(mktemp)"
# The body is the report that init printed, without its two marker lines.
sed -n '/^--- init result ---$/,/^--- end ---$/p' "${SPRIGGS_INIT_LOG:-/dev/null}" | sed '1d;$d' > "$body"
[ -s "$body" ] || echo "Spriggs checked the docs against the code and filled the gaps it found." > "$body"

gh pr create --base "$base" --head "$branch" --title "$title" --body-file "$body"
