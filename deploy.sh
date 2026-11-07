#!/usr/bin/env bash
set -e

# ==========================================
# DamRight Server Deployment Script
# Configure via environment variables or .env.deploy:
#   DAMRIGHT_REMOTE_HOST (e.g., user@your-server-ip)
#   DAMRIGHT_REMOTE_DIR  (default: ~/damright)
#   DAMRIGHT_SERVER_PORT (default: 8010)
#   PM2_APP_NAME         (default: damright-server)
# ==========================================

if [ -f ".env.deploy" ]; then
  # shellcheck disable=SC1091
  source ".env.deploy"
fi

REMOTE_HOST="${DAMRIGHT_REMOTE_HOST:-}"
REMOTE_DIR="${DAMRIGHT_REMOTE_DIR:-~/damright}"
SERVER_PORT="${DAMRIGHT_SERVER_PORT:-8010}"
PM2_APP_NAME="${PM2_APP_NAME:-damright-server}"

if [ -z "$REMOTE_HOST" ]; then
  echo "Error: DAMRIGHT_REMOTE_HOST is not set (e.g. export DAMRIGHT_REMOTE_HOST=user@192.168.1.100 or set in .env.deploy)." >&2
  exit 1
fi
REMOTE_HOSTNAME="${REMOTE_HOST#*@}"

# ANSI Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== DamRight Server Deployment ===${NC}"

# Parse flags
FORCE=false
if [ "$1" == "-y" ] || [ "$1" == "--yes" ]; then
  FORCE=true
fi

# 1. Check for uncommitted modified tracked files locally
if [ "$FORCE" = false ] && [ -n "$(git status --porcelain -uno)" ]; then
  echo -e "${YELLOW}Warning: You have uncommitted changes in tracked files.${NC}"
  read -p "Do you want to continue anyway? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Deployment cancelled.${NC}"
    exit 1
  fi
fi

# 2. Push local commits to origin main
echo -e "${BLUE}--> Pushing latest commits to origin main...${NC}"
git push origin main

# 3. Execute remote build and deploy via SSH
echo -e "${BLUE}--> Connecting to ${REMOTE_HOST} to update & build server...${NC}"

ssh "${REMOTE_HOST}" "bash -s" << 'EOF'
set -e

# Ensure Node/PM2, Rust/Cargo, and system binaries are in PATH
export PATH=$PATH:$HOME/.nvm/versions/node/v24.18.1/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$HOME/.cargo/bin:/usr/local/bin:$HOME/.local/bin

echo "--> Pulling latest code..."
cd ~/damright
git fetch origin main
git checkout main
git reset --hard origin/main

echo "--> Building frontend web assets..."
npm run build

echo "--> Building Rust release server binary (damright-server)..."
cd src-tauri
cargo build --release --bin damright-server

echo "--> Managing PM2 service..."
if pm2 describe damright-server > /dev/null 2>&1; then
  echo "Restarting existing pm2 service damright-server..."
  pm2 restart damright-server
else
  echo "Starting new pm2 service damright-server..."
  pm2 start "$HOME/damright/src-tauri/target/release/damright-server" --name damright-server --cwd "$HOME/damright"
fi

pm2 save
echo "--> PM2 process status:"
pm2 status damright-server
EOF

# 4. Verify deployment
SERVER_URL="http://${REMOTE_HOSTNAME}:${SERVER_PORT}"
echo -e "${BLUE}--> Verifying server health at ${SERVER_URL}/api/sources...${NC}"
if curl -s --max-time 5 "${SERVER_URL}/api/sources" > /dev/null; then
  echo -e "${GREEN}✓ Deployment successful! Server is online and responding at ${SERVER_URL}${NC}"
else
  echo -e "${YELLOW}Warning: Server deployed, but health check ping did not respond on ${SERVER_URL}${NC}"
fi
