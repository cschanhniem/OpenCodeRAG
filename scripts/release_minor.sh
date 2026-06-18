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

TAG=$(git describe --tags --abbrev=0)
echo "Detected tag: $TAG"

run git push origin "$TAG"
run gh release create "$TAG" --title "Version $TAG" --notes "Minor release"
