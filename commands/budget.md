---
description: Set the per-session and per-day budget TokenLens warns about
argument-hint: <session-usd> [day-usd]
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" budget $ARGUMENTS`

Confirm the budget in one line.
