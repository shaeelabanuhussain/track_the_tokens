---
description: Enable the TokenLens live cost statusline
argument-hint: [--project] [--force] [--uninstall]
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" setup $ARGUMENTS`

Report the result in one line. If a statusline already existed, ask whether to replace it (re-run with --force). The statusline appears after the next message.
