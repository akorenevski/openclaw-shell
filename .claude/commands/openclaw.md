---
description: Ask OpenClaw documentation expert
allowed-tools: Task, Read, Grep, Glob, WebSearch, WebFetch, LS, Bash
allowed-commands:
  - "tsc --noEmit"
  - "pnpm exec tsc"
  - "eslint"
  - "pnpm exec eslint"
  - "prettier"
  - "pnpm exec prettier"
  - "./vendor/bin/pint"
  - "pnpm build"
  - "npm run build"
  - "pnpm --filter"
  - "pnpm add"
  - "pnpm install"
  - "npm install"
  - "npm add"
---

# OpenClaw Expert

Use the **openclaw** agent to answer the user's question about OpenClaw configuration, deployment, or usage.

## Task

$ARGUMENTS

## Instructions

1. Load the openclaw agent context from `.claude/agents/openclaw.md`
2. Use the documentation in `.docs/openclaw/` to find answers
3. Provide accurate, specific answers with config examples where relevant
4. If docs are outdated, use WebFetch to check the official repo
