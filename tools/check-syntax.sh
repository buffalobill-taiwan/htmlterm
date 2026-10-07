#!/usr/bin/env bash
# Parse every ES module in the repository and report syntax errors.
#
# `node --check file.js` is not enough here: without a package.json the .js
# file is checked in CommonJS mode, which accepts a top-level `return`.
# Reading the file on stdin with --input-type=module forces the ESM parser.
#
# Browser sources (js/) and the ESM tools (*.mjs) are ES modules; a few
# offline tools in tools/ are CommonJS and are skipped on purpose.
set -u
cd "$(dirname "$0")/.." || exit 1

fail=0
while IFS= read -r file; do
    if ! node --input-type=module --check < "$file" > /dev/null 2>&1; then
        echo "syntax error: $file"
        node --input-type=module --check < "$file" 2>&1 | head -5
        fail=1
    fi
done < <(find js -name '*.js' | sort; find tools -name '*.mjs' | sort)

if [ "$fail" -eq 0 ]; then
    echo "syntax OK"
fi
exit "$fail"
