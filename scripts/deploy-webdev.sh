#!/usr/bin/env bash
set -euo pipefail

# Deploy the committed development snapshot to the isolated VM108 stack.
# GitHub credentials are intentionally not required on webdev: the caller's
# local checkout is streamed as a tracked-file archive over SSH.

REMOTE_USER="${WEBDEV_USER:-mediacontrol}"
REMOTE_HOST="${WEBDEV_HOST:-192.168.1.190}"
REMOTE_PROJECT="${WEBDEV_PROJECT:-/home/mediacontrol/projects/hearth-and-havoc}"
COMPOSE_PROJECT="hearth-and-havoc-dev"
COMPOSE_FILE="infra/dev-compose.yaml"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing $COMPOSE_FILE" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to deploy a dirty worktree. Commit or stash changes first." >&2
  exit 1
fi

commit="$(git rev-parse --short HEAD)"
echo "Deploying Hearth & Havoc $commit to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PROJECT}"

git archive --format=tar HEAD |
  ssh -o BatchMode=yes "${REMOTE_USER}@${REMOTE_HOST}" \
    "mkdir -p '$REMOTE_PROJECT' && tar -xf - -C '$REMOTE_PROJECT'"

ssh -o BatchMode=yes "${REMOTE_USER}@${REMOTE_HOST}" \
  "cd '$REMOTE_PROJECT' && \
   docker compose -p '$COMPOSE_PROJECT' -f '$COMPOSE_FILE' up -d --build && \
   docker compose -p '$COMPOSE_PROJECT' -f '$COMPOSE_FILE' ps && \
   curl --fail --silent --show-error http://127.0.0.1:8100/api/health >/dev/null"

echo "Webdev deployment $commit is healthy at http://${REMOTE_HOST}:5183"
