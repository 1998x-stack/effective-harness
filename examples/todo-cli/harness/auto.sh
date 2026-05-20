#!/usr/bin/env bash
set -euo pipefail

# Auto-run harness until all features pass
# Usage: ./harness/auto.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

check_remaining() {
    python3 -c "
import json, sys
with open('feature_list.json') as f:
    data = json.load(f)
pending = [f['id'] for f in data['features'] if not f['passes']]
if pending:
    print(f'{len(pending)} remaining: {\" \".join(pending[:5])}{\"...\" if len(pending)>5 else \"\"}')
    sys.exit(1)
else:
    print('ALL DONE')
    sys.exit(0)
"
}

echo "============================================"
echo " Auto-Harness: running until all features pass"
echo "============================================"
echo ""

ITERATION=1
while true; do
    echo "--- Iteration $ITERATION ---"
    check_remaining || {
        echo ""
        ./harness/run.sh
        echo ""
        ITERATION=$((ITERATION + 1))
        continue
    }
    break
done

echo ""
echo "============================================"
echo " All features passing. Project complete!"
echo "============================================"
