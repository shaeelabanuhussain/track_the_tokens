'use strict';
// "Diagnose": find the steps that drive spend in a parsed session and put a
// dollar figure on each, with the fix a developer can apply right away.

const { priceFor, CACHE_WRITE_5M, CACHE_WRITE_1H } = require('./pricing');
const { contextLimitFor } = require('./transcripts');

const FIVE_MIN = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function perTok(model) {
  return priceFor(model).input / 1e6;
}

function readMult(model) {
  return priceFor(model).read;
}

function diagnose(session) {
  const findings = [];
  const turns = session.turns;

  // 1. Cache expired after a break: the whole context is written again at
  // 1.25x/2x input price instead of read at 0.1x.
  let idleCost = 0;
  let idleEvents = 0;
  let worstIdle = 0;
  for (let i = 1; i < turns.length; i++) {
    const t = turns[i];
    const gap = t.ts && turns[i - 1].ts ? t.ts - turns[i - 1].ts : 0;
    const ttl = t.cacheWrite1h > 0 ? ONE_HOUR : FIVE_MIN;
    if (gap > ttl && t.cacheWrite > 20000) {
      const mult = t.cacheWrite1h > 0 ? CACHE_WRITE_1H : CACHE_WRITE_5M;
      const extra = t.cacheWrite * perTok(t.model) * (mult - readMult(t.model));
      idleCost += extra;
      idleEvents++;
      worstIdle = Math.max(worstIdle, t.cacheWrite);
    }
  }
  if (idleEvents) {
    findings.push({
      id: 'cache-expired',
      title: `Prompt cache expired ${idleEvents}x after a break`,
      cost: idleCost,
      evidence: `Up to ${fmtK(worstIdle)} tokens re-written to cache after idle gaps longer than the cache TTL.`,
      fix: 'Before a break: /compact (or write a /tokenlens:handoff note). After a long break on a big context: start a fresh session from the handoff instead of resuming.',
    });
  }

  // 2. Context bloat: every turn re-reads the whole conversation. Anything
  // above a lean 40k working set is paid for again on every call.
  const LEAN = 40000;
  let bloatCost = 0;
  let bloatTurns = 0;
  for (const t of turns) {
    if (t.context > LEAN * 2) {
      bloatCost += (t.context - LEAN) * perTok(t.model) * readMult(t.model);
      bloatTurns++;
    }
  }
  const limit = contextLimitFor(session.mainModel);
  if (bloatTurns >= 3) {
    findings.push({
      id: 'context-bloat',
      title: `${bloatTurns} calls ran with a context above ${fmtK(LEAN * 2)}`,
      cost: bloatCost,
      evidence: `Peak context ${fmtK(session.peakContext)} of ${fmtK(limit)} (${pct(session.peakContext / limit)}). Each call re-reads all of it.`,
      fix: 'Use /clear between unrelated tasks, /compact at milestones, and push exploration into subagents so only their summary lands in your context.',
    });
  }

  // 3. Oversized tool results: they stay in context for every later turn.
  const big = session.toolCalls.filter((c) => c.tokens >= 8000).sort((a, b) => b.tokens - a.tokens);
  if (big.length) {
    let cost = 0;
    for (const c of big) {
      const m = c.model || session.mainModel;
      cost += c.tokens * perTok(m) * (CACHE_WRITE_5M + readMult(m) * c.laterTurns);
    }
    findings.push({
      id: 'big-tool-output',
      title: `${big.length} tool result(s) over 8k tokens`,
      cost,
      evidence: big.slice(0, 3).map((c) => `${c.label} (~${fmtK(c.tokens)}, carried ${c.laterTurns} more calls)`).join('; '),
      fix: 'Read with offset/limit, grep before reading, pipe Bash output through head/tail, and ask for summaries from subagents instead of raw dumps.',
    });
  }

  // 4. Same file read again and again.
  const reads = {};
  for (const c of session.toolCalls) {
    if (c.name === 'Read' && c.input && c.input.file_path) {
      const r = (reads[c.input.file_path] = reads[c.input.file_path] || { n: 0, tokens: 0, model: c.model });
      r.n++;
      r.tokens += c.tokens;
    }
  }
  const repeated = Object.entries(reads).filter(([, r]) => r.n >= 3).sort((a, b) => b[1].tokens - a[1].tokens);
  if (repeated.length) {
    let cost = 0;
    for (const [, r] of repeated) cost += (r.tokens - r.tokens / r.n) * perTok(r.model || session.mainModel) * CACHE_WRITE_5M;
    findings.push({
      id: 'repeated-reads',
      title: `${repeated.length} file(s) read 3+ times`,
      cost,
      evidence: repeated.slice(0, 3).map(([f, r]) => `${shortPath(f)} x${r.n}`).join(', '),
      fix: 'Keep key facts in CLAUDE.md or a short notes file; read targeted line ranges instead of whole files again.',
    });
  }

  // 5. PDFs read directly (each page costs text + an image).
  const pdfs = session.toolCalls.filter((c) => c.name === 'Read' && c.input && /\.pdf$/i.test(c.input.file_path || ''));
  if (pdfs.length) {
    const tokens = pdfs.reduce((a, c) => a + Math.max(c.tokens, 3000), 0);
    findings.push({
      id: 'pdf-read',
      title: `${pdfs.length} PDF(s) read raw`,
      cost: tokens * 0.7 * perTok(session.mainModel) * CACHE_WRITE_5M,
      evidence: pdfs.map((c) => shortPath(c.input.file_path)).join(', '),
      fix: 'Run /tokenlens:pdf2md (TokenLens does this automatically on Read): Markdown is typically 60-90% fewer tokens than PDF page images + text.',
    });
  }

  // 6. Premium model on small turns.
  const small = turns.filter((t) => /opus/.test(t.model || '') && t.output < 400 && t.tools.length === 0);
  if (small.length >= 5) {
    const opusCost = small.reduce((a, t) => a + t.cost, 0);
    const sonnetRatio = priceFor('claude-sonnet-4').input / priceFor(small[0].model).input;
    findings.push({
      id: 'model-overkill',
      title: `${small.length} short answers generated on Opus`,
      cost: opusCost * (1 - sonnetRatio),
      evidence: `Short, tool-free replies cost $${opusCost.toFixed(2)} on Opus.`,
      fix: 'Use /model sonnet (or opusplan) for routine Q&A and edits; keep Opus for planning and hard debugging. Give Explore-style subagents model: haiku.',
    });
  }

  // 7. Failed tool calls cause retries.
  const errors = session.toolCalls.filter((c) => c.isError);
  if (errors.length >= 3) {
    const pt = perTok(session.mainModel);
    findings.push({
      id: 'tool-errors',
      title: `${errors.length} failed tool calls`,
      cost: errors.length * 2000 * pt * CACHE_WRITE_5M,
      evidence: errors.slice(0, 3).map((c) => c.label).join('; '),
      fix: 'Document the right build/test commands and paths in CLAUDE.md so Claude stops guessing.',
    });
  }

  // 8. Low cache hit rate.
  if (session.apiCalls >= 5 && session.cacheHitRate < 0.6) {
    const missed = (session.input + session.cacheWrite) * 0.5;
    findings.push({
      id: 'low-cache-hit',
      title: `Cache hit rate only ${pct(session.cacheHitRate)}`,
      cost: missed * perTok(session.mainModel) * (CACHE_WRITE_5M - readMult(session.mainModel)),
      evidence: `${fmtK(session.cacheRead)} read from cache vs ${fmtK(session.input + session.cacheWrite)} written/uncached.`,
      fix: 'Avoid editing CLAUDE.md, switching models or toggling MCP servers mid-session: each change invalidates the cached prefix.',
    });
  }

  // 9. Marathon sessions.
  if (session.userPrompts >= 40 || session.compactions >= 2) {
    findings.push({
      id: 'marathon',
      title: `Long session: ${session.userPrompts} prompts, ${session.compactions} compaction(s)`,
      cost: 0,
      evidence: 'Compaction summaries lose detail and every turn still carries the summary plus new history.',
      fix: 'One task per session. When the topic changes, /tokenlens:handoff then /clear.',
    });
  }

  // 10. Subagent share (informational: subagents protect the main context but cost tokens).
  const subCost = session.subagents.reduce((a, s) => a + s.cost, 0);
  const total = session.total.cost;
  if (total > 0 && subCost / total > 0.5) {
    findings.push({
      id: 'subagent-share',
      title: `Subagents are ${pct(subCost / total)} of this session's spend`,
      cost: subCost * 0.4,
      evidence: session.subagents.sort((a, b) => b.cost - a.cost).slice(0, 3).map((s) => `${s.label} $${s.cost.toFixed(2)}`).join('; '),
      fix: 'Give read-only/research subagents `model: haiku` or `sonnet`, bound their scope, and ask for short reports.',
    });
  }

  findings.sort((a, b) => b.cost - a.cost);
  return findings;
}

function score(session, findings) {
  // 100 = lean session. Waste is weighed against what the session cost.
  const total = session.total.cost || session.cost || 0;
  const waste = findings.reduce((a, f) => a + f.cost, 0);
  if (!total) return 100;
  return Math.max(0, Math.min(100, Math.round(100 - (waste / total) * 100)));
}

function fmtK(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}

function pct(x) {
  return Math.round(x * 100) + '%';
}

function shortPath(p) {
  const parts = String(p).split(/[\\/]/);
  return parts.slice(-2).join('/');
}

module.exports = { diagnose, score, fmtK, pct, shortPath };
