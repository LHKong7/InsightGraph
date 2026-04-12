# Publishing InsightGraph packages

This guide explains how to publish the InsightGraph packages to an npm registry (public npm, a private registry, or a local Verdaccio instance). A helper script `scripts/publish.sh` automates the full flow.

---

## 1. What gets published

| Package | npm name | Purpose |
|---|---|---|
| `packages/core` | `@insightgraph/core` | Config, IR types, ontology, LLM wrapper |
| `packages/parser` | `@insightgraph/parser` | PDF/CSV/JSON/MD/XLSX → DocumentIR |
| `packages/extractor` | `@insightgraph/extractor` | LLM-based extraction |
| `packages/resolver` | `@insightgraph/resolver` | Entity resolution |
| `packages/graph` | `@insightgraph/graph` | Neo4j connection + writer + reader |
| `packages/retriever` | `@insightgraph/retriever` | Graph / hybrid retrieval + tools |
| `packages/agent-runtime` | `@insightgraph/agent-runtime` | Planner → Analyst pipeline |
| `sdk` | `insightgraph-sdk` | HTTP client (unscoped for discoverability) |
| `sdk-embedded` | `@insightgraph/sdk-embedded` | In-process full stack |

**Not published:** `apps/*`, `web/`, `electron-integration/`. Those are applications, not libraries.

---

## 2. One-time setup

### 2.1 Create the npm org

For the `@insightgraph/*` scope you need an npm org (or scope the packages under your own user name — e.g. `@yourname/core`). Skip if you already have one.

```bash
# Sign up at https://npmjs.com and run:
npm login
npm org create insightgraph      # requires a paid plan OR use free scope under your user
```

Free alternative: change the scope to your user. For example:

```bash
# One-off rename across all package.json files:
find packages sdk-embedded -name package.json \
  -exec sed -i '' 's|@insightgraph/|@yourname/|g' {} +
```

### 2.2 Configure `publishConfig`

Public packages under a scope need `"publishConfig": { "access": "public" }` in every `package.json`, otherwise npm assumes they are private and rejects publication. The helper script adds this automatically with `--prepare` (see §5), or you can do it once by hand.

```jsonc
// packages/*/package.json, sdk/package.json, sdk-embedded/package.json
{
  "name": "@insightgraph/core",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "repository": { "type": "git", "url": "github:your-org/insightgraph" }
}
```

**Important fields:**
- `files` — whitelist of paths included in the tarball. Without it, tests, source, and tsconfig leak out.
- `publishConfig.access: "public"` — required for scoped packages.
- `repository` / `homepage` / `bugs` — good citizenship, links from npm to GitHub.

### 2.3 Registry configuration

Default: npm public registry. To publish to a private registry or Verdaccio:

```bash
# Method A — one-off login
npm login --registry https://npm.your-company.com

# Method B — .npmrc (repo-local, committed if registry is public)
echo "@insightgraph:registry=https://npm.your-company.com" >> .npmrc
```

Never commit npm auth tokens.

---

## 3. Version & dependency rules

### 3.1 Workspace protocol

Internal deps use `"workspace:*"`:

```jsonc
// sdk-embedded/package.json
"dependencies": {
  "@insightgraph/core": "workspace:*",
  "@insightgraph/parser": "workspace:*"
}
```

`pnpm publish` automatically rewrites `workspace:*` to the actual version at publish time. Do **not** replace these by hand.

### 3.2 Version bumping

All packages should ship with the same version for simplicity. Two options:

**Option A — synchronized bump (recommended):**

```bash
./scripts/publish.sh --bump patch     # 0.1.0 → 0.1.1 everywhere
./scripts/publish.sh --bump minor     # 0.1.0 → 0.2.0 everywhere
./scripts/publish.sh --bump major     # 0.1.0 → 1.0.0 everywhere
./scripts/publish.sh --version 0.3.0  # pin exact version
```

**Option B — manage manually:**

```bash
pnpm -r exec npm version 0.2.0 --no-git-tag-version
```

Then commit the version bumps before publishing.

### 3.3 Dependency order

Packages must be published in topological order so that by the time `@insightgraph/sdk-embedded` goes out, all its deps already exist on the registry:

```
1. @insightgraph/core
2. @insightgraph/parser            (depends on core)
3. @insightgraph/graph             (depends on core)
4. @insightgraph/extractor         (depends on core)
5. @insightgraph/resolver          (depends on core)
6. @insightgraph/retriever         (depends on core, graph)
7. @insightgraph/agent-runtime     (depends on core)
8. @insightgraph/sdk-embedded      (depends on all of the above)
9. insightgraph-sdk                (depends on nothing)
```

The helper script handles this ordering automatically.

---

## 4. The publishing workflow

### 4.1 Dry-run first (strongly recommended)

```bash
./scripts/publish.sh --dry-run
```

This:
1. Checks git working tree is clean.
2. Runs `pnpm install` and `pnpm run build`.
3. Rewrites `workspace:*` in a tarball copy and shows what *would* be published.
4. **Does not touch the registry.**

Inspect the output: package sizes, file lists, version numbers.

### 4.2 Publish

```bash
./scripts/publish.sh --bump patch           # bump + publish
# or
./scripts/publish.sh                        # publish current versions
```

The script will:
1. Verify the working tree is clean (unless `--dirty`).
2. Run lint (`pnpm -r lint`) and build (`pnpm -r build`).
3. Optionally bump versions (`--bump patch|minor|major` or `--version x.y.z`).
4. Publish each package in dependency order with `pnpm publish --access public`.
5. On success, create an annotated git tag `v<version>`.

### 4.3 Verify

```bash
npm view @insightgraph/sdk-embedded version      # should show the new version
npm view @insightgraph/sdk-embedded dependencies # workspace:* should be resolved
```

Install a package in a scratch project to smoke-test:

```bash
mkdir /tmp/ig-test && cd /tmp/ig-test
pnpm init -y
pnpm add @insightgraph/sdk-embedded
node -e "console.log(Object.keys(require('@insightgraph/sdk-embedded')))"
```

---

## 5. Script flags reference

```bash
./scripts/publish.sh [options]

Options:
  --dry-run            Do everything except npm publish (pnpm publish --dry-run).
  --bump <level>       Bump versions: patch | minor | major.
  --version <x.y.z>    Set an exact version across all packages.
  --tag <npm-tag>      Publish under a dist-tag (e.g. "beta", "next"). Default: latest.
  --registry <url>     Override the npm registry for this publish.
  --dirty              Skip the clean-working-tree check (not recommended).
  --skip-lint          Skip the lint step.
  --skip-build         Skip the build step (useful if dist/ is already current).
  --only <pkg>         Publish only the named package (e.g. `@insightgraph/core`).
  --prepare            Just add `files` + `publishConfig` to all package.json files
                       and exit. Run this once before your first publish.
  -h, --help           Show this help.
```

---

## 6. Publishing to a local Verdaccio (dev / test)

Useful when you want to smoke-test the published artefacts without polluting the real registry.

```bash
# Start verdaccio (one-off, keeps running)
pnpm dlx verdaccio --listen 4873 &
npm adduser --registry http://localhost:4873  # any creds work

# Publish to it
./scripts/publish.sh --registry http://localhost:4873 --dirty

# Consume from it in a scratch project
pnpm init -y
pnpm add --registry http://localhost:4873 @insightgraph/sdk-embedded
```

Tear down with `docker rm -f verdaccio` or `pkill verdaccio`.

---

## 7. Unpublishing / deprecating

```bash
# Within 72 hours of publish — can unpublish:
npm unpublish @insightgraph/core@0.1.1

# After 72 hours — can only deprecate (recommended):
npm deprecate @insightgraph/core@"<0.2.0" "Upgrade to 0.2.x for security fix"
```

**Never** unpublish a version someone else depends on. Always prefer `deprecate`.

---

## 8. CI / automation

For a hands-off release, call the script from GitHub Actions:

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ["v*"]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: https://registry.npmjs.org }
      - run: pnpm install --frozen-lockfile
      - run: ./scripts/publish.sh --skip-lint --dirty
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Tag `v0.2.0` locally, push tags, CI takes it from there.

---

## 9. Checklist

Before running `./scripts/publish.sh`:

- [ ] Logged in: `npm whoami` returns your account.
- [ ] Working tree is clean (`git status`).
- [ ] `.env` and other local config are in `.gitignore` (they are by default).
- [ ] `scripts/publish.sh --prepare` has been run at least once on this repo.
- [ ] CHANGELOG or release notes updated (optional but nice).
- [ ] `--dry-run` output looks correct (no `src/` leaked, no stray files).

Then:

```bash
./scripts/publish.sh --bump patch
```

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `403 Forbidden - PUT https://.../@insightgraph%2fcore` | First-time publish to a scoped package requires `--access public`. The script passes this automatically; verify with `npm view @insightgraph/core` that the name is reachable. |
| `You cannot publish over the previously published versions` | Bump the version with `--bump patch` before re-publishing. |
| `ENEEDAUTH` | Run `npm login` or set `NODE_AUTH_TOKEN` in CI. |
| `workspace:*` appears in the published `package.json` | You ran `npm publish` instead of `pnpm publish`. Use the script. |
| `Cannot find module '@insightgraph/core'` after install | A dependency wasn't published, or topological order was wrong. The script publishes in the correct order — check its output. |
| Script says "working tree is dirty" | Commit or stash changes, or use `--dirty` to override. |
