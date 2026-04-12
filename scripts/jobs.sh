#!/usr/bin/env bash
# Inspect graph-builder jobs and running processes.
#
# Usage:
#   ./scripts/jobs.sh                   # list all jobs + running processes
#   ./scripts/jobs.sh active            # list only active jobs
#   ./scripts/jobs.sh <report_id>       # status of a specific report
set -euo pipefail

API_URL="${API_URL:-http://localhost:8000}"
ARG="${1:-}"

if [ -n "$ARG" ] && [[ "$ARG" =~ ^[0-9a-f-]{36}$ ]]; then
  # UUID -> report status
  echo "=== Report $ARG ==="
  curl -s "$API_URL/api/v1/reports/$ARG/status" | python3 -m json.tool 2>/dev/null || curl -s "$API_URL/api/v1/reports/$ARG/status"
  exit 0
fi

FILTER=""
if [ -n "$ARG" ]; then
  FILTER="?status=$ARG"
fi

echo "=== Pipeline child processes (spawn) ==="
if pgrep -f "pipeline-runner" >/dev/null 2>&1; then
  ps -o pid,pcpu,pmem,etime,command -p $(pgrep -f "pipeline-runner" | tr '\n' ',') 2>/dev/null | head -20
else
  echo "  (none running)"
fi

echo ""
echo "=== Jobs from API ==="
RESP=$(curl -s "$API_URL/api/v1/jobs$FILTER" 2>/dev/null)
if [ -z "$RESP" ]; then
  echo "  API not reachable at $API_URL"
  exit 1
fi

echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
s = d.get('summary', {})
print(f\"Total: {s.get('total', 0)}  Active: {s.get('active', 0)}  Completed: {s.get('completed', 0)}  Failed: {s.get('failed', 0)}\")
print()
print(f\"{'STATUS':<14} {'REPORT_ID':<40} {'TYPE':<6} {'RESULT':<30}\")
print('-' * 100)
for j in d.get('jobs', []):
    result = j.get('result') or {}
    summary = ''
    if result:
        parts = []
        if 'entities' in result: parts.append(f\"ent={result['entities']}\")
        if 'claims' in result: parts.append(f\"clm={result['claims']}\")
        if 'relationships' in result: parts.append(f\"rel={result['relationships']}\")
        if 'edges' in result: parts.append(f\"edg={result['edges']}\")
        summary = ' '.join(parts)
    error = j.get('error')
    if error:
        summary = f\"ERR: {error[:40]}\"
    print(f\"{j['status']:<14} {j['report_id']:<40} {j['source_type']:<6} {summary:<30}\")
" 2>/dev/null || echo "$RESP"
