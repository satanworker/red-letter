#!/usr/bin/env bash
# C (git side): visibility of refs/red-letter/* to plain git. Run after c_refs.mjs.
set -u
URL="https://x-access-token:$(gh auth token)@github.com/satanworker/red-letter.git"
W=$(mktemp -d)
echo "== ls-remote"; git ls-remote "$URL" | grep -v '^.*HEAD$'
echo "== git clone: for-each-ref"; git clone -q "$URL" "$W/c" && git -C "$W/c" for-each-ref --format='%(refname)'
echo "== git clone --mirror: red-letter refs"; git clone -q --mirror "$URL" "$W/m" && git -C "$W/m" for-each-ref --format='%(refname)' refs/red-letter | wc -l
cd "$W/c"
echo "== explicit fetch"; git fetch -q origin 'refs/red-letter/*:refs/red-letter/*' && git for-each-ref --format='%(refname) %(objecttype)' refs/red-letter
echo "== normal push of spike/x"; git checkout -q -b spike/x && git commit -q --allow-empty -m "spike x" && git push -q origin spike/x 2>&1; git ls-remote "$URL" 'refs/red-letter/*' | wc -l
echo "== fetch --prune (default refspec)"; git fetch --prune origin 2>&1; git for-each-ref --format='%(refname)' refs/red-letter | wc -l
echo "== delete one remote custom ref, then fetch --prune with explicit refspec"
git push -q origin :refs/red-letter/main/x
git fetch --prune origin 'refs/red-letter/*:refs/red-letter/*' 2>&1; git for-each-ref --format='%(refname)' refs/red-letter/main/x | wc -l
echo "== push --mirror --dry-run from a plain clone (what it WOULD do)"
git -C "$W/c" push --mirror --dry-run origin 2>&1 | grep -E 'red-letter|deleted|main' | head -20
echo "== same, clone without the red-letter refs"
git clone -q "$URL" "$W/c2" && git -C "$W/c2" push --mirror --dry-run origin 2>&1 | grep -E 'red-letter|deleted' | head -20
rm -rf "$W"
