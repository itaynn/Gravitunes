#!/bin/sh
# Run every JS test: core, each mode's test.mjs, and the sound engine. Usage: sh app/tools/run-tests.sh
cd "$(dirname "$0")/../.." || exit 1
fail=0
for t in app/tools/test-core.mjs app/modes/*/test.mjs; do
  if ! out=$(node "$t" 2>&1); then echo "FAIL $t"; echo "$out" | head -8; fail=1; fi
done
node --test sound-engine/tests/ 2>&1 | grep -E "(pass|fail) [0-9]"
exit $fail
