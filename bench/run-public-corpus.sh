#!/usr/bin/env bash
# One-command reproduction of the public-corpus benchmark (see BENCHMARK.md's
# "Public corpus" addendum, and issue #8: "Reproducible public benchmark corpus").
#
# Clones a pinned, permissively-licensed public TypeScript codebase and runs
# bench/benchmark.mjs against it. The commit is pinned so results are stable
# over time; the script refuses to run if the checkout doesn't land on that
# exact commit, so a silently-moved tag can never produce numbers that don't
# match what's published.
#
#   bash bench/run-public-corpus.sh
#
# Requires: git, node, and a built harness (`pnpm build` first).
set -euo pipefail

CORPUS_REPO="https://github.com/colinhacks/zod.git"
CORPUS_TAG="v3.25.76"
CORPUS_COMMIT="463f03eb8183dcdcdf735b180f2bf40883e66220"
CORPUS_DIR="$(dirname "$0")/../.bench-corpus/zod"

if [ ! -d "$CORPUS_DIR/.git" ]; then
  echo "Cloning $CORPUS_REPO @ $CORPUS_TAG into $CORPUS_DIR ..." >&2
  git clone --quiet --depth 1 --branch "$CORPUS_TAG" "$CORPUS_REPO" "$CORPUS_DIR"
fi

ACTUAL_COMMIT="$(git -C "$CORPUS_DIR" rev-parse HEAD)"
if [ "$ACTUAL_COMMIT" != "$CORPUS_COMMIT" ]; then
  echo "FATAL: corpus checkout is $ACTUAL_COMMIT, expected pinned $CORPUS_COMMIT." >&2
  echo "Delete $CORPUS_DIR and re-run to re-fetch the pinned commit." >&2
  exit 1
fi

echo "Corpus verified: colinhacks/zod @ $CORPUS_TAG ($CORPUS_COMMIT)" >&2
exec node "$(dirname "$0")/benchmark.mjs" "$CORPUS_DIR/packages/zod/src" "$CORPUS_DIR/packages/zod"
