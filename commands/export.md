---
description: Export usage as FinOps FOCUS CSV or OpenTelemetry GenAI JSON
argument-hint: [--format focus|otel|json] [--days N] --out <file>
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" export $ARGUMENTS`

Report what was written in one line.
