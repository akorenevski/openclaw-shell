# Headless Chromium Browser

## What It Does

Provides agents with a fully functional headless Chromium browser for web browsing, screenshots, form filling, and scraping. Uses `playwright-core` (not full `playwright`) with system-installed Chromium.

## Why

OpenClaw agents need browser access for tasks like web research, monitoring, and interacting with web services. Running Chromium inside the container avoids external browser service dependencies.

## Architecture

- **Chromium** is installed via `apt` in the Dockerfile (not `npx playwright install` — that's too slow and unreliable for CI/CD)
- **`playwright-core`** is already an OpenClaw dependency — it connects to the system Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
- **Agent sandbox is disabled** (`sandbox.mode = 'off'` in `start-container.sh`) because agent and browser processes must communicate directly within the container. Docker provides the isolation layer instead.
- **Browser profiles** persist at `/data/.openclaw/browser/` across container restarts
- **Stale lock files** (`SingletonLock`, etc.) are cleaned up on boot by `start-container.sh`

## Implementation

- Chromium install: `Dockerfile` (apt-get install chromium)
- Browser config enforcement: `start-container.sh` (lines ~98-104)
- Lock file cleanup: `start-container.sh` (lines ~162-166)
- Environment variables: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` (set in Dockerfile)

## Key Constraint

OpenClaw uses `playwright-core`, NOT the full `playwright` package. This is correct and intentional — `playwright-core` can use system browsers via the executable path env variable. Do not install or reference the full `playwright` package.

## References

- `.docs/openclaw/tools/browser.md` — Browser tool documentation
- `.docs/openclaw/install/docker.md` — Docker install tips
- `.docs/openclaw/tools/browser-linux-troubleshooting.md` — Linux troubleshooting
