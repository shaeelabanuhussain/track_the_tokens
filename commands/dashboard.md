---
description: Build the TokenLens HTML dashboard and open it in the browser
argument-hint: [--days N]
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" dashboard --open $ARGUMENTS`

Tell the user where the dashboard file is (path above) in one line. Nothing else.
