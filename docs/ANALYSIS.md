# Analysis: 13 token-saving tools, and what TokenLens takes from each

Code Crunch, "Track the Tokens", asks teams to **Observe → Diagnose → Optimize**: trace calls, capture tokens, latency and cost; attribute spend to the step that causes it; then apply caching, routing and right-sized models. We read every tool we were pointed to (source code, not only READMEs) and scored them against that brief.

## The landscape

| Tool | What it is | How it saves tokens | Shows cost to the dev? | Weak spot |
|---|---|---|---|---|
| **codeburn** | TS CLI, TUI, MCP, plugin, desktop app | Reads transcripts, prices every call, 15+ waste detectors, A-F grade | ✅ (CLI/TUI) | Very large (6.8k-line parser); savings heuristics; npx/Node 22 |
| **claude-mem** | Persistent memory plugin (Bun + SQLite + worker) | Compressed observations injected at start, searchable via MCP; read gate for big files | ❌ (has a cost-report skill) | Heavy runtime; its own observer LLM spends tokens; "saved" number is self-referential |
| **graphify** | Knowledge-graph CLI + PreToolUse nudges | Graph queries (~2k tokens) instead of grep/read | ❌ | Estimates only; graph goes stale |
| **codegraph** | SQLite code graph over MCP | One `explore` call replaces many reads (claims −62% tokens, −44% cost) | ❌ | No cost view; more context stays resident |
| **headroom** | Local compression proxy (Python + Rust + ML model) | Compresses tool output/logs before the API call (21-57%) | Proxy stats only | Heavy; rewrites requests; stale price table; no per-session view |
| **caveman** | Terse-output skill + proxy + router | Shorter answers (−3% vs "be concise", −35% ultra) | `/caveman-stats` | Its own docs: output is ~0.3% of tokens, so bill impact ≈ 0 |
| **ponytail** | "Lazy senior dev" ruleset + UI band | Smallest working change (claims −26% cost) | ✅ band (terminal only) | Self-benchmarked; band doesn't work in VS Code/cloud |
| **ECC** | 71 agents, 311 skills, 97 commands | Strategic-compact nudges, cost tracker, context monitor, model routing | Partly | Huge; hooks run 8× per turn; hard-coded prices |
| **claude-token-optimizer** | CLI for CLAUDE.md startup tax | Shrinks auto-loaded docs (11k → 800 startup tokens) | ❌ | Only static context; Claude-2 tokenizer; a read-guard hook bug |
| **one-skill-to-rule-them-all** | Self-improving "task-observer" meta-skill | Progressive disclosure | ❌ | Not a token saver; loads a 691-line core each session |
| skill-optimiser / token-optimizer skills | Prompt-only skills | Lean SKILL.md, on-demand references, model choice tips | ❌ | Guidance only, no measurement |
| Built-ins `/compact`, `/rewind`, `/doctor`, `/handoff`-style notes | Claude Code features / common skill | Shrink or reset context | `/usage`, `/context` | User has to know when to use them |

## What we concluded

1. **Visibility is the gap.** Eight of the 13 tools save tokens blind: no developer ever sees "this session cost $4.19 and $2.10 of it was a cache that expired while you were at lunch". The brief's first two phases (Observe, Diagnose) are exactly what is missing.
2. **Input, not output, is the bill.** Caveman's own measurements and our transcripts agree: cache reads and writes of a growing context dominate, and output is usually under 5% of tokens. The biggest levers are **context size, cache health, PDFs/large tool output, and model choice**, not shorter answers.
3. **Savers that inject context have a cost.** claude-mem, ponytail, caveman and one-skill all add tokens to every session. TokenLens shows its nudges to the *user* (`systemMessage`), so it adds zero context.
4. **Heavy runtimes don't spread across a company.** Proxies, ML models, SQLite workers and Bun are hard to roll out to every developer and QA engineer. A zero-dependency Node plugin installs in two commands.
5. **Be honest about savings.** ponytail's "honesty boundary" and caveman's HONEST-NUMBERS page are right: TokenLens labels every leak dollar figure as an estimate and measures what it can (PDF conversion: 65% on the hackathon brief).

## What TokenLens borrows (with credit)

| Idea | From |
|---|---|
| De-duplicate streamed assistant lines by `message.id`; price 5m vs 1h cache writes separately; include subagent transcripts | codeburn, codegraph, claude-mem |
| Dollar-priced waste detectors, health score, savings what-if | codeburn |
| Context-size signal for strategic `/compact` | ECC `suggest-compact` |
| Cost and context thresholds that nudge the user | ECC context monitor, codeburn guard |
| Handoff note before `/clear` | claude-mem `/handoff` skill |
| PreToolUse redirect with a clear reason | graphify, claude-mem read gate |
| Startup tax (CLAUDE.md size) check | claude-token-optimizer |
| Session ledger that outlives transcript cleanup | ponytail band ledger, caveman stats |
| Progressive disclosure: a small skill that loads only when asked about cost | skill-optimiser, one-skill |
| Honest, labelled estimates | ponytail, caveman, headroom |

## What only TokenLens does

- **Live statusline** with session $, agents $, today $, context bar, cache hit rate and plan limits, plus the single most useful tip for the moment.
- **Idle-cache alarm**: warns when your next message will re-write a cold 100k+ context, with the price.
- **Automatic PDF → Markdown** on Read and in prompts, with measured savings.
- **Best time to use Claude**: peak/off-peak in the developer's own timezone (17:30-23:30 in Sri Lanka), plus a spend-by-hour chart.
- **FinOps-native**: FOCUS 1.x CSV and OpenTelemetry GenAI export, so Claude Code spend sits next to cloud bills.
- Built for **developers and QA**: QA-specific tips (log trimming, failing-test-only output), dashboards anyone can open.

## Pricing reference used (USD per million tokens, Oct 2026)

| Model | Input | Output | Cache read |
|---|---|---|---|
| Opus 5.5 | 4 | 20 | 0.05× |
| Opus 4.5-4.8 / 5 | 5 | 25 | 0.1× |
| Sonnet 5.5 | 2 | 10 | 0.05× |
| Sonnet 4.x | 3 | 15 | 0.1× |
| Haiku 5.5 (≤100k prompt) | 0.10 | 0.50 | 0.1× |
| Haiku 4.5 | 1 | 5 | 0.1× |
| Fable 5.1 | 10 | 50 | 0.025× |

Cache writes are 1.25× input (5-minute TTL) or 2× input (1-hour TTL). Source: platform.claude.com pricing page.
