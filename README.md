# ◆ TokenLens: track the tokens, cut the bill

**A Claude Code plugin by BISTEC Global for observing, diagnosing and optimizing token spend.**
Every developer and QA engineer sees, live, what their session costs, where the tokens went, and the one thing to do next to spend less.

```
◆ TokenLens │ Opus 5.5 │ $3.42 session (agents $0.81) │ $11.20 today │ ctx ▰▰▰▰▰▰▱▱▱▱ 63% 126k │ cache 94%
⏰ peak hrs, off-peak in 4h │ 5h limit 41% │ 💡 Context 63%: good moment for "/compact <what to keep>".
```

| Observe | Diagnose | Optimize |
|---|---|---|
| Live statusline: session $, today $, context %, cache hit rate, plan limits, peak hours | 10 leak detectors that put a **dollar figure** on the step that caused the spend | Automatic **PDF → Markdown** (65% fewer tokens, measured) |
| Per-session report: tokens by type, subagents, tool output | Efficiency score 0-100 per session | Context, idle-cache and budget nudges *before* you waste |
| HTML dashboard: daily spend by model, spend by hour, sessions | Cross-session ranking of recurring leaks | `/tokenlens:handoff` → `/clear` → continue cheaply |
| **FinOps FOCUS** CSV and OpenTelemetry GenAI export | What-if: savings from fixes, routing, caching | Best-practice coach skill + timing advice |

**Zero dependencies** (Node ≥ 18 only). **Zero tokens added** to Claude's context by its banners and nudges: they are shown to you, not the model. Everything stays on your machine.

## Install (2 minutes)

In Claude Code:

```
/plugin marketplace add shaeelabanuhussain/track_the_tokens
/plugin install tokenlens@bistec-tokenlens
/tokenlens:setup
```

`/tokenlens:setup` turns on the live statusline (a plugin cannot do that by itself; it backs up `~/.claude/settings.json` first).
Try it without installing: `npm run demo` builds two weeks of realistic demo data and opens the dashboard.

## What you get

### Commands

| Command | What it does |
|---|---|
| `/tokenlens:report` | This session: total cost (main + subagents), tokens by type, cache hit rate, context, top leaks with fixes |
| `/tokenlens:sessions` | Recent sessions: when, project, task, model, cost, efficiency score, top leak |
| `/tokenlens:diagnose` | Recurring leaks across sessions ranked by dollars |
| `/tokenlens:dashboard` | Opens the HTML dashboard ([sample](docs/demo-dashboard.html)) |
| `/tokenlens:pdf2md <file>` | Converts a PDF to Markdown and shows the token savings |
| `/tokenlens:handoff` | Writes `HANDOFF.md` so you can `/clear` and continue in a fresh session |
| `/tokenlens:tips` | Best practices plus peak/off-peak advice for your timezone |
| `/tokenlens:whatif` | Estimated savings if leaks, model routing and caching were fixed |
| `/tokenlens:export` | FinOps FOCUS 1.x CSV, OpenTelemetry GenAI JSON or raw JSON |
| `/tokenlens:share` | Shares your privacy-safe usage summary to the team folder |
| `/tokenlens:team` | Team report: who used tokens, for what, how efficiently, and who is eligible for more |
| `/tokenlens:budget 5 25` | Per-session and per-day budgets ($) that drive warnings |
| `/tokenlens:setup` | Enables the statusline |

Every report command runs a local script and hands Claude the finished text, so a report costs a few hundred tokens rather than an analysis.

### Hooks (automatic)

| When | What TokenLens does |
|---|---|
| Session start | Banner: today's spend, last session's cost and efficiency, peak/off-peak. Warns if you **resumed a big session with a cold cache** and if CLAUDE.md is over 200 lines |
| You send a prompt | PDF paths in the prompt are converted to Markdown up front. Nudges on context ≥ 60%, budget crossed, or **"you were away 40 min, this message re-writes 180k tokens (~$1.44)"** |
| Claude reads a PDF | Converts it to Markdown and redirects the Read (scanned PDFs fall through untouched) |
| Turn ends / session ends | Records the session in a local ledger (history survives Claude Code's 30-day transcript cleanup) and alerts once when the budget is crossed |

### The 10 leak detectors

| Leak | How it is priced |
|---|---|
| Prompt cache expired after a break | Context re-written at 1.25×/2× instead of read at 0.05-0.1× |
| Oversized context | Tokens above a lean 40k working set, re-read on every call |
| Huge tool outputs | Initial cache write + re-reads on every later call |
| Same file read 3+ times | Duplicate reads |
| PDFs read raw | Page images + text vs Markdown |
| Opus on small, tool-free replies | Opus vs Sonnet price difference |
| Failed tool calls | Retry overhead |
| Low cache hit rate | Missed reads |
| Marathon sessions | Flagged (no dollar estimate) |
| Subagent-heavy sessions | Share that could run on Haiku/Sonnet |

Costs come from the real `usage` blocks in Claude Code's transcripts (`~/.claude/projects/**/*.jsonl`, including subagents). Streamed duplicates are de-duplicated by `message.id`, and 5-minute and 1-hour cache writes are priced separately with each model's own cache-read rate. Prices are current list prices ([pricing.js](scripts/lib/pricing.js)) and can be overridden in `~/.claude/tokenlens/pricing.json`. Leak dollar figures are **estimates**, labelled as such everywhere.

## Team view: who uses tokens, for what, and who needs more

Each developer runs `/tokenlens:share` (or sets `"teamDir"` once and shares weekly). It writes one small JSON summary per person into a shared folder: a network share, a OneDrive/SharePoint-synced folder or a git repo. A team lead then runs `/tokenlens:team --html --open` ([sample](docs/demo-team-report.html)).

For each person the report shows spend and projected monthly spend against their allowance, **what the tokens were spent on** (feature development, bug fixing, testing & QA, code review, refactoring, docs & analysis, DevOps, learning & exploration, general Q&A), the efficiency score, avoidable spend, plan-limit stops, and a verdict:

| Verdict | Rule (configurable) | Action |
|---|---|---|
| ✅ Eligible for more tokens | Heavy use (≥80% of allowance or ≥3 plan-limit stops) **and** efficient (score ≥65, ≤30% avoidable) **and** ≥60% of spend on delivery work | Raise the allowance to the suggested amount |
| 🟡 Coach first | Heavy and delivery-focused, but wasteful | Fix the named top leak; it frees allowance before buying more |
| 🔍 Review purpose | Heavy, but mostly learning or general Q&A | Talk about it; it may still be justified |
| ⚪ Within allowance | Not heavy | Nothing, plus a coaching hint if efficiency is low |

**Privacy:** summaries contain purpose categories and numbers only: no prompt text, code or file contents. Task titles are included only if a developer sets `"shareTaskTitles": true`. Tell the team what is collected and why before rolling it out.

Policy settings in `~/.claude/tokenlens/config.json` on the lead's machine:

```json
{ "teamDir": "//fileserver/eng/tokenlens",
  "team": { "monthlyAllowanceUsd": 250, "allowances": { "senior.dev@bistecglobal.com": 400 },
            "heavyUtilization": 0.8, "limitHitsForHeavy": 3, "minEfficiency": 65, "maxAvoidable": 0.3, "minDelivery": 0.6 } }
```

Try it: `npm run demo:team` builds a six-person demo team and opens the report.

## Configuration

`~/.claude/tokenlens/config.json`:

```json
{
  "budgetPerSession": 5,
  "budgetPerDay": 25,
  "contextWarnPct": 60,
  "idleCacheWarn": true,
  "pdfAutoConvert": true,
  "sessionStartBanner": true,
  "timezone": null
}
```

The peak-hour window (weekdays 05:00-11:00 America/Los_Angeles, announced by Anthropic in March 2026; 17:30-23:30 in Sri Lanka) can be changed with a `"peak": { "start": 5, "end": 11, "tz": "America/Los_Angeles", "days": [1,2,3,4,5] }` entry.

PDF conversion uses the best tool available: `pdftotext` (poppler), then `markitdown`, then Python `pdfplumber`/`pypdf`, then a built-in extractor that needs nothing installed.

## CLI

Everything also works outside Claude Code at zero token cost:

```bash
node scripts/tokenlens.js report | sessions | diagnose | dashboard --open | whatif
node scripts/tokenlens.js export --format focus --days 30 --out claude-code-focus.csv
node scripts/tokenlens.js pdf2md docs/spec.pdf
```

## Project layout

```
.claude-plugin/        plugin.json, marketplace.json
hooks/hooks.json       SessionStart, PreToolUse(Read), UserPromptSubmit, Stop, SessionEnd
commands/              11 slash commands
skills/token-coach/    on-demand coaching skill (loads only when asked about cost)
scripts/tokenlens.js   CLI, statusline and hook entry point
scripts/lib/           transcripts, pricing, insights, store, timing, tips, pdf2md, export, dashboard
scripts/demo/          demo-data generator
tests/                 npm test (node:test, no dependencies)
docs/                  analysis, hack-day playbook, demo dashboard, screenshots
```

## Why TokenLens

We analysed 13 token-saving tools before building this one ([docs/ANALYSIS.md](docs/ANALYSIS.md)). Most save tokens in one way (memory, code graphs, terse output, compression proxies) but **don't show a developer what they are spending**. The few that track cost are large multi-tool suites. TokenLens adopts their proven ideas and puts **visibility and the next best action** in front of every developer and QA engineer, with no new runtime, no proxy and no extra context.

## Docs

- [Analysis of the 13 reference tools and why we built TokenLens this way](docs/ANALYSIS.md)
- [Hack Day playbook: fixing an inefficient LLM workflow (caching, routing, trimming)](docs/HACKDAY-PLAYBOOK.md)
- [Demo dashboard](docs/demo-dashboard.html)
- [Demo team report](docs/demo-team-report.html)

MIT licensed · © 2026 BISTEC Global
