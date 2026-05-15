# Ciyex Workspace Update Server

A tiny Cloudflare Worker that powers in-app auto-updates for Ciyex Workspace.
It implements the update protocol used by VS Code's `IUpdateService`, so the
desktop app's existing "Update available — Restart to install" flow Just Works.

## How it works

1. Every push to `main` runs `Build Windows`, which builds the installer + zip
   and creates a GitHub Release. The release includes a `metadata.json` asset
   with the build's commit SHA, version, per-platform download URLs, and SHA256
   hashes.
2. The running app polls `https://updates.ciyex.org/api/update/{platform}/{quality}/{commit}`
   every hour (and on Help → Check for Updates).
3. The Worker fetches the latest release from GitHub, reads `metadata.json`,
   and either returns `204 No Content` (already up to date) or a JSON payload
   pointing at the new installer.
4. VS Code's update service downloads the installer, verifies the SHA256, and
   shows the user a "Restart to Update" notification. One click and they're on
   the new build.

The Worker caches the manifest for 5 minutes via `caches.default`, so GitHub's
API rate limit is a non-issue even with thousands of clients.

## First-time deploy

You need a Cloudflare account (free tier is fine).

```bash
cd update-server
npm install
npx wrangler login           # one-time browser login
npx wrangler deploy
```

The first deploy publishes to `https://ciyex-workspace-updates.<your-subdomain>.workers.dev`.
Verify it's alive:

```bash
curl https://ciyex-workspace-updates.<your-subdomain>.workers.dev/healthz
# {"ok":true,"service":"ciyex-workspace-updates"}
```

### Bind the custom domain

`product.json` ships with `updateUrl: "https://updates.ciyex.org"`. Bind that
hostname in the Cloudflare dashboard:

1. **Workers & Pages → ciyex-workspace-updates → Settings → Domains & Routes**
2. **Add → Custom Domain → `updates.ciyex.org`**
3. Cloudflare creates the DNS record automatically (provided `ciyex.org` is on
   the same Cloudflare account).

Test:

```bash
curl https://updates.ciyex.org/api/update/win32-x64-user/stable/0000000000000000000000000000000000000000
# Should return JSON pointing at the latest release (or 204 if no release yet).
```

### Lift the GitHub API rate limit (optional but recommended)

```bash
gh auth refresh -s read:packages          # ensure token has public_repo
npx wrangler secret put GITHUB_TOKEN      # paste a fine-grained PAT
```

Without a token you get 60 requests/hr per Cloudflare PoP — usually fine due to
caching, but a token raises it to 5000/hr.

## Continuous deploy

`.github/workflows/deploy-update-server.yml` deploys on every push that touches
`update-server/`. Add these repo secrets first:

- `CLOUDFLARE_API_TOKEN` — Workers Edit token (Account scope)
- `CLOUDFLARE_ACCOUNT_ID` — your account ID

Until those secrets exist, the workflow runs the type-check step and skips the
deploy step (no failure noise).

## Local development

```bash
cd update-server
npm install
npx wrangler dev
# Worker runs on http://localhost:8787
curl http://localhost:8787/api/update/win32-x64-user/stable/000
```

## Protocol reference

```
GET /api/update/{platform}/{quality}/{commit}
```

- `platform` — VS Code's platform string. Currently supported by our builds:
  - `win32-x64-user` — Windows user-mode installer (default)
  - `win32-x64` — Windows system-mode installer (also returns the user installer)
  - `win32-x64-archive` — Windows portable zip
- `quality` — release channel. Always `oss` today (matches `VSCODE_QUALITY` in the build workflow).
- `commit` — SHA of the running build (auto-injected by gulp at build time).

Responses:

- `204 No Content` — running build is the latest, nothing to do.
- `200 OK` — JSON in VS Code's `IUpdate` shape:
  ```json
  {
    "url": "https://github.com/.../CiyexWorkspaceSetup-x64-1.114.0.exe",
    "name": "1.114.0",
    "version": "<commit-sha>",
    "productVersion": "1.114.0",
    "timestamp": 1735000000,
    "sha256hash": "<sha256-of-installer>",
    "supportsFastUpdate": false
  }
  ```

## What if I need to roll back a bad build?

GitHub Releases is the source of truth. Mark the bad release as a *prerelease*
or *draft* in the GitHub UI — the Worker skips both — and the previous good
release becomes "latest" again. Clients pick it up within 5 minutes (cache TTL).
