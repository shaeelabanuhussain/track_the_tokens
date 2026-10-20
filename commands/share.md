---
description: Share your privacy-safe token usage summary with your team lead
argument-hint: "[--dir <shared folder>] [--days 30]"
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" share $ARGUMENTS`

Report the result above in one or two lines. If it asks for a folder, ask the user for their team's shared folder path and offer to save it as "teamDir" in ~/.claude/tokenlens/config.json.
