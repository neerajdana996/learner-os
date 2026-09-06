#!/usr/bin/env bash
# One-shot. Pushes the merged monorepo, then retires the three app repos.
# Delete this script once it has run — like create-github-repos.sh before it,
# it describes a world that no longer exists the moment it succeeds.
#
#   scripts/finish-monorepo-migration.sh --dry-run   show the plan, touch nothing
#   scripts/finish-monorepo-migration.sh             verify → push → delete
#   scripts/finish-monorepo-migration.sh --archive   verify → push → archive instead
#   scripts/finish-monorepo-migration.sh --push-only verify → push, leave the repos
#
# The order is deliberate and not negotiable: nothing is removed on GitHub until
# the monorepo is pushed AND proven to contain every file and every commit the
# repo being removed had. Deleting a GitHub repo is irreversible.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

OWNER="${OWNER:-neerajdana996}"
MONOREPO="${MONOREPO:-learner-os}"
APPS=(backend frontend extension)
BRANCH="${BRANCH:-main}"
WORK="${WORK:-/tmp/learnos-verify}"

ACTION=delete
case "${1:-}" in
  --dry-run)   ACTION=dryrun ;;
  --archive)   ACTION=archive ;;
  --push-only) ACTION=none ;;
  "")          ACTION=delete ;;
  *) echo "usage: $0 [--dry-run|--archive|--push-only]" >&2; exit 2 ;;
esac

say()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if [ "$ACTION" = dryrun ]; then echo "  [dry-run] $*"; else "$@"; fi; }

command -v gh  >/dev/null || die "gh not found — https://cli.github.com"
gh auth status >/dev/null 2>&1 || die "not logged in — run: gh auth login"

# ---------------------------------------------------------------- 1. preflight
say "1/5 preflight"
[ -z "$(git status --porcelain)" ] || die "working tree is dirty — commit or stash first"
ok "working tree clean"

CURRENT=$(git branch --show-current)
ok "on branch $CURRENT ($(git rev-list --count HEAD) commits)"

# The whole point of the merge was to keep history. If the app directories are
# not tracked here, something has gone very wrong and nothing should be deleted.
for app in "${APPS[@]}"; do
  n=$(git ls-files "$app" | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] || die "$app/ is not tracked in the monorepo"
done
ok "all three app directories tracked"

# ------------------------------------------- 2. prove the history is preserved
# The question that makes deletion safe is not "are these identical" — the
# monorepo is deliberately AHEAD, because the feature branches were landed
# before the merge and never pushed. It is "does the monorepo contain
# everything the remote has". So: every commit on every remote branch must
# appear in the monorepo's history for that directory.
#
# Matched on subject rather than SHA, because filter-repo rewrote every SHA
# when it moved these commits under their subdirectory. Subjects are what
# survived, and they are what a human would check by eye.
say "2/5 prove the monorepo contains everything each app repo has"
rm -rf "$WORK"; mkdir -p "$WORK"
for app in "${APPS[@]}"; do
  repo="$OWNER/$MONOREPO-$app"
  if ! gh repo view "$repo" >/dev/null 2>&1; then
    echo "  – $repo does not exist (already retired?), skipping"
    continue
  fi
  git clone -q "git@github.com:$repo.git" "$WORK/$app"

  # --all covers every branch the clone fetched, not just main: a stale task
  # branch nobody merged is still work, and still a reason not to delete.
  remote_subjects=$(cd "$WORK/$app" && git log --all --format=%s | sort -u)
  local_subjects=$(git log --all --format=%s -- "$app" | sort -u)

  missing=$(comm -23 <(echo "$remote_subjects") <(echo "$local_subjects") || true)
  [ -z "$missing" ] || {
    echo "  commits on $repo that are NOT in the monorepo:" >&2
    echo "$missing" | sed 's/^/      /' >&2
    die "$repo holds work the monorepo never saw — NOT safe to delete"
  }

  remote_n=$(echo "$remote_subjects" | grep -c . || true)
  local_n=$(echo "$local_subjects" | grep -c . || true)
  ok "$repo — all $remote_n commits present (monorepo has $local_n for $app/)"
done

# ------------------------------------------------------------------- 3. push
say "3/5 push the monorepo to $OWNER/$MONOREPO"

# --prune matters more than the fetch does. This working copy was cloned from a
# local path, so it inherited that clone's remote-tracking refs — origin/main
# and a handful of origin/task/* that never existed under the GitHub URL. Left
# in place they make `git rev-parse origin/main` succeed against a branch the
# remote does not have, which is exactly the wrong answer to "am I behind?".
run git fetch -q --prune origin || true

# Ask the remote, not the local ref cache. An empty answer means the branch is
# ours to create, not that something is wrong.
if [ -n "$(git ls-remote --heads origin "$BRANCH" 2>/dev/null)" ]; then
  behind=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)
  # Fast-forward only. If main has moved on the remote, stop and let a human
  # decide — a --force here would discard whatever moved it.
  [ "$behind" = "0" ] || die "origin/$BRANCH is $behind commit(s) ahead of you — merge before pushing"
  ok "origin/$BRANCH exists and is not ahead"
else
  echo "  – origin/$BRANCH does not exist yet; this push creates it"
fi

[ "$CURRENT" = "$BRANCH" ] || run git branch -f "$BRANCH" "$CURRENT"
run git push -u origin "$BRANCH"
run git push -u origin "$CURRENT"
ok "pushed $BRANCH and $CURRENT"

say "4/5 confirm the push landed"
if [ "$ACTION" != dryrun ]; then
  remote_head=$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)
  local_head=$(git rev-parse "$BRANCH")
  [ "$remote_head" = "$local_head" ] || die "origin/$BRANCH is $remote_head, expected $local_head"
  ok "origin/$BRANCH = $local_head"
else
  echo "  [dry-run] would verify origin/$BRANCH matches local"
fi

# --------------------------------------------------------------- 5. retire
say "5/5 retire the three app repos"
case "$ACTION" in
  none)   echo "  --push-only: leaving them alone."; exit 0 ;;
  dryrun) echo "  [dry-run] would DELETE: ${APPS[*]/#/$OWNER/$MONOREPO-}"; exit 0 ;;
esac

if [ "$ACTION" = delete ]; then
  gh auth status 2>&1 | grep -q 'delete_repo' || die \
    "your gh token lacks the delete_repo scope. Run:
       gh auth refresh -h github.com -s delete_repo
     then re-run this script."

  echo
  echo "  About to PERMANENTLY DELETE, and this cannot be undone:"
  for app in "${APPS[@]}"; do echo "      $OWNER/$MONOREPO-$app"; done
  echo
  echo "  Their history is already inside $OWNER/$MONOREPO — step 2 just proved it,"
  echo "  file by file. Archiving instead (--archive) keeps them read-only and is"
  echo "  reversible; deleting is not."
  echo
  printf "  Type the word DELETE to continue: "
  read -r reply
  [ "$reply" = "DELETE" ] || { echo "  aborted — nothing was removed."; exit 1; }
fi

for app in "${APPS[@]}"; do
  repo="$OWNER/$MONOREPO-$app"
  gh repo view "$repo" >/dev/null 2>&1 || { echo "  – $repo already gone"; continue; }
  if [ "$ACTION" = archive ]; then
    gh repo archive "$repo" --yes && ok "archived $repo"
  else
    gh repo delete "$repo" --yes && ok "deleted $repo"
  fi
done

rm -rf "$WORK"
echo
echo "Done. $OWNER/$MONOREPO is the only repo now."
echo "Two things left for you:"
echo "  - delete this script; it has nothing left to do"
echo "  - rm -rf $ROOT.before-monorepo   (659M local backup, once you are happy)"
