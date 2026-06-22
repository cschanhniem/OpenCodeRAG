#!/usr/bin/env bash
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

if [[ "${1:-}" == "--dry" ]]; then
  DRY_RUN=1
fi

run() {
  echo "> $*"
  if [[ "$DRY_RUN" != "1" ]]; then
    "$@"
  else
    echo "(dry run) skipped"
  fi
}

die() {
  echo "Error: $*" >&2
  exit 1
}

trap 'die "Failed at line $LINENO"' ERR

PREV_TAG=$(git describe --tags --abbrev=0)
echo "Previous tag: $PREV_TAG"

NOTES=$(git log --oneline "$PREV_TAG"..HEAD || true)
if [[ -z "$NOTES" ]]; then
  die "No new commits since $PREV_TAG"
fi

DATE=$(date +%Y-%m-%d)
NOTES_FILE=$(mktemp)
trap 'rm -f "$NOTES_FILE"' EXIT
{
  echo "$DATE"
  echo ""
  echo "$NOTES" | sed 's/^/- /'
} > "$NOTES_FILE"

if [[ "$DRY_RUN" != "1" ]]; then
  run git push origin main
else
  echo "(dry run) would run: git push origin main"
fi

if [[ "$DRY_RUN" != "1" ]]; then
  run npm version minor
else
  echo "(dry run) would run: npm version minor"
fi

NEW_TAG=$(git describe --tags --abbrev=0)
echo "New tag: $NEW_TAG"

run git push origin "$NEW_TAG"
run gh release create "$NEW_TAG" --title "Version $NEW_TAG" --notes-file "$NOTES_FILE"
