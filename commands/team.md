---
description: Team report - who used tokens, for what, how efficiently, and who is eligible for more
argument-hint: "[--dir <shared folder>] [--days 30] [--html --open]"
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" team $ARGUMENTS`

Show the report above as-is. Then, in at most three bullets, summarise the decisions a team lead should take this month (who gets more tokens, who needs coaching on which habit, whose usage to discuss). Do not speculate beyond the data.
