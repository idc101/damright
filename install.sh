#!/bin/bash

# DamRight Installation Script for macOS
# This script builds the application in release mode and copies it to /Applications.

# Exit on error
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting DamRight installation process...${NC}"

# Check for required tools
command -v npm >/dev/null 2>&1 || { echo -e "${RED}Error: npm is required but not installed. Aborting.${NC}" >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo -e "${RED}Error: Rust/Cargo is required but not installed. Aborting.${NC}" >&2; exit 1; }

# Step 1: Backup SQLite database if it exists
echo -e "${BLUE}Step 1: Checking for existing SQLite database to back up...${NC}"
APP_DATA_DIR="${DAMRIGHT_DATA_DIR:-$HOME/Library/Application Support/com.damright.app}"
DB_PATH="$APP_DATA_DIR/damright.db"
BACKUP_DIR="$APP_DATA_DIR/backups"

if [ -f "$DB_PATH" ]; then
    mkdir -p "$BACKUP_DIR"
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    BACKUP_FILE="$BACKUP_DIR/damright_${TIMESTAMP}.db"

    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
    else
        cp "$DB_PATH" "$BACKUP_FILE"
    fi
    echo -e "${GREEN}Database backed up to: $BACKUP_FILE${NC}"

    # Keep only the 3 most recent backups
    OLD_BACKUPS=$(ls -1t "$BACKUP_DIR"/damright_*.db 2>/dev/null | tail -n +4 || true)
    if [ -n "$OLD_BACKUPS" ]; then
        echo -e "${BLUE}Pruning old backups (keeping latest 3)...${NC}"
        echo "$OLD_BACKUPS" | while IFS= read -r old_file; do
            if [ -n "$old_file" ] && [ -f "$old_file" ]; then
                rm -f "$old_file"
                echo -e "${BLUE}Removed old backup: $(basename "$old_file")${NC}"
            fi
        done
    fi
else
    echo -e "${BLUE}No existing database found at $DB_PATH. Skipping backup.${NC}"
fi

# Step 2: Build the application and CLI
echo -e "${BLUE}Step 2: Building DamRight and CLI in release mode...${NC}"
npm run tauri build
cargo build --release --manifest-path src-tauri/Cargo.toml --bin damright-cli

# Step 3: Identify the app bundle
# We use the productName from tauri.conf.json, which is "DamRight"
APP_NAME="DamRight"
SOURCE_PATH="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
DEST_PATH="/Applications/${APP_NAME}.app"

# Fallback check if the bundle name is different (e.g. if productName was changed)
if [ ! -d "$SOURCE_PATH" ]; then
    echo -e "${BLUE}Checking for alternative bundle names...${NC}"
    # Look for any .app in the bundle directory
    ALT_PATH=$(find src-tauri/target/release/bundle/macos -name "*.app" -maxdepth 1 | head -n 1)
    if [ -n "$ALT_PATH" ]; then
        SOURCE_PATH="$ALT_PATH"
        APP_NAME=$(basename "$SOURCE_PATH" .app)
        DEST_PATH="/Applications/${APP_NAME}.app"
        echo -e "${BLUE}Found bundle at: $SOURCE_PATH${NC}"
    else
        echo -e "${RED}Error: Build succeeded but could not find the app bundle in src-tauri/target/release/bundle/macos/${NC}"
        exit 1
    fi
fi

# Step 3: Install to /Applications
echo -e "${BLUE}Step 3: Installing $APP_NAME to $DEST_PATH...${NC}"

# Remove existing installation if it exists
if [ -d "$DEST_PATH" ]; then
    echo -e "${BLUE}Removing existing installation...${NC}"
    if [ -w "$DEST_PATH" ]; then
        rm -rf "$DEST_PATH"
    else
        echo -e "${BLUE}Requesting sudo to remove existing $DEST_PATH...${NC}"
        sudo rm -rf "$DEST_PATH"
    fi
fi

# Copy the new bundle
if [ -w "/Applications" ]; then
    cp -R "$SOURCE_PATH" "$DEST_PATH"
else
    echo -e "${BLUE}Requesting sudo to copy to /Applications...${NC}"
    sudo cp -R "$SOURCE_PATH" "$DEST_PATH"
fi

# Step 4: Install CLI on PATH
echo -e "${BLUE}Step 4: Installing damright-cli on PATH...${NC}"
CLI_NAME="damright-cli"
CLI_SOURCE_PATH="src-tauri/target/release/${CLI_NAME}"

if [ ! -f "$CLI_SOURCE_PATH" ]; then
    echo -e "${RED}Error: Could not find built CLI binary at $CLI_SOURCE_PATH${NC}"
    exit 1
fi

# Prefer /usr/local/bin, fallback to ~/.local/bin if needed
CLI_DEST_DIR="/usr/local/bin"
if [ ! -d "$CLI_DEST_DIR" ] || [ ! -w "$CLI_DEST_DIR" ]; then
    if [ -d "$HOME/.local/bin" ]; then
        CLI_DEST_DIR="$HOME/.local/bin"
    fi
fi
mkdir -p "$CLI_DEST_DIR"
CLI_DEST_PATH="${CLI_DEST_DIR}/${CLI_NAME}"

if [ -w "$CLI_DEST_DIR" ]; then
    cp "$CLI_SOURCE_PATH" "$CLI_DEST_PATH"
    chmod +x "$CLI_DEST_PATH"
else
    echo -e "${BLUE}Requesting sudo to install CLI to $CLI_DEST_DIR...${NC}"
    sudo cp "$CLI_SOURCE_PATH" "$CLI_DEST_PATH"
    sudo chmod +x "$CLI_DEST_PATH"
fi

echo -e "${GREEN}Success! $APP_NAME has been installed to /Applications.${NC}"
echo -e "${GREEN}Success! $CLI_NAME has been installed to $CLI_DEST_PATH.${NC}"
echo -e "${GREEN}You can launch the desktop app from Applications, and use '$CLI_NAME --help' from the terminal.${NC}"
