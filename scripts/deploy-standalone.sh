#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/opt/russian-forest-sklad"
SERVICE="russian-forest-sklad.service"
cd "$ROOT"

echo "[1/6] Pull main"
git pull --ff-only origin main
echo "[2/6] Install dependencies"
pnpm install --frozen-lockfile
echo "[3/6] Build Next.js standalone"
pnpm build
test -f .next/standalone/server.js
test -d .next/static

echo "[4/6] Publish matching static assets"
mkdir -p .next/standalone/.next/static
cp -a .next/static/. .next/standalone/.next/static/
if [[ -d public ]]; then
  mkdir -p .next/standalone/public
  cp -a public/. .next/standalone/public/
fi
sudo chown -R sklad:sklad .next/standalone/.next/static
if [[ -d .next/standalone/public ]]; then
  sudo chown -R sklad:sklad .next/standalone/public
fi

echo "[5/6] Restart service"
sudo systemctl restart "$SERVICE"
sudo systemctl is-active --quiet "$SERVICE"

echo "[6/6] Smoke test"
for i in {1..12}; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/login || true)
  [[ "$status" == "200" ]] && break
  sleep 2
done
[[ "$status" == "200" ]] || { echo "ERROR: /login HTTP $status" >&2; exit 1; }
echo "OK: /login HTTP 200"
sudo systemctl status "$SERVICE" --no-pager
