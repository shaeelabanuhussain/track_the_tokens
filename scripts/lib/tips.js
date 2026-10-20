'use strict';
// Best practices, and the one tip that matters most right now.

const { fmtK } = require('./insights');

const BEST_PRACTICES = [
  { area: 'Sessions', tip: 'One task per session. /clear when you switch to unrelated work (it costs nothing; /compact itself is a large request).' },
  { area: 'Sessions', tip: 'Before a long break or a topic change, run /tokenlens:handoff, then /clear and continue from HANDOFF.md.' },
  { area: 'Sessions', tip: 'Use /rewind (or Esc twice) to undo a wrong turn instead of arguing with it: the bad attempt stops costing tokens.' },
  { area: 'Context', tip: '/compact at milestones with a focus: "/compact keep the API design decisions, drop the debugging".' },
  { area: 'Context', tip: 'Run /context to see what fills the window: big MCP tool lists, CLAUDE.md and skills load on every call.' },
  { area: 'Context', tip: 'Keep CLAUDE.md under ~200 lines; move rarely needed detail into skills or docs that load on demand.' },
  { area: 'Context', tip: 'Point Claude at files and line ranges ("src/api.ts:120-180") instead of "look around the codebase".' },
  { area: 'Files', tip: 'Convert PDFs to Markdown before reading (/tokenlens:pdf2md; automatic with TokenLens): 60-90% fewer tokens.' },
  { area: 'Files', tip: 'Never let Claude read lockfiles, build output or node_modules. Add them to permissions.deny for Read.' },
  { area: 'Tools', tip: 'Pipe noisy commands: "npm test 2>&1 | tail -40", "git log --oneline -20". Tool output is re-read on every later turn.' },
  { area: 'Tools', tip: 'Disable MCP servers you are not using in this project (/mcp). Prefer CLIs like gh over MCP equivalents.' },
  { area: 'Models', tip: 'Sonnet for everyday coding, Opus for architecture and hard bugs, Haiku for search subagents. /model switches mid-session.' },
  { area: 'Models', tip: 'Lower /effort for routine edits: thinking tokens are billed as output tokens.' },
  { area: 'Agents', tip: 'Subagents keep exploration out of your main context, but each one has its own bill. Give research agents model: haiku and a tight brief.' },
  { area: 'Cache', tip: 'Do not edit CLAUDE.md, switch models or toggle MCP servers mid-session: each invalidates the cached prompt prefix.' },
  { area: 'Cache', tip: 'The prompt cache expires after idle time (5 min on API keys, 1 h on plans). Coming back to a 150k context re-writes all of it.' },
  { area: 'Prompts', tip: 'Use plan mode (Shift+Tab) for multi-file changes: agreeing on a plan first avoids expensive rewrites.' },
  { area: 'Prompts', tip: 'Give a verification target ("run npm test, it must pass") so Claude stops when done instead of guessing.' },
  { area: 'Timing', tip: 'Schedule big refactors and agent fan-outs off-peak: plan limits drain faster on weekday peak hours.' },
  { area: 'QA', tip: 'Paste only the failing test output and the stack trace, not the whole log. Attach screenshots only when layout matters.' },
];

// Pick the single most useful nudge for the current state.
// state: { contextPct, contextTokens, sessionCost, budget, dayCost, dayBudget, cacheCold, recacheUsd, peak, idleMin }
function nextTip(state) {
  if (state.budget && state.sessionCost >= state.budget) {
    return { level: 'alert', text: `Session passed your $${state.budget} budget. Wrap up: /tokenlens:handoff then /clear.` };
  }
  if (state.dayBudget && state.dayCost >= state.dayBudget) {
    return { level: 'alert', text: `Today's spend passed $${state.dayBudget}. Keep the rest of today for small tasks.` };
  }
  if (state.cacheCold && state.contextTokens > 50000) {
    const usd = state.recacheUsd ? ` (~$${state.recacheUsd.toFixed(2)})` : '';
    return { level: 'warn', text: `Cache expired: your next message re-writes ${fmtK(state.contextTokens)} tokens${usd}. Consider /tokenlens:handoff + /clear.` };
  }
  if (state.contextPct >= 80) {
    return { level: 'alert', text: `Context ${state.contextPct}% full: /compact now, or /tokenlens:handoff and /clear.` };
  }
  if (state.contextPct >= (state.warnPct || 60)) {
    return { level: 'warn', text: `Context ${state.contextPct}%: good moment for "/compact <what to keep>".` };
  }
  if (state.peak && state.contextTokens > 100000) {
    return { level: 'warn', text: 'Peak hours + big context: finish this step, start heavy work off-peak.' };
  }
  const i = Math.floor(Date.now() / 60000 / 2) % BEST_PRACTICES.length; // rotates every 2 minutes
  return { level: 'info', text: BEST_PRACTICES[i].tip };
}

module.exports = { BEST_PRACTICES, nextTip };
