---
description: Convert a PDF to Markdown (60-90% fewer tokens) and show the savings
argument-hint: <file.pdf>
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" pdf2md $ARGUMENTS`

Report the result above in one line. From now on in this session, read the generated .md file instead of the PDF.
