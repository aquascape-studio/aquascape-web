#!/usr/bin/env bash
# Vendor @aquascape/sim-core (TypeScript engine) and botany plants.json into
# lib/sim/vendor/. CI does not check out aquascape-sim, so the vendored files
# are committed. Re-run after the engine or the species database changes.
#
# Env:
#   SIM_DIR      path to the aquascape-sim checkout   (default ../aquascape-sim)
#   SIM_REF      optional git ref to export instead of the working tree,
#                e.g. origin/iter/2026-11-12-sim-core (uses `git archive`,
#                never changes the sim repo's checked-out branch)
#   BOTANY_DIR   path to the aquascape-botany checkout (default ../aquascape-botany)
#   BOTANY_REF   optional git ref for plants.json (default: working tree)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIM_DIR="$(cd "${SIM_DIR:-$ROOT/../aquascape-sim}" && pwd)"
BOTANY_DIR="$(cd "${BOTANY_DIR:-$ROOT/../aquascape-botany}" && pwd)"
SIM_REF="${SIM_REF:-}"
BOTANY_REF="${BOTANY_REF:-}"

VENDOR="$ROOT/lib/sim/vendor"
DEST="$VENDOR/sim-core"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- sim-core sources -------------------------------------------------------
if [[ -n "$SIM_REF" ]]; then
  git -C "$SIM_DIR" archive --format=tar "$SIM_REF" ts/src | tar -x -C "$TMP"
  SIM_SHA="$(git -C "$SIM_DIR" rev-parse "$SIM_REF^{commit}")"
  SIM_DIRTY=false
else
  mkdir -p "$TMP/ts"
  cp -R "$SIM_DIR/ts/src" "$TMP/ts/src"
  SIM_SHA="$(git -C "$SIM_DIR" rev-parse HEAD)"
  if [[ -n "$(git -C "$SIM_DIR" status --porcelain -- ts/src)" ]]; then SIM_DIRTY=true; else SIM_DIRTY=false; fi
  SIM_REF="$(git -C "$SIM_DIR" rev-parse --abbrev-ref HEAD) (working tree)"
fi
SRC="$TMP/ts/src"
[[ -f "$SRC/contract.ts" ]] || { echo "error: $SRC/contract.ts not found" >&2; exit 1; }

# Drop tests and fixtures — only runtime sources are vendored.
find "$SRC" \( -name '*.test.ts' -o -name '*.spec.ts' -o -name '*.test.tsx' -o -name '*.bench.ts' \) -delete
find "$SRC" -type d \( -name '__tests__' -o -name 'fixtures' \) -prune -exec rm -rf {} +

PLACEHOLDER=false
if [[ ! -f "$SRC/index.ts" ]]; then
  # Engine not published yet: keep an existing labelled placeholder index.ts.
  if [[ -f "$DEST/index.ts" ]] && grep -q "SIM-CORE PLACEHOLDER" "$DEST/index.ts"; then
    cp "$DEST/index.ts" "$SRC/index.ts"
    PLACEHOLDER=true
    echo "warning: sim-core has no index.ts at $SIM_REF; keeping vendored PLACEHOLDER engine" >&2
  else
    echo "error: $SIM_REF has no ts/src/index.ts and no placeholder to keep" >&2
    exit 1
  fi
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"

# sim-core is type-checked in its own CI under its own tsconfig
# (noUncheckedIndexedAccess: false). aquascape-web is stricter, so engine
# implementation files are exempted here. contract.ts stays fully checked — it
# is the surface the web code programs against.
find "$DEST" -name '*.ts' ! -name 'contract.ts' -print0 | while IFS= read -r -d '' f; do
  if ! head -n 1 "$f" | grep -q '@ts-nocheck'; then
    { printf '// @ts-nocheck -- vendored from aquascape-sim; type-checked upstream (see scripts/sync-sim-core.sh)\n'; cat "$f"; } > "$f.tmp"
    mv "$f.tmp" "$f"
  fi
done

# ---- botany plants.json -----------------------------------------------------
if [[ -n "$BOTANY_REF" ]]; then
  git -C "$BOTANY_DIR" show "$BOTANY_REF:data/plants.json" > "$VENDOR/plants.json"
  BOTANY_SHA="$(git -C "$BOTANY_DIR" rev-parse "$BOTANY_REF^{commit}")"
else
  cp "$BOTANY_DIR/data/plants.json" "$VENDOR/plants.json"
  BOTANY_SHA="$(git -C "$BOTANY_DIR" rev-parse HEAD)"
  BOTANY_REF="$(git -C "$BOTANY_DIR" rev-parse --abbrev-ref HEAD) (working tree)"
fi
if [[ -n "$(git -C "$BOTANY_DIR" status --porcelain -- data/plants.json)" ]]; then BOTANY_DIRTY=true; else BOTANY_DIRTY=false; fi

# ---- provenance ---------------------------------------------------------------
FILES_JSON="$(cd "$DEST" && find . -type f | sed 's|^\./||' | sort | node -e '
  const lines = require("fs").readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
  process.stdout.write(JSON.stringify(lines));')"

node -e '
  const [simSha, simRef, simDirty, placeholder, botSha, botRef, botDirty, files] = process.argv.slice(1);
  const out = {
    syncedAt: new Date().toISOString(),
    script: "scripts/sync-sim-core.sh",
    simCore: {
      repo: "aquascape-studio/aquascape-sim",
      path: "ts/src",
      ref: simRef,
      commit: simSha,
      dirty: simDirty === "true",
      placeholder: placeholder === "true",
      files: JSON.parse(files),
    },
    plants: {
      repo: "aquascape-studio/aquascape-botany",
      path: "data/plants.json",
      ref: botRef,
      commit: botSha,
      dirty: botDirty === "true",
    },
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
' "$SIM_SHA" "$SIM_REF" "$SIM_DIRTY" "$PLACEHOLDER" "$BOTANY_SHA" "$BOTANY_REF" "$BOTANY_DIRTY" "$FILES_JSON" > "$VENDOR/VENDOR.json"

echo "vendored sim-core@${SIM_SHA:0:7} (placeholder=$PLACEHOLDER) + plants.json@${BOTANY_SHA:0:7} → lib/sim/vendor/"
