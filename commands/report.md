---
description: Cost, tokens, cache and top cost leaks for this session
argument-hint: 
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" report --session ${CLAUDE_SESSION_ID}`

Show the report above to the user as-is (it is already formatted). Do not add commentary or re-analyze it unless they ask.
