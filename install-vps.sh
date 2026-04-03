#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# OpenClaw Shell — VPS Install Script
#
# Installs Docker + Caddy on a bare Linux box, then runs the OpenClaw Shell
# container with automatic HTTPS via Caddy reverse proxy.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/akorenevski/openclaw-shell/main/install-vps.sh | bash
#   curl ... | bash -s -- --domain app.example.com --yes
#   curl ... | bash -s -- --domain app.example.com --data-dir /mnt/volume/openclaw --yes
#
# Requirements:
#   - Ubuntu 22.04+ or Debian 12+ (other distros: install Docker + Caddy manually)
#   - Root access
#   - Port 80, 443, and 22 open
# ============================================================================

REPO_URL="https://github.com/akorenevski/openclaw-shell.git"
INSTALL_DIR="/opt/openclaw-shell"
DEFAULT_DATA_DIR="/data/openclaw"
CONTAINER_NAME="openclaw-shell"
INTERNAL_PORT=8080

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PROGRESS_FILE="/tmp/openclaw-install-progress"
TOTAL_STAGES=8

log()  { echo -e "${GREEN}[openclaw]${NC} $*"; }
warn() { echo -e "${YELLOW}[openclaw]${NC} $*"; }
err()  { echo -e "${RED}[openclaw]${NC} $*" >&2; }

# Progress tracking — writes a machine-readable status file that can be polled
# Format: STAGE/TOTAL STATUS message
progress() {
    local stage="$1"
    local status="$2"
    local message="$3"
    echo "${stage}/${TOTAL_STAGES} ${status} ${message}" > "$PROGRESS_FILE"
    log "[${stage}/${TOTAL_STAGES}] ${message}"
}

# ============================================================================
# Parse arguments
# ============================================================================

DOMAIN=""
DATA_DIR=""
BRANCH="main"
SKIP_DOCKER=false
SKIP_CADDY=false
AUTO_YES=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)      DOMAIN="$2"; shift 2 ;;
        --data-dir)    DATA_DIR="$2"; shift 2 ;;
        --branch)      BRANCH="$2"; shift 2 ;;
        --skip-docker) SKIP_DOCKER=true; shift ;;
        --skip-caddy)  SKIP_CADDY=true; shift ;;
        --yes|-y)      AUTO_YES=true; shift ;;
        --help|-h)
            echo "Usage: install-vps.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --domain DOMAIN    Domain for HTTPS (e.g., app.example.com)"
            echo "  --data-dir PATH    Data directory (default: $DEFAULT_DATA_DIR)"
            echo "  --branch BRANCH    Git branch to deploy (default: main)"
            echo "  --skip-docker      Skip Docker installation (already installed)"
            echo "  --skip-caddy       Skip Caddy installation (already installed)"
            echo "  --yes, -y          Skip confirmation prompt (for non-interactive use)"
            echo "  -h, --help         Show this help"
            exit 0
            ;;
        *) err "Unknown option: $1"; exit 1 ;;
    esac
done

# ============================================================================
# Pre-flight checks
# ============================================================================

if [[ $EUID -ne 0 ]]; then
    err "This script must be run as root."
    exit 1
fi

# Detect OS
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-0}"
else
    err "Cannot detect OS. This script supports Ubuntu 22.04+ and Debian 12+."
    exit 1
fi

case "$OS_ID" in
    ubuntu|debian) ;;
    *)
        warn "Detected $OS_ID — this script is tested on Ubuntu/Debian."
        warn "Proceeding anyway, but Docker/Caddy install may fail."
        ;;
esac

# ============================================================================
# Interactive domain prompt (if not provided via flag)
# ============================================================================

if [[ -z "$DOMAIN" ]]; then
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║           OpenClaw Shell — VPS Installation             ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "A domain is needed for HTTPS access to your OpenClaw instance."
    echo "Point your domain's DNS A record to this server's IP first."
    echo ""

    # Detect public IP for convenience
    PUBLIC_IP=$(curl -sf https://ifconfig.me || curl -sf https://api.ipify.org || echo "unknown")
    if [[ "$PUBLIC_IP" != "unknown" ]]; then
        echo -e "This server's public IP: ${CYAN}${PUBLIC_IP}${NC}"
        echo ""
    fi

    echo "Options:"
    echo "  1. Enter your domain (e.g., openclaw.example.com)"
    echo "  2. Use IP-based domain via nip.io (${PUBLIC_IP}.nip.io) — no DNS setup needed"
    echo "  3. Skip HTTPS — access via http://<ip>:${INTERNAL_PORT} (not recommended)"
    echo ""

    while true; do
        read -rp "Enter domain (or 'nip' for nip.io, or 'skip' for no HTTPS): " domain_input

        case "$domain_input" in
            skip|SKIP)
                DOMAIN=""
                SKIP_CADDY=true
                warn "Skipping HTTPS. OpenClaw will be accessible at http://${PUBLIC_IP}:${INTERNAL_PORT}"
                break
                ;;
            nip|NIP)
                if [[ "$PUBLIC_IP" == "unknown" ]]; then
                    err "Could not detect public IP. Enter a domain manually."
                    continue
                fi
                DOMAIN="${PUBLIC_IP}.nip.io"
                log "Using nip.io domain: ${DOMAIN}"
                break
                ;;
            "")
                warn "Please enter a domain, 'nip', or 'skip'."
                ;;
            *)
                DOMAIN="$domain_input"
                log "Using domain: ${DOMAIN}"
                break
                ;;
        esac
    done
    echo ""
fi

DATA_DIR="${DATA_DIR:-$DEFAULT_DATA_DIR}"

# ============================================================================
# Summary and confirmation
# ============================================================================

echo -e "${CYAN}Installation plan:${NC}"
echo "  Install directory:  ${INSTALL_DIR}"
echo "  Data directory:     ${DATA_DIR}"
echo "  Docker:             $(${SKIP_DOCKER} && echo 'skip (already installed)' || echo 'install')"
echo "  Caddy:              $(${SKIP_CADDY} && echo 'skip' || echo "install (domain: ${DOMAIN})")"
echo "  Branch:             ${BRANCH}"
echo ""

if $AUTO_YES; then
    log "Proceeding (--yes flag set)."
else
    read -rp "Proceed? [Y/n] " confirm
    case "${confirm:-Y}" in
        [yY]|[yY][eE][sS]|"") ;;
        *) log "Aborted."; exit 0 ;;
    esac
fi

echo ""

# ============================================================================
# Install Docker
# ============================================================================

install_docker() {
    if command -v docker &>/dev/null; then
        log "Docker already installed: $(docker --version)"
        return
    fi

    log "Installing Docker..."

    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg lsb-release >/dev/null

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null

    systemctl enable --now docker
    log "Docker installed: $(docker --version)"
}

# ============================================================================
# Install Caddy
# ============================================================================

install_caddy() {
    if command -v caddy &>/dev/null; then
        log "Caddy already installed: $(caddy version)"
        return
    fi

    log "Installing Caddy..."

    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list

    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null

    log "Caddy installed: $(caddy version)"
}

# ============================================================================
# Configure Caddy
# ============================================================================

configure_caddy() {
    if [[ -z "$DOMAIN" ]]; then
        return
    fi

    log "Configuring Caddy for ${DOMAIN}..."

    cat > /etc/caddy/Caddyfile <<CADDYEOF
${DOMAIN} {
    reverse_proxy localhost:${INTERNAL_PORT}

    # WebSocket support
    @websockets {
        header Connection *Upgrade*
        header Upgrade websocket
    }
    reverse_proxy @websockets localhost:${INTERNAL_PORT}

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
        Referrer-Policy strict-origin-when-cross-origin
    }

    # Logging
    log {
        output file /var/log/caddy/openclaw-access.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}
CADDYEOF

    mkdir -p /var/log/caddy

    systemctl enable caddy
    systemctl restart caddy

    log "Caddy configured and running."
}

# ============================================================================
# Configure swap (ensures builds don't OOM on small servers)
# ============================================================================

configure_swap() {
    local SWAP_SIZE_MB=4096  # 4GB — covers Docker image build on 1-2GB servers
    local SWAP_FILE="/swapfile"

    # Skip if enough swap already exists (>= 2GB)
    local current_swap_mb
    current_swap_mb=$(free -m | awk '/^Swap:/ {print $2}')
    if [[ "$current_swap_mb" -ge 2048 ]]; then
        log "Swap already configured (${current_swap_mb}MB). Skipping."
        return
    fi

    # Skip if swap file already exists (from a previous run)
    if [[ -f "$SWAP_FILE" ]]; then
        log "Swap file already exists. Ensuring it's active..."
        swapon "$SWAP_FILE" 2>/dev/null || true
        return
    fi

    log "Configuring ${SWAP_SIZE_MB}MB swap (prevents OOM during Docker build)..."

    # Create swap file
    dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE" >/dev/null
    swapon "$SWAP_FILE"

    # Persist across reboots
    if ! grep -q "$SWAP_FILE" /etc/fstab; then
        echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
    fi

    # Tune swappiness — prefer RAM but use swap when needed
    sysctl -q vm.swappiness=10
    if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
        echo "vm.swappiness=10" >> /etc/sysctl.conf
    fi

    log "Swap configured: ${SWAP_SIZE_MB}MB"
}

# ============================================================================
# Configure firewall
# ============================================================================

configure_firewall() {
    if ! command -v ufw &>/dev/null; then
        apt-get install -y -qq ufw >/dev/null
    fi

    log "Configuring firewall (ufw)..."

    ufw --force reset >/dev/null 2>&1
    ufw default deny incoming >/dev/null
    ufw default allow outgoing >/dev/null
    ufw allow 22/tcp >/dev/null    # SSH
    ufw allow 80/tcp >/dev/null    # HTTP (Caddy redirect)
    ufw allow 443/tcp >/dev/null   # HTTPS (Caddy)

    if $SKIP_CADDY; then
        ufw allow ${INTERNAL_PORT}/tcp >/dev/null  # Direct access when no Caddy
    fi

    ufw --force enable >/dev/null
    log "Firewall configured (SSH, HTTP, HTTPS)."
}

# ============================================================================
# Clone / update repo
# ============================================================================

setup_repo() {
    if [[ -d "${INSTALL_DIR}/.git" ]]; then
        log "Updating existing installation..."
        cd "$INSTALL_DIR"
        git fetch origin
        git checkout "$BRANCH"
        git reset --hard "origin/${BRANCH}"
    else
        log "Cloning openclaw-shell..."
        git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi

    log "Repository ready at ${INSTALL_DIR}"
}

# ============================================================================
# Create docker-compose for VPS deployment
# ============================================================================

setup_compose() {
    log "Setting up Docker Compose configuration..."

    mkdir -p "$DATA_DIR"

    # Determine port binding based on whether Caddy is fronting
    if $SKIP_CADDY; then
        PORT_BINDING="0.0.0.0:${INTERNAL_PORT}:8080"
    else
        PORT_BINDING="127.0.0.1:${INTERNAL_PORT}:8080"
    fi

    cat > "${INSTALL_DIR}/docker-compose.vps.yml" <<COMPOSEEOF
services:
  openclaw:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ${CONTAINER_NAME}
    ports:
      - "${PORT_BINDING}"
    volumes:
      - ${DATA_DIR}:/data
    environment:
      PORT: 8080
      NODE_ENV: production
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 1
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/chromium
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
COMPOSEEOF

    log "Compose file created at ${INSTALL_DIR}/docker-compose.vps.yml"
}

# ============================================================================
# Build and start the container
# ============================================================================

start_container() {
    log "Building Docker image (this is the longest step)..."
    cd "$INSTALL_DIR"
    docker compose -f docker-compose.vps.yml build 2>&1 | while IFS= read -r line; do
        # Surface key Docker build milestones to the progress file
        case "$line" in
            *"COPY"*|*"RUN"*|*"Step"*|*"pnpm install"*|*"pnpm build"*|*"apt-get"*)
                echo "6/${TOTAL_STAGES} RUNNING Building: ${line:0:80}" > "$PROGRESS_FILE"
                ;;
        esac
        echo "$line"
    done

    log "Starting container..."
    docker compose -f docker-compose.vps.yml up -d

    log "Waiting for health check..."
    echo "6/${TOTAL_STAGES} RUNNING Waiting for container health check..." > "$PROGRESS_FILE"
    local attempts=0
    local max_attempts=60
    while [[ $attempts -lt $max_attempts ]]; do
        if docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null | grep -q "healthy"; then
            break
        fi
        sleep 5
        attempts=$((attempts + 1))
    done

    if [[ $attempts -ge $max_attempts ]]; then
        echo "6/${TOTAL_STAGES} FAILED Container not healthy after 5 minutes" > "$PROGRESS_FILE"
        warn "Container did not become healthy within 5 minutes."
        warn "Check logs: docker compose -f ${INSTALL_DIR}/docker-compose.vps.yml logs -f"
    else
        log "Container is healthy."
    fi
}

# ============================================================================
# Create management script
# ============================================================================

create_management_script() {
    cat > /usr/local/bin/openclaw <<'MGMTEOF'
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/openclaw-shell"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.vps.yml"
CONTAINER_NAME="openclaw-shell"

case "${1:-help}" in
    update)
        echo "Updating OpenClaw Shell..."
        cd "$INSTALL_DIR"
        git pull
        docker compose -f "$COMPOSE_FILE" up -d --build
        echo "Update complete."
        ;;
    restart)
        docker compose -f "$COMPOSE_FILE" restart
        ;;
    stop)
        docker compose -f "$COMPOSE_FILE" down
        ;;
    start)
        docker compose -f "$COMPOSE_FILE" up -d
        ;;
    logs)
        docker compose -f "$COMPOSE_FILE" logs -f "${@:2}"
        ;;
    shell)
        docker exec -it "$CONTAINER_NAME" bash
        ;;
    status)
        docker compose -f "$COMPOSE_FILE" ps
        echo ""
        docker inspect --format='Health: {{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || true
        ;;
    backup)
        BACKUP_FILE="/tmp/openclaw-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
        echo "Creating backup at ${BACKUP_FILE}..."
        tar czf "$BACKUP_FILE" -C "$(dirname "$(grep -oP 'volumes:\s*\n\s*-\s*\K[^:]+' "$COMPOSE_FILE" || echo /data/openclaw)")" .
        echo "Backup created: ${BACKUP_FILE}"
        ;;
    domain)
        if [[ -z "${2:-}" ]]; then
            echo "Usage: openclaw domain <new-domain>"
            exit 1
        fi
        NEW_DOMAIN="$2"
        echo "Updating domain to ${NEW_DOMAIN}..."
        caddy_file="/etc/caddy/Caddyfile"
        if [[ -f "$caddy_file" ]]; then
            sed -i "1s/^[^ ]*/$(echo "$NEW_DOMAIN" | sed 's/[&/\]/\\&/g')/" "$caddy_file"
            systemctl restart caddy
            echo "Domain updated to ${NEW_DOMAIN}. Caddy will provision a new certificate."
        else
            echo "Caddyfile not found at ${caddy_file}. Is Caddy installed?"
            exit 1
        fi
        ;;
    help|*)
        echo "OpenClaw Shell management commands:"
        echo ""
        echo "  openclaw update    Pull latest code and rebuild"
        echo "  openclaw start     Start the container"
        echo "  openclaw stop      Stop the container"
        echo "  openclaw restart   Restart the container"
        echo "  openclaw logs      Follow container logs"
        echo "  openclaw shell     Open a shell inside the container"
        echo "  openclaw status    Show container status"
        echo "  openclaw backup    Create a backup of the data directory"
        echo "  openclaw domain    Change the domain (updates Caddy)"
        echo ""
        ;;
esac
MGMTEOF

    chmod +x /usr/local/bin/openclaw
    log "Management script installed: 'openclaw' command available system-wide."
}

# ============================================================================
# Main
# ============================================================================

main() {
    echo ""
    log "Starting OpenClaw Shell VPS installation..."
    echo ""

    # Write initial progress file
    echo "0/${TOTAL_STAGES} RUNNING Starting installation" > "$PROGRESS_FILE"

    progress 1 RUNNING "Configuring swap..."
    configure_swap
    progress 1 DONE "Swap configured"

    progress 2 RUNNING "Installing Docker..."
    if ! $SKIP_DOCKER; then
        install_docker
    else
        log "Docker installation skipped."
    fi
    progress 2 DONE "Docker ready"

    progress 3 RUNNING "Installing Caddy..."
    if ! $SKIP_CADDY && [[ -n "$DOMAIN" ]]; then
        install_caddy
    else
        log "Caddy installation skipped."
    fi
    progress 3 DONE "Caddy ready"

    progress 4 RUNNING "Cloning repository..."
    # Git is needed for cloning the repo
    if ! command -v git &>/dev/null; then
        apt-get update -qq && apt-get install -y -qq git >/dev/null
    fi
    setup_repo
    progress 4 DONE "Repository cloned"

    progress 5 RUNNING "Configuring firewall and compose..."
    setup_compose
    configure_firewall
    if ! $SKIP_CADDY && [[ -n "$DOMAIN" ]]; then
        configure_caddy
    fi
    progress 5 DONE "Infrastructure configured"

    progress 6 RUNNING "Building Docker image (this takes 5-8 minutes)..."
    start_container
    progress 6 DONE "Container running and healthy"

    progress 7 RUNNING "Installing management tools..."
    create_management_script
    progress 7 DONE "Management CLI installed"

    progress 8 DONE "Installation complete"

    # Print summary
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           OpenClaw Shell — Installation Complete        ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    if [[ -n "$DOMAIN" ]] && ! $SKIP_CADDY; then
        echo -e "  Access URL:    ${CYAN}https://${DOMAIN}${NC}"
    else
        PUBLIC_IP=$(curl -sf https://ifconfig.me || echo "<server-ip>")
        echo -e "  Access URL:    ${CYAN}http://${PUBLIC_IP}:${INTERNAL_PORT}${NC}"
    fi

    echo -e "  Login:         ${CYAN}admin / admin${NC}  (change on first login!)"
    echo -e "  Data dir:      ${DATA_DIR}"
    echo -e "  Install dir:   ${INSTALL_DIR}"
    echo ""
    echo "  Management commands:"
    echo "    openclaw status    — Check container health"
    echo "    openclaw logs      — View logs"
    echo "    openclaw shell     — Shell into the container"
    echo "    openclaw update    — Pull latest and rebuild"
    echo "    openclaw domain    — Change domain"
    echo ""
    echo -e "  ${YELLOW}Important: Change your admin password on the setup page!${NC}"
    echo ""
}

main
