#!/usr/bin/env bash
# Trilogy Renewals Dashboard — Main CLI
set -euo pipefail

# Resolve symlinks to find real script location
_SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$_SOURCE" ]]; do
  _DIR="$(cd "$(dirname "$_SOURCE")" && pwd)"
  _SOURCE="$(readlink "$_SOURCE")"
  [[ "$_SOURCE" != /* ]] && _SOURCE="$_DIR/$_SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$_SOURCE")" && pwd)"
CONFIG="$SCRIPT_DIR/config.json"
DATA_DIR="$SCRIPT_DIR/data"
LIB_DIR="$SCRIPT_DIR/lib"

# ── helpers ──────────────────────────────────────────────────────────────────
die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "  → $*"; }

# ── usage ────────────────────────────────────────────────────────────────────
usage() {
cat <<'EOF'
Trilogy Renewals Dashboard

USAGE:
  bash run.sh                        Full pipeline: SF query → dashboard → open
  bash run.sh --score-only <file>    Build dashboard from existing JSON
  bash run.sh --owner "Name"         Filter dashboard to one owner
  bash run.sh --help                 Show this help

OUTPUT:
  Dashboard written to ~/Desktop/trilogy-renewals-dashboard.html
  Raw SF data saved to data/sf_opportunities_YYYYMMDD_HHMMSS.json

REQUIREMENTS:
  • claude CLI in PATH (for MCP Salesforce calls)
  • python3 in PATH
  • Salesforce MCP configured in Claude Code (trilogy tenant)
EOF
}

# ── parse args ────────────────────────────────────────────────────────────────
MODE="full"
OWNER_FILTER=""
SCORE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage; exit 0 ;;
    --score-only)
      MODE="score-only"
      [[ -n "${2:-}" ]] || die "--score-only requires a file argument"
      SCORE_FILE="$2"
      shift 2 ;;
    --owner)
      [[ -n "${2:-}" ]] || die "--owner requires a name argument"
      OWNER_FILTER="$2"
      shift 2 ;;
    *)
      die "Unknown argument: $1. Run 'bash run.sh --help' for usage." ;;
  esac
done

# ── config ────────────────────────────────────────────────────────────────────
[[ -f "$CONFIG" ]] || die "config.json not found at $CONFIG"
mkdir -p "$DATA_DIR"

BACK_MONTHS=$(python3 -c "import json; c=json.load(open('$CONFIG')); print(c.get('date_window_back_months',1))")
FWD_MONTHS=$(python3 -c "import json; c=json.load(open('$CONFIG')); print(c.get('date_window_forward_months',6))")
SOQL_TEMPLATE=$(python3 -c "import json; c=json.load(open('$CONFIG')); print(c['soql'])")
ACTIVITIES_SOQL=$(python3 -c "import json; c=json.load(open('$CONFIG')); print(c.get('activities_soql',''))")
OUTPUT_PATH=$(python3 -c "import json,os; c=json.load(open('$CONFIG')); print(os.path.expanduser(c['output_path']))")

# Calculate dynamic dates
DATE_FROM=$(python3 -c "
from datetime import date
import calendar
today = date.today()
m = today.month - $BACK_MONTHS
y = today.year
while m <= 0:
    m += 12; y -= 1
last_day = calendar.monthrange(y,m)[1]
d = min(today.day, last_day)
print(date(y,m,d).isoformat())
")

DATE_TO=$(python3 -c "
from datetime import date
import calendar
today = date.today()
m = today.month + $FWD_MONTHS
y = today.year
while m > 12:
    m -= 12; y += 1
last_day = calendar.monthrange(y,m)[1]
d = min(today.day, last_day)
print(date(y,m,d).isoformat())
")

# Interpolate dates into SOQL
SOQL=$(echo "$SOQL_TEMPLATE" | sed "s/{date_from}/$DATE_FROM/g" | sed "s/{date_to}/$DATE_TO/g")

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RAW_JSON="$DATA_DIR/sf_opportunities_$TIMESTAMP.json"
ACTIVITIES_JSON="$DATA_DIR/sf_activities_$TIMESTAMP.json"

# ── full pipeline or score-only ───────────────────────────────────────────────
if [[ "$MODE" == "score-only" ]]; then
  [[ -f "$SCORE_FILE" ]] || die "File not found: $SCORE_FILE"
  RAW_JSON="$SCORE_FILE"
  echo ""
  echo "Trilogy Renewals Dashboard — Build Only"
  echo "────────────────────────────────────────"
  info "Input file : $RAW_JSON"
  info "Output     : $OUTPUT_PATH"
  echo ""
else
  echo ""
  echo "Trilogy Renewals Dashboard — Full Refresh"
  echo "────────────────────────────────────────"
  info "Date range : $DATE_FROM → $DATE_TO"
  info "Querying Salesforce (trilogy tenant) via Claude MCP…"
  echo ""

  # Paginate in batches of 200 to stay under claude's inline-output limit (~2MB)
  _SOQL_FILE=$(mktemp)
  echo "$SOQL" > "$_SOQL_FILE"

  python3 - "$_SOQL_FILE" "$RAW_JSON" << 'PYEOF'
import subprocess, json, re, sys

soql_file, out_file = sys.argv[1], sys.argv[2]
base_soql = open(soql_file).read().strip()

PAGE = 200
all_recs = []
offset = 0

def extract(text):
    text = text.strip()
    try:
        p = json.loads(text)
        if isinstance(p, list): return p
        if isinstance(p, dict):
            for k in ('records', 'data', 'result'):
                if k in p and isinstance(p[k], list): return p[k]
    except: pass
    for pat in [r'```(?:json)?\s*(\[[\s\S]*?\])\s*```',
                r'(\[[\s\S]*\])', r'(\{[\s\S]*\})']:
        m = re.search(pat, text)
        if m:
            try:
                p = json.loads(m.group(1))
                if isinstance(p, list): return p
                if isinstance(p, dict):
                    for k in ('records', 'data', 'result'):
                        if k in p and isinstance(p[k], list): return p[k]
            except: pass
    return []

while True:
    paged_soql = f"{base_soql} LIMIT {PAGE} OFFSET {offset}"
    prompt = (
        "Use the mcp__salesforce__sf_query tool with tenantId 'trilogy' "
        "to run this SOQL and return ONLY a raw JSON array, no markdown, no explanation. "
        f"SOQL: {paged_soql}"
    )
    res = subprocess.run(
        ["claude", "-p", prompt, "--allowedTools", "mcp__salesforce__sf_query"],
        capture_output=True, text=True
    )
    if res.returncode != 0:
        print(f"  → claude error (offset {offset}): {res.stderr[:200]}", file=sys.stderr)
        break
    page_recs = extract(res.stdout)
    if not page_recs:
        break
    all_recs.extend(page_recs)
    print(f"  → Page {offset // PAGE + 1}: {len(page_recs)} records  (running total: {len(all_recs)})", file=sys.stderr)
    if len(page_recs) < PAGE:
        break
    offset += PAGE

with open(out_file, 'w') as f:
    json.dump(all_recs, f)
PYEOF

  rm -f "$_SOQL_FILE"

  RECORD_COUNT=$(python3 -c "
import json, sys
try:
    data = json.load(open('$RAW_JSON'))
    if isinstance(data, list): print(len(data))
    elif isinstance(data, dict):
        for k in ('records','data','result'):
            if k in data:
                v = data[k]
                if isinstance(v, list): print(len(v)); sys.exit()
                if isinstance(v,dict) and 'records' in v: print(len(v['records'])); sys.exit()
        print(1)
    else: print(0)
except: print(0)
")

  info "Records returned: $RECORD_COUNT"
  info "Saved to: $RAW_JSON"
  echo ""

  # ── query activities ──────────────────────────────────────────────────────
  if [[ -n "$ACTIVITIES_SOQL" ]]; then
    info "Querying Salesforce activities…"
    echo ""

    _ACT_SOQL_FILE=$(mktemp)
    echo "$ACTIVITIES_SOQL" > "$_ACT_SOQL_FILE"

    python3 - "$_ACT_SOQL_FILE" "$ACTIVITIES_JSON" << 'PYEOF'
import subprocess, json, re, sys

soql_file, out_file = sys.argv[1], sys.argv[2]
base_soql = open(soql_file).read().strip()

PAGE = 200
all_recs = []
offset = 0

def extract(text):
    text = text.strip()
    try:
        p = json.loads(text)
        if isinstance(p, list): return p
        if isinstance(p, dict):
            for k in ('records', 'data', 'result'):
                if k in p and isinstance(p[k], list): return p[k]
    except: pass
    for pat in [r'```(?:json)?\s*(\[[\s\S]*?\])\s*```',
                r'(\[[\s\S]*\])', r'(\{[\s\S]*\})']:
        m = re.search(pat, text)
        if m:
            try:
                p = json.loads(m.group(1))
                if isinstance(p, list): return p
                if isinstance(p, dict):
                    for k in ('records', 'data', 'result'):
                        if k in p and isinstance(p[k], list): return p[k]
            except: pass
    return []

while True:
    paged_soql = f"{base_soql} LIMIT {PAGE} OFFSET {offset}"
    prompt = (
        "Use the mcp__salesforce__sf_query tool with tenantId 'trilogy' "
        "to run this SOQL and return ONLY a raw JSON array, no markdown, no explanation. "
        f"SOQL: {paged_soql}"
    )
    res = subprocess.run(
        ["claude", "-p", prompt, "--allowedTools", "mcp__salesforce__sf_query"],
        capture_output=True, text=True
    )
    if res.returncode != 0:
        print(f"  → claude error (offset {offset}): {res.stderr[:200]}", file=sys.stderr)
        break
    page_recs = extract(res.stdout)
    if not page_recs:
        break
    all_recs.extend(page_recs)
    print(f"  → Page {offset // PAGE + 1}: {len(page_recs)} records  (running total: {len(all_recs)})", file=sys.stderr)
    if len(page_recs) < PAGE:
        break
    offset += PAGE

with open(out_file, 'w') as f:
    json.dump(all_recs, f)
PYEOF

    rm -f "$_ACT_SOQL_FILE"

    ACT_COUNT=$(python3 -c "
import json, sys
try:
    data = json.load(open('$ACTIVITIES_JSON'))
    print(len(data) if isinstance(data, list) else 0)
except: print(0)
")
    info "Activity records returned: $ACT_COUNT"
    info "Saved to: $ACTIVITIES_JSON"
    echo ""
  fi
fi

# ── build dashboard ───────────────────────────────────────────────────────────
info "Building dashboard…"
echo ""

BUILDER_ARGS=("$RAW_JSON" "$OUTPUT_PATH")
if [[ -n "$OWNER_FILTER" ]]; then
  BUILDER_ARGS+=("--owner" "$OWNER_FILTER")
fi
if [[ -f "$ACTIVITIES_JSON" ]]; then
  BUILDER_ARGS+=("--activities" "$ACTIVITIES_JSON")
fi

python3 "$LIB_DIR/build_dashboard.py" "${BUILDER_ARGS[@]}"

echo ""
info "Dashboard: $OUTPUT_PATH"
[[ -n "$OWNER_FILTER" ]] && info "Filtered to owner: $OWNER_FILTER"
echo ""

# ── open browser ─────────────────────────────────────────────────────────────
if [[ -f "$OUTPUT_PATH" ]]; then
  if command -v open &>/dev/null; then
    open "$OUTPUT_PATH"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$OUTPUT_PATH"
  else
    info "Open manually: $OUTPUT_PATH"
  fi
fi

echo "Done."
echo ""
