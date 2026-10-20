---
description: Estimate savings if detected leaks, model routing and caching were fixed
argument-hint: [--days N]
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" whatif $ARGUMENTS`

Show the estimate above as-is.
