---
name: token-coach
description: Use when the user asks how much Claude Code is costing them, why a session is expensive, how to save tokens or money, whether to /compact or /clear, when the best time to use Claude is, or how to handle large PDFs, logs or files cheaply. Not for general coding questions.
---

# Token coach

TokenLens has already measured this user's real usage. Answer from data, not guesses.

1. Get the numbers with one command (pick the one that fits the question):
   - This session: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" report`
   - Recent sessions: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" sessions --days 7`
   - Recurring leaks in dollars: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" diagnose --days 7`
   - Timing: `node "${CLAUDE_PLUGIN_ROOT}/scripts/tokenlens.js" timing`
2. Lead with the single highest-dollar fix, then at most two more. Each fix is a concrete action (a command, a setting, a habit), not a principle.
3. Keep the answer short. Never re-print the whole report if the user can run `/tokenlens:report`.

## Rules of thumb (use when they apply)

- Every call re-sends the whole context: cost grows with context size times number of calls. Smaller context beats shorter answers; output is usually under 5% of the bill.
- Cache reads cost 5-10% of input price; cache writes cost 125-200%. Anything that breaks the cache (idle past the TTL, editing CLAUDE.md, switching model, toggling MCP servers) is expensive.
- `/clear` costs nothing; `/compact` is itself a big request. Prefer `/tokenlens:handoff` + `/clear` when switching topics.
- PDFs: convert first (`/tokenlens:pdf2md`); TokenLens also does it automatically when Claude reads a PDF.
- Models: Sonnet for routine coding, Opus for architecture and hard debugging, Haiku for search subagents.
- Peak hours (weekdays 05:00-11:00 Pacific; 17:30-23:30 in Sri Lanka) drain plan limits faster: schedule heavy work off-peak.
- Be honest: TokenLens savings are estimates against what was observed. Never present them as guaranteed.
