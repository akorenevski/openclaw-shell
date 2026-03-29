# =============================================================================
# OpenClaw Secure Shell
# =============================================================================
# Builds OpenClaw with:
# - Node.js auth proxy with form-based login
# - FileBrowser for /data volume access
# - Pages-api backend server
# - OpenClaw gateway
# All managed by supervisord on a single port. Platform-agnostic.
# =============================================================================

# -----------------------------------------------------------------------------
# Build Stage
# -----------------------------------------------------------------------------
FROM node:22-bookworm AS builder

# Build arguments
ARG OPENCLAW_GIT_REF=v2026.3.24
ARG SHELL_VERSION=dev

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install bun for build scripts
RUN npm install -g bun

WORKDIR /build

# Clone OpenClaw repository
RUN git clone --depth 1 --branch ${OPENCLAW_GIT_REF} https://github.com/openclaw/openclaw.git .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build application and extensions
ENV OPENCLAW_A2UI_SKIP_MISSING=1
ENV OPENCLAW_PREFER_PNPM=1
# Note: no Node heap cap during build — let it use available memory.
# Servers with ≤8GB RAM should have swap enabled (see coolify.md).
RUN pnpm build
RUN pnpm ui:build || true

# Build extensions (ensure memory-core and other plugins are compiled)
RUN cd extensions/memory-core && pnpm install --frozen-lockfile || true
RUN cd extensions/memory-core && pnpm build || true

# -----------------------------------------------------------------------------
# Production Stage
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS production

# Install runtime dependencies
# Install Chromium via apt (faster & more reliable than playwright download)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    supervisor \
    git \
    openssh-client \
    chromium \
    chromium-driver \
    fonts-liberation \
    xdg-utils \
    wget \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install FFmpeg (static binary - latest version, no shared lib dependencies)
# Commented out to reduce build resource usage
# COPY --from=mwader/static-ffmpeg:7.1 /ffmpeg /usr/local/bin/
# COPY --from=mwader/static-ffmpeg:7.1 /ffprobe /usr/local/bin/

# Install Claude Code CLI (auto-updates enabled at runtime)
# Commented out to reduce build resource usage
# RUN curl -fsSL https://claude.ai/install.sh | bash \
#     && ln -s /root/.local/bin/claude /usr/local/bin/claude

# Install uv (Python package manager from Astral)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && ln -s /root/.local/bin/uv /usr/local/bin/uv \
    && ln -s /root/.local/bin/uvx /usr/local/bin/uvx

# Install FileBrowser
RUN curl -fsSL https://github.com/filebrowser/filebrowser/releases/download/v2.27.0/linux-amd64-filebrowser.tar.gz \
    | tar xz -C /usr/local/bin filebrowser \
    && chmod +x /usr/local/bin/filebrowser

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./
COPY --from=builder /build/pnpm-workspace.yaml ./

# Copy extensions (includes memory-core and other bundled plugins)
COPY --from=builder /build/extensions ./extensions

# Copy docs/templates (workspace templates like AGENTS.md)
COPY --from=builder /build/docs ./docs

# Note: playwright-core is installed via pnpm install (from OpenClaw's package.json)
# It will use system Chromium via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var

# Copy configuration files
COPY supervisord.conf /app/supervisord.conf
COPY start-container.sh /app/start-container.sh
COPY git-init.sh /app/git-init.sh
COPY auth-proxy /app/auth-proxy
COPY backend /app/backend
COPY skills /app/skills
RUN chmod +x /app/start-container.sh /app/git-init.sh

# Create wrapper script for easy CLI access
RUN echo '#!/bin/bash\nexec node /app/dist/index.js "$@"' > /usr/local/bin/openclaw \
    && chmod +x /usr/local/bin/openclaw

# Create data directory structure (will be mounted as Railway volume at /data)
RUN mkdir -p /data/.openclaw /data/workspace

# -----------------------------------------------------------------------------
# Environment Variables (defaults - override via platform dashboard)
# -----------------------------------------------------------------------------
ARG SHELL_VERSION=dev
ENV SHELL_VERSION=${SHELL_VERSION}
ENV NODE_ENV=production
ENV OPENCLAW_PREFER_PNPM=1

# Data persistence - volume should be mounted at /data
ENV OPENCLAW_STATE_DIR=/data/.openclaw
ENV OPENCLAW_WORKSPACE_DIR=/data/workspace

# Memory optimization
ENV NODE_OPTIONS="--max-old-space-size=1536"

# Browser configuration - use system Chromium (installed via apt)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Port configuration (Railway sets PORT automatically, default to 8080)
ENV PORT=8080
EXPOSE 8080

# Auth proxy configuration
ENV PROXY_USER=admin
# PROXY_PASSWORD must be set in Railway dashboard (plain text)
# AUTH_SECRET is auto-generated if not set

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# -----------------------------------------------------------------------------
# Startup Command
# -----------------------------------------------------------------------------
# Supervisor manages: Auth Proxy, OpenClaw (gateway), FileBrowser
CMD ["/app/start-container.sh"]
