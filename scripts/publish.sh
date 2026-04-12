#!/usr/bin/env bash
# Publish InsightGraph packages to an npm registry in dependency order.
#
# See PUBLISHING.md for full documentation.
set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DRY_RUN=false
DIRTY=false
SKIP_LINT=false
SKIP_BUILD=false
BUMP=""
EXACT_VERSION=""
NPM_TAG=""
REGISTRY=""
ONLY=""
PREPARE_ONLY=false

# Publish order: deps first. Paths relative to repo root.
PKG_PATHS=(
  "packages/core"
  "packages/parser"
  "packages/graph"
  "packages/extractor"
  "packages/resolver"
  "packages/retriever"
  "packages/agent-runtime"
  "sdk-embedded"
  "sdk"
)

# ---------------------------------------------------------------------------
# CLI parsing
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: ./scripts/publish.sh [options]

Options:
  --dry-run            Run everything except the actual npm publish.
  --bump <level>       Bump versions: patch | minor | major.
  --version <x.y.z>    Set an exact version across all packages.
  --tag <npm-tag>      Publish under a dist-tag (e.g. "beta"). Default: latest.
  --registry <url>     Override the npm registry.
  --dirty              Skip the clean-working-tree check.
  --skip-lint          Skip lint.
  --skip-build         Skip build.
  --only <pkg>         Publish only the named package (e.g. @insightgraph/core).
  --prepare            Add `files` + `publishConfig` to every package.json and exit.
  -h, --help           Show this help.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)     DRY_RUN=true; shift ;;
    --bump)        BUMP="$2"; shift 2 ;;
    --version)     EXACT_VERSION="$2"; shift 2 ;;
    --tag)         NPM_TAG="$2"; shift 2 ;;
    --registry)    REGISTRY="$2"; shift 2 ;;
    --dirty)       DIRTY=true; shift ;;
    --skip-lint)   SKIP_LINT=true; shift ;;
    --skip-build)  SKIP_BUILD=true; shift ;;
    --only)        ONLY="$2"; shift 2 ;;
    --prepare)     PREPARE_ONLY=true; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [ -n "$BUMP" ] && [ -n "$EXACT_VERSION" ]; then
  echo "Error: --bump and --version are mutually exclusive" >&2
  exit 1
fi

if [ -n "$BUMP" ] && [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "Error: --bump must be one of: patch, minor, major (got '$BUMP')" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()   { printf "\033[36m▸\033[0m %s\n" "$*"; }
ok()    { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn()  { printf "\033[33m⚠\033[0m %s\n" "$*"; }
err()   { printf "\033[31m✗\033[0m %s\n" "$*"; }

pkg_name() {
  node -p "require('./$1/package.json').name"
}

pkg_version() {
  node -p "require('./$1/package.json').version"
}

# ---------------------------------------------------------------------------
# --prepare: patch every package.json with `files` and `publishConfig`
# ---------------------------------------------------------------------------
if [ "$PREPARE_ONLY" = true ]; then
  log "Preparing package.json files for publication..."
  for pkg in "${PKG_PATHS[@]}"; do
    node -e "
      const fs = require('fs');
      const path = '$pkg/package.json';
      const p = JSON.parse(fs.readFileSync(path, 'utf8'));
      if (!p.files)         p.files = ['dist', 'README.md', 'LICENSE'];
      if (!p.publishConfig) p.publishConfig = { access: 'public' };
      if (!p.types && p.main) p.types = p.main.replace(/\.js$/, '.d.ts');
      fs.writeFileSync(path, JSON.stringify(p, null, 2) + '\n');
      console.log(' '.repeat(2) + '→ ' + p.name);
    "
  done
  ok "Prepared. Review the changes with 'git diff' and commit."
  exit 0
fi

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if [ "$DIRTY" != true ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    err "Working tree is dirty. Commit or stash your changes, or pass --dirty."
    exit 1
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  err "pnpm is required but not installed."
  exit 1
fi

# Verify npm auth for the registry we'll publish to (skipped on dry-run)
if [ "$DRY_RUN" != true ]; then
  if [ -n "$REGISTRY" ]; then
    WHOAMI=$(npm whoami --registry "$REGISTRY" 2>/dev/null || true)
  else
    WHOAMI=$(npm whoami 2>/dev/null || true)
  fi
  if [ -z "$WHOAMI" ]; then
    err "Not logged in to npm${REGISTRY:+ ($REGISTRY)}. Run: npm login${REGISTRY:+ --registry $REGISTRY}"
    exit 1
  fi
  ok "Logged in as: $WHOAMI"
fi

# ---------------------------------------------------------------------------
# Install + lint + build
# ---------------------------------------------------------------------------
log "pnpm install"
pnpm install --frozen-lockfile 2>&1 | tail -3

if [ "$SKIP_LINT" != true ]; then
  log "pnpm -r lint"
  pnpm -r --if-present run lint
fi

if [ "$SKIP_BUILD" != true ]; then
  log "pnpm -r build"
  pnpm -r --if-present run build 2>&1 | tail -5
fi

# ---------------------------------------------------------------------------
# Version bump
# ---------------------------------------------------------------------------
NEW_VERSION=""
if [ -n "$EXACT_VERSION" ]; then
  NEW_VERSION="$EXACT_VERSION"
elif [ -n "$BUMP" ]; then
  # Compute new version from the first package (all are kept in sync)
  CURRENT=$(pkg_version "${PKG_PATHS[0]}")
  NEW_VERSION=$(node -e "
    const [maj, min, pat] = '$CURRENT'.split('.').map(Number);
    const lvl = '$BUMP';
    if (lvl === 'patch') console.log([maj, min, pat + 1].join('.'));
    else if (lvl === 'minor') console.log([maj, min + 1, 0].join('.'));
    else if (lvl === 'major') console.log([maj + 1, 0, 0].join('.'));
  ")
fi

if [ -n "$NEW_VERSION" ]; then
  log "Bumping all packages to v$NEW_VERSION"
  for pkg in "${PKG_PATHS[@]}"; do
    node -e "
      const fs = require('fs');
      const path = '$pkg/package.json';
      const p = JSON.parse(fs.readFileSync(path, 'utf8'));
      p.version = '$NEW_VERSION';
      fs.writeFileSync(path, JSON.stringify(p, null, 2) + '\n');
    "
    ok "$(pkg_name "$pkg") → $NEW_VERSION"
  done
fi

# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------
PUBLISH_FLAGS=()
if [ "$DRY_RUN" = true ];  then PUBLISH_FLAGS+=("--dry-run"); fi
if [ -n "$NPM_TAG" ];     then PUBLISH_FLAGS+=("--tag" "$NPM_TAG"); fi
if [ -n "$REGISTRY" ];    then PUBLISH_FLAGS+=("--registry" "$REGISTRY"); fi
PUBLISH_FLAGS+=("--access" "public" "--no-git-checks")

PUBLISHED=()
for pkg in "${PKG_PATHS[@]}"; do
  NAME=$(pkg_name "$pkg")
  if [ -n "$ONLY" ] && [ "$NAME" != "$ONLY" ]; then
    continue
  fi

  VER=$(pkg_version "$pkg")
  log "Publishing $NAME@$VER from $pkg"

  if (cd "$pkg" && pnpm publish "${PUBLISH_FLAGS[@]}"); then
    ok "$NAME@$VER"
    PUBLISHED+=("$NAME@$VER")
  else
    err "Failed to publish $NAME"
    if [ ${#PUBLISHED[@]} -gt 0 ]; then
      warn "Already published this run: ${PUBLISHED[*]}"
      warn "You may need to bump the version and retry, or manually unpublish."
    fi
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Git tag on success (only for real publishes with a version bump)
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" != true ] && [ -n "$NEW_VERSION" ] && [ -z "$ONLY" ]; then
  log "Committing version bump + tagging v$NEW_VERSION"
  git add -A
  git commit -m "chore(release): v$NEW_VERSION" || warn "Nothing to commit"
  git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION" || warn "Tag may already exist"
  ok "Tagged v$NEW_VERSION (push with: git push --follow-tags)"
fi

echo ""
ok "Done. Published ${#PUBLISHED[@]} package(s):"
for p in "${PUBLISHED[@]}"; do echo "    • $p"; done
