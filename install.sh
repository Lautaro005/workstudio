#!/bin/sh
# AI WorkStudio installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Lautaro005/workstudio/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/Lautaro005/workstudio/main/install.sh | sh -s -- --all
#
# Options
#   --all                 also install brain, Lumina and OpenCue
#   --with brain,lumina   also install only those apps
#   --user                macOS: install into ~/Applications instead of /Applications
#   --build               build from source instead of downloading a release (needs git, node, cargo)
#   --uninstall           remove WorkStudio (your data in ~/.workstudio stays)
#
# What it does
#   macOS  /Applications/AI WorkStudio.app (or ~/Applications) + `workstudio` command
#   Linux  ~/.local/opt/workstudio/AI-WorkStudio.AppImage + app menu entry + `workstudio` command
set -eu

REPO="${WORKSTUDIO_REPO:-Lautaro005/workstudio}"
BRANCH="${WORKSTUDIO_BRANCH:-main}"
BIN_DIR="${WORKSTUDIO_BIN_DIR:-$HOME/.local/bin}"
APP_NAME="AI WorkStudio"
OS="$(uname -s)"
ARCH="$(uname -m)"
WITH=""
USER_ONLY=0
BUILD=0
UNINSTALL=0

c_clay='\033[38;2;194;65;12m'; c_olive='\033[38;2;63;98;18m'; c_dim='\033[2m'; c_off='\033[0m'
say()  { printf "${c_clay}▸${c_off} %s\n" "$1"; }
ok()   { printf "${c_olive}✓${c_off} %s\n" "$1"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --all) WITH="brain,lumina,opencue" ;;
    --with) shift; WITH="${1:-}" ;;
    --with=*) WITH="${1#--with=}" ;;
    --user) USER_ONLY=1 ;;
    --build) BUILD=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,20p' "$0" 2>/dev/null || true; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
  shift
done

case "$OS" in
  Darwin)
    if [ "$USER_ONLY" = 0 ] && [ -w /Applications ]; then APP_DIR="/Applications"; else APP_DIR="$HOME/Applications"; fi
    APP="$APP_DIR/$APP_NAME.app"
    ;;
  Linux)
    APP_DIR="$HOME/.local/opt/workstudio"
    APP="$APP_DIR/AI-WorkStudio.AppImage"
    DESKTOP_FILE="$HOME/.local/share/applications/workstudio.desktop"
    ICON="$HOME/.local/share/icons/hicolor/512x512/apps/workstudio.png"
    ;;
  *) fail "this script supports macOS and Linux. On Windows run: irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex" ;;
esac

if [ "$UNINSTALL" = 1 ]; then
  say "Removing $APP_NAME"
  rm -rf "/Applications/$APP_NAME.app" "$HOME/Applications/$APP_NAME.app" 2>/dev/null || true
  rm -f "$BIN_DIR/workstudio"
  [ "$OS" = "Linux" ] && rm -rf "$APP_DIR" "$DESKTOP_FILE" "$ICON"
  ok "Done. Your settings and MCP config stay in ~/.workstudio (delete it to start fresh)."
  exit 0
fi

printf "\n  ${c_clay}■${c_off}${c_olive}■${c_off}  AI WorkStudio ${c_dim}— one workspace for your local AI apps${c_off}\n\n"
need curl
need tar

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

install_bundle_mac() { # $1 = folder that contains "AI WorkStudio.app"
  [ -d "$1/$APP_NAME.app" ] || fail "unexpected archive contents"
  mkdir -p "$APP_DIR"
  # Quit a running copy so the bundle can be replaced.
  pkill -x workstudio 2>/dev/null && sleep 1 || true
  rm -rf "$APP"
  mv "$1/$APP_NAME.app" "$APP"
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
}

if [ "$BUILD" = 1 ]; then
  need git; need node; need npm; need cargo
  say "Building from source ($REPO@$BRANCH) — this takes a few minutes"
  git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$TMP/src" >/dev/null 2>&1 || fail "could not clone $REPO"
  (cd "$TMP/src/apps/desktop" && npm ci --silent) || fail "npm ci failed"
  if [ "$OS" = "Darwin" ]; then
    (cd "$TMP/src/apps/desktop" && npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}') || fail "build failed"
    install_bundle_mac "$TMP/src/apps/desktop/src-tauri/target/release/bundle/macos"
  else
    (cd "$TMP/src/apps/desktop" && npx tauri build --bundles appimage --config '{"bundle":{"createUpdaterArtifacts":false}}') || fail "build failed"
    mkdir -p "$APP_DIR"
    cp "$(ls "$TMP"/src/apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage | head -n1)" "$APP"
    chmod +x "$APP"
  fi
  TAG="source ($BRANCH)"
else
  say "Looking up the latest release"
  JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest")" \
    || fail "no release found for $REPO yet. Build it instead: add --build"
  TAG="$(printf '%s' "$JSON" | grep -o '"tag_name": *"[^"]*"' | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')"
  URLS="$(printf '%s' "$JSON" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"$/\1/')"
  if [ "$OS" = "Darwin" ]; then
    URL="$(printf '%s\n' "$URLS" | grep '\.app\.tar\.gz$' | grep -iv '\.sig$' | head -n1)"
  else
    case "$ARCH" in x86_64|amd64) ;; *) fail "no Linux build for $ARCH yet; use --build" ;; esac
    URL="$(printf '%s\n' "$URLS" | grep -i 'amd64\.AppImage$' | head -n1)"
  fi
  [ -n "$URL" ] || fail "release $TAG has no download for $OS yet; use --build"
  say "Downloading $APP_NAME $TAG"
  curl -fL --progress-bar "$URL" -o "$TMP/download" || fail "download failed"
  if [ "$OS" = "Darwin" ]; then
    mkdir -p "$TMP/x"
    tar -xzf "$TMP/download" -C "$TMP/x"
    install_bundle_mac "$TMP/x"
  else
    mkdir -p "$APP_DIR"
    mv "$TMP/download" "$APP"
    chmod +x "$APP"
  fi
fi

mkdir -p "$BIN_DIR"
if [ "$OS" = "Darwin" ]; then
  cat > "$BIN_DIR/workstudio" <<WRAP
#!/bin/sh
# Installed by the AI WorkStudio installer (github.com/$REPO)
case "\${1:-}" in
  update) exec sh -c "curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | sh" ;;
  uninstall) exec sh -c "curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | sh -s -- --uninstall" ;;
  "") exec open "$APP" ;;
  *) exec "$APP/Contents/MacOS/workstudio" "\$@" ;;
esac
WRAP
else
  cat > "$BIN_DIR/workstudio" <<WRAP
#!/bin/sh
# Installed by the AI WorkStudio installer (github.com/$REPO)
APP="$APP"
if ! { [ -e /dev/fuse ] && { ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; }; }; then
  export APPIMAGE_EXTRACT_AND_RUN=1
fi
case "\${1:-}" in
  update) exec sh -c "curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | sh" ;;
  uninstall) exec sh -c "curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | sh -s -- --uninstall" ;;
  "") nohup "\$APP" >/dev/null 2>&1 & exit 0 ;;
  *) exec "\$APP" "\$@" ;;
esac
WRAP
  mkdir -p "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON")"
  curl -fsSL "https://raw.githubusercontent.com/$REPO/main/apps/desktop/src-tauri/icons/icon.png" -o "$ICON" 2>/dev/null || true
  cat > "$DESKTOP_FILE" <<ENTRY
[Desktop Entry]
Type=Application
Name=AI WorkStudio
Comment=One workspace for brain, OpenCue, Lumina and your local AI apps
Exec=$BIN_DIR/workstudio
Icon=workstudio
Categories=Development;Utility;
Terminal=false
StartupWMClass=AI WorkStudio
ENTRY
fi
chmod +x "$BIN_DIR/workstudio"
ok "Installed $APP_NAME $TAG → $APP"

# The family: each app keeps its own installer, WorkStudio just runs it.
if [ -n "$WITH" ]; then
  for app in $(printf '%s' "$WITH" | tr ',' ' '); do
    case "$app" in
      brain)   cmd="curl -fsSL https://raw.githubusercontent.com/Lautaro005/brain/main/install.sh | bash" ;;
      lumina)  cmd="curl -fsSL https://lautaro005.github.io/lumina/install.sh | sh" ;;
      opencue) cmd="curl -fsSL https://lautaro005.github.io/opencue/install.sh | sh" ;;
      *) say "skipping unknown app: $app"; continue ;;
    esac
    say "Installing $app"
    sh -c "$cmd" || say "$app did not finish installing; retry from WorkStudio → Apps"
  done
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ok "Open it from your apps or run: workstudio" ;;
  *)
    say "Add $BIN_DIR to your PATH to use the workstudio command:"
    printf '    echo '\''export PATH="%s:$PATH"'\'' >> ~/.%src && exec $SHELL\n' "$BIN_DIR" "$(basename "${SHELL:-sh}")"
    ;;
esac
if [ "$OS" = "Darwin" ] && [ -z "${WORKSTUDIO_NO_OPEN:-}" ]; then open "$APP" 2>/dev/null || true; fi
