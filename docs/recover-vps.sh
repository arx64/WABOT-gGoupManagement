#!/usr/bin/env bash
set -Eeuo pipefail

# Rebuild a fresh Ubuntu VPS and restore the bot.
# Run as a sudo-capable user. Keep secrets in the local .env and auth archive;
# never commit either file.
APP_DIR="${APP_DIR:-/opt/WABOT-gGoupManagement}"
REPO_URL="${REPO_URL:-https://github.com/arx64/WABOT-gGoupManagement.git}"
APP_USER="${APP_USER:-${SUDO_USER:-$USER}}"
PORT="${PORT:-2004}"

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo apt-get install -y cloudflared

sudo mkdir -p "$APP_DIR"
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" reset --hard origin/main
else
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
npm ci

if [ ! -f .env ]; then
  echo "ERROR: restore .env before starting the bot: $APP_DIR/.env" >&2
  exit 1
fi
if [ ! -d auth_info_baileys ]; then
  echo "ERROR: restore auth_info_baileys/ before starting the bot." >&2
  exit 1
fi
chmod 600 .env
chmod 700 auth_info_baileys

sudo tee /etc/systemd/system/wabot.service >/dev/null <<EOF
[Unit]
Description=WhatsApp bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=append:$APP_DIR/bot.log
StandardError=append:$APP_DIR/bot.log

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable wabot
sudo systemctl restart wabot

# Install the token from Cloudflare Dashboard separately; do not put it in this file.
# sudo cloudflared service install <TOKEN_FROM_CLOUDFLARE_DASHBOARD>
# Then configure Public Hostname: arifin.ai.id -> http://127.0.0.1:$PORT

printf '\nBot setup complete. Check:\n'
sudo systemctl --no-pager status wabot
curl -fsS "http://127.0.0.1:$PORT/api/status" || true
