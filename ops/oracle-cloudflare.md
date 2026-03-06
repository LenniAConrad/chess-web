# Oracle VM + Cloudflare Pages Deployment

## Architecture

- Frontend: Cloudflare Pages
- API: Oracle Always Free Ubuntu VM
- Database: Postgres on same Oracle VM
- TLS reverse proxy: Caddy
- DNS: Cloudflare (`app.example.com`, `api.example.com`)

## VM Setup

1. Create Ubuntu VM (Always Free shape).
2. Install Node 22, pnpm, Postgres, Caddy, git.
3. Clone repo to `/opt/chess-web`.
4. Create `/opt/chess-web/.env` with production values.

## API Service

1. Install deps and build:

```bash
cd /opt/chess-web
pnpm install --frozen-lockfile
pnpm -r build
pnpm --filter @chess-web/api migrate
```

2. Install systemd service from `ops/systemd/chess-api.service`.
3. Enable/start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chess-api
```

## Caddy

Configure Caddy to proxy `api.example.com` to `127.0.0.1:3001`.

## Cloudflare Pages

1. Connect GitHub repo.
2. Build command: `pnpm --filter @chess-web/web build`
3. Output dir: `apps/web/dist`
4. Set env var `VITE_API_BASE_URL=https://api.example.com`

## Daily Metrics Job

Use provided timer/service:

```bash
sudo cp ops/systemd/chess-metrics.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chess-metrics.timer
```

## Backups

- Nightly `pg_dump` (cron/systemd timer) to encrypted remote storage.
- Keep at least 7 rolling daily backups.
