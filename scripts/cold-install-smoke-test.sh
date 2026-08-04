#!/usr/bin/env bash
#
# Cold-install smoke test — the launch release gate (checklist P1.1 / P2.5).
#
# Proves that the *published* packages on npm and PyPI install cleanly from
# scratch and can talk to the live API. Run this AFTER `npm publish` / PyPI
# upload and BEFORE the public launch. If it fails, do not launch.
#
# It installs `anansi-memory` into throwaway temp dirs (never touches this
# repo or your global env), then runs a real ingest + context round-trip.
#
# Usage:
#   ANANSI_API_KEY=ans_...  ./scripts/cold-install-smoke-test.sh
#   ANANSI_API_KEY=ans_...  ANANSI_BASE_URL=https://anansimemory.com  ./scripts/cold-install-smoke-test.sh
#
# Exit 0 = both SDKs installed and worked. Exit 1 = at least one failed.

set -uo pipefail

BASE_URL="${ANANSI_BASE_URL:-https://anansimemory.com}"
BASE_URL="${BASE_URL%/}"

if [ -z "${ANANSI_API_KEY:-}" ]; then
  echo "ERROR: ANANSI_API_KEY env var is required (a real key from ${BASE_URL}/portal)." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'cd /; rm -rf "$WORK"' EXIT
echo "→ Base URL: $BASE_URL"
echo "→ Scratch:  $WORK"
echo

npm_ok=1
pip_ok=1

# ─────────────────────────────────────────────────────────────────────────────
# npm: install anansi-memory from the registry into a clean project
# ─────────────────────────────────────────────────────────────────────────────
echo "=== [1/2] npm: cold install + round-trip ==="
if command -v npm >/dev/null 2>&1; then
  mkdir -p "$WORK/npm" && cd "$WORK/npm"
  npm init -y >/dev/null 2>&1
  # Ensure ESM so `import` works
  node -e "const p=require('./package.json');p.type='module';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
  if npm install anansi-memory >/tmp/anansi_npm_install.log 2>&1; then
    INSTALLED_VER="$(node -e "console.log(require('anansi-memory/package.json').version)" 2>/dev/null || echo '?')"
    echo "   installed anansi-memory@${INSTALLED_VER}"
    cat > run.mjs <<'JS'
import AnansiMemory from "anansi-memory";
const memory = new AnansiMemory({ apiKey: process.env.ANANSI_API_KEY, baseUrl: process.env.ANANSI_BASE_URL });
const userId = `smoke-npm-${Date.now()}`;
const ing = await memory.ingest({ userId, content: "Cold-install smoke test: user prefers TypeScript.", sourceType: "note" });
if (!ing || (ing.queued !== true && !ing.id)) throw new Error("ingest did not return a queued result: " + JSON.stringify(ing));
const ctx = await memory.context({ userId });
if (!Array.isArray(ctx.static) || !Array.isArray(ctx.dynamic)) throw new Error("context shape unexpected: " + JSON.stringify(ctx));
console.log("   ingest + context OK (context keys: " + Object.keys(ctx).join(", ") + ")");
JS
    if ANANSI_API_KEY="$ANANSI_API_KEY" ANANSI_BASE_URL="$BASE_URL" node run.mjs; then
      echo "   ✅ npm SDK PASS"
    else
      echo "   ❌ npm SDK round-trip FAILED"; npm_ok=0
    fi
  else
    echo "   ❌ npm install failed (see /tmp/anansi_npm_install.log)"; npm_ok=0
  fi
else
  echo "   ⚠️  npm not found — skipping (install Node to run this leg)"; npm_ok=0
fi
echo

# ─────────────────────────────────────────────────────────────────────────────
# pip: install anansi-memory into a fresh venv
# ─────────────────────────────────────────────────────────────────────────────
echo "=== [2/2] pip: cold install + round-trip ==="
PY="$(command -v python3 || command -v python || true)"
if [ -n "$PY" ]; then
  "$PY" -m venv "$WORK/venv"
  # shellcheck disable=SC1091
  . "$WORK/venv/bin/activate"
  if pip install --quiet --upgrade pip >/dev/null 2>&1 && pip install --quiet anansi-memory >/tmp/anansi_pip_install.log 2>&1; then
    INSTALLED_PY="$(pip show anansi-memory 2>/dev/null | awk '/^Version:/{print $2}')"
    echo "   installed anansi-memory==${INSTALLED_PY:-?}"
    cat > "$WORK/run.py" <<'PY'
import os, sys
from anansi_memory import AnansiMemory
memory = AnansiMemory(api_key=os.environ["ANANSI_API_KEY"], base_url=os.environ["ANANSI_BASE_URL"])
user_id = f"smoke-pip-{os.getpid()}"
ing = memory.ingest(user_id=user_id, content="Cold-install smoke test: user prefers Python.", source_type="note")
ctx = memory.context(user_id=user_id)
assert hasattr(ctx, "static") and hasattr(ctx, "dynamic"), f"context shape unexpected: {ctx!r}"
print("   ingest + context OK")
PY
    if ANANSI_API_KEY="$ANANSI_API_KEY" ANANSI_BASE_URL="$BASE_URL" "$WORK/venv/bin/python" "$WORK/run.py"; then
      echo "   ✅ pip SDK PASS"
    else
      echo "   ❌ pip SDK round-trip FAILED"; pip_ok=0
    fi
  else
    echo "   ❌ pip install failed (see /tmp/anansi_pip_install.log)"; pip_ok=0
  fi
  deactivate 2>/dev/null || true
else
  echo "   ⚠️  python3 not found — skipping (install Python to run this leg)"; pip_ok=0
fi
echo

# ─────────────────────────────────────────────────────────────────────────────
echo "=================================================="
if [ "$npm_ok" -eq 1 ] && [ "$pip_ok" -eq 1 ]; then
  echo "✅ COLD-INSTALL SMOKE TEST PASSED — safe to launch."
  exit 0
else
  echo "❌ COLD-INSTALL SMOKE TEST FAILED — do NOT launch until green."
  echo "   npm: $([ $npm_ok -eq 1 ] && echo PASS || echo FAIL) · pip: $([ $pip_ok -eq 1 ] && echo PASS || echo FAIL)"
  exit 1
fi
