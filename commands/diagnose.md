---
description: Recurring cost leaks across your sessions, ranked by dollars, with fixes
argument-hint: [--days N]
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" diagnose $ARGUMENTS`

Show the diagnosis above to the user as-is. Then, in at most 3 short bullets, say which single fix would save the most for this user and how to apply it.
