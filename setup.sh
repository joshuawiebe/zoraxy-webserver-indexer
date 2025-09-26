#!/usr/bin/env bash
set -euo pipefail

# -------------------------------------------------------
# Zoraxy Webserver Indexer - installer
# - Asks for webroot, admin dir, port, interval
# - Optionally auto-generates admin password (openssl)
# - Copies files to admin dir, writes .env
# - Installs npm libs (as the calling user)
# - Writes systemd units with absolute paths (and enables them)
# - Fixes ownership/perms so you don't need sudo later
# -------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
  echo "This script requires sudo. Re-run with: sudo ./setup.sh"
  exit 1
fi

if [[ -z "${SUDO_USER:-}" ]]; then
  echo "Please run this script with sudo from your user account (so installer knows which user to set ownership to)."
  exit 1
fi
TARGET_USER="$SUDO_USER"

echo
echo "Zoraxy Webserver Indexer - Installer"
echo "Installer will run as sudo but assign files to user: $TARGET_USER"
echo

# Defaults
DEFAULT_WEBROOT="/home/${TARGET_USER}/zoraxy/config/www/html"
DEFAULT_ADMIN_DIR="$(dirname "$DEFAULT_WEBROOT")"
DEFAULT_PORT=3000
DEFAULT_INTERVAL=10

read -rp "Path to Zoraxy web root (served by Zoraxy) [${DEFAULT_WEBROOT}]: " WEBROOT
WEBROOT=${WEBROOT:-$DEFAULT_WEBROOT}

read -rp "Admin install dir (where admin-server.js & generate-index.js will live) [${DEFAULT_ADMIN_DIR}]: " ADMIN_DIR
ADMIN_DIR=${ADMIN_DIR:-$DEFAULT_ADMIN_DIR}

read -rp "Local admin backend port (127.0.0.1:PORT) [${DEFAULT_PORT}]: " ADMIN_PORT
ADMIN_PORT=${ADMIN_PORT:-$DEFAULT_PORT}

read -rp "Index generator interval in seconds (systemd timer) [${DEFAULT_INTERVAL}]: " GEN_INTERVAL
GEN_INTERVAL=${GEN_INTERVAL:-$DEFAULT_INTERVAL}

echo
read -rp "Auto-generate a strong admin password with openssl? (y/N): " GENPASS
if [[ "$GENPASS" =~ ^[Yy]$ ]]; then
  ADMIN_PASSWORD=$(openssl rand -base64 32)
  echo "Generated admin password: $ADMIN_PASSWORD"
else
  read -rp "Enter admin password (will be stored in ${ADMIN_DIR}/.env): " ADMIN_PASSWORD
fi

echo
echo "SUMMARY:"
echo " WEBROOT:   $WEBROOT"
echo " ADMIN_DIR: $ADMIN_DIR"
echo " ADMIN_PORT:$ADMIN_PORT"
echo " GEN_INT(s):$GEN_INTERVAL"
echo

read -rp "Proceed (y/N)? " PROCEED
if [[ ! "$PROCEED" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# check node
NODE_BIN=$(command -v node || true)
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js not found. Install Node.js (apt, nvm) before running this script."
  exit 1
fi
echo "Node found at: $NODE_BIN"

# repo root (script directory)
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "Repo dir: $REPO_DIR"

# ensure directories exist
mkdir -p "$WEBROOT"
mkdir -p "$ADMIN_DIR"

# copy files into ADMIN_DIR (overwrite)
echo "Copying admin files to: $ADMIN_DIR"
cp -a "$REPO_DIR"/admin-server.js "$ADMIN_DIR"/admin-server.js
cp -a "$REPO_DIR"/generate-index.js "$ADMIN_DIR"/generate-index.js
cp -a "$REPO_DIR"/admin.html "$ADMIN_DIR"/admin.html

# write .env into ADMIN_DIR
ENVFILE="$ADMIN_DIR/.env"
cat > "$ENVFILE" <<EOF
# Zoraxy WebManager .env (auto-generated)
ADMIN_PORT=${ADMIN_PORT}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ZORAXY_DIR=${WEBROOT}
FRONTEND_ADMIN_URL=/admin
GEN_INTERVAL=${GEN_INTERVAL}
EOF

# set ownership and perms (so TARGET_USER can edit without sudo)
echo "Setting ownership and permissions..."
chown -R "$TARGET_USER":"$TARGET_USER" "$ADMIN_DIR"
chown -R "$TARGET_USER":"$TARGET_USER" "$WEBROOT"
chmod -R u+rwX,g+rX,o-rwx "$ADMIN_DIR"
chmod -R u+rwX,g+rX,o-rwx "$WEBROOT"
chmod 600 "$ENVFILE"

# install npm deps as TARGET_USER in ADMIN_DIR
echo "Installing npm packages in $ADMIN_DIR (as $TARGET_USER)..."
if [[ ! -f "$ADMIN_DIR/package.json" ]]; then
  sudo -u "$TARGET_USER" bash -c "cd '$ADMIN_DIR' && npm init -y >/dev/null 2>&1"
fi

sudo -u "$TARGET_USER" bash -c "cd '$ADMIN_DIR' && npm install express multer unzipper simple-git dotenv fs-extra >/dev/null 2>&1"
echo "npm packages installed."

# Write systemd units with absolute paths
NODE_BIN_ESCAPED="$NODE_BIN"

WEBADMIN_UNIT="/etc/systemd/system/zoraxy-webadmin.service"
GEN_UNIT="/etc/systemd/system/zoraxy-generate-index.service"
GEN_TIMER="/etc/systemd/system/zoraxy-generate-index.timer"

echo "Writing systemd unit: $WEBADMIN_UNIT"
cat > "$WEBADMIN_UNIT" <<EOF
[Unit]
Description=Zoraxy WebManager Backend (admin-server)
After=network.target

[Service]
Type=simple
User=${TARGET_USER}
WorkingDirectory=${ADMIN_DIR}
EnvironmentFile=${ENVFILE}
ExecStart=${NODE_BIN_ESCAPED} ${ADMIN_DIR}/admin-server.js
Restart=always
RestartSec=3
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
EOF

echo "Writing systemd unit: $GEN_UNIT"
cat > "$GEN_UNIT" <<EOF
[Unit]
Description=Zoraxy Index Generator (single-run)
After=network.target

[Service]
Type=oneshot
User=${TARGET_USER}
WorkingDirectory=${ADMIN_DIR}
EnvironmentFile=${ENVFILE}
ExecStart=${NODE_BIN_ESCAPED} ${ADMIN_DIR}/generate-index.js
EOF

echo "Writing systemd timer: $GEN_TIMER"
cat > "$GEN_TIMER" <<EOF
[Unit]
Description=Run Zoraxy index generator every ${GEN_INTERVAL} seconds

[Timer]
OnBootSec=5s
OnUnitActiveSec=${GEN_INTERVAL}s
AccuracySec=1s
Unit=zoraxy-generate-index.service

[Install]
WantedBy=timers.target
EOF

# reload systemd & enable/start
systemctl daemon-reload
systemctl enable --now zoraxy-webadmin.service
systemctl enable --now zoraxy-generate-index.timer

echo
echo "INSTALL COMPLETE ✅"
echo "Backend service: sudo systemctl status zoraxy-webadmin.service"
echo "Generator timer: sudo systemctl status zoraxy-generate-index.timer"
echo
echo "IMPORTANT:"
echo "- Configure Zoraxy (or your reverse proxy) to forward /admin/ to http://127.0.0.1:${ADMIN_PORT}/admin/"
echo "- Admin password stored in: ${ENVFILE}"
echo
echo "Quick test (run on server):"
echo "curl -v -X POST -H 'Content-Type: application/json' -d '{\"password\":\"${ADMIN_PASSWORD}\"}' http://127.0.0.1:${ADMIN_PORT}/admin/login"
echo
echo "✅ Services installed and started."