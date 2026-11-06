#!/usr/bin/env bash
# Run over SSH as the deployment user; no interactive shell setup is assumed.
set -euo pipefail
commit=${1:?Usage: deploy.sh COMMIT REPOSITORY_PATH}
repository=${2:?Usage: deploy.sh COMMIT REPOSITORY_PATH}
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit SHA.' >&2; exit 1; }
cd -- "$repository"
[[ $(pwd -P) == "$(git rev-parse --show-toplevel)" ]] || {
  echo 'Deployment path must be the repository root.' >&2; exit 1;
}
# Also protect against manually invoked deployments. Keep the lock outside tracked
# files, and hold it until the build, container updates and nginx reload finish.
exec 9>"$(git rev-parse --git-common-dir)/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
git fetch --no-tags origin master
# A queued older CI run must not roll production back after master has advanced.
if [[ $(git rev-parse FETCH_HEAD) != "$commit" ]]; then
  echo 'Skipping superseded commit: master has advanced.'
  exit 0
fi
# Preserve server-side edits instead of forcibly resetting them. Ignored cookies,
# build output and dependencies are allowed; checkout refuses untracked conflicts.
git diff --quiet && git diff --cached --quiet || {
  echo 'Tracked server files have local changes; deployment stopped.' >&2; exit 1;
}
git checkout --detach "$commit"
yarn install --frozen-lockfile
yarn deploy-all
