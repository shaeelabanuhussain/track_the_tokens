'use strict';
// Session summaries across all projects, cached by file size + mtime so the
// statusline and dashboard stay fast. Summaries are also kept in a ledger that
// outlives Claude Code's transcript cleanup (30 days by default).

const fs = require('fs');
const path = require('path');
const { listSessionFiles, parseTranscript } = require('./transcripts');
const { diagnose, score } = require('./insights');
const { dataDir } = require('./config');
const { classifyPurpose } = require('./purpose');

const CACHE_VERSION = 4;

function cachePath() {
  return path.join(dataDir(), 'cache.json');
}

function loadCache() {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (c.version === CACHE_VERSION) return c;
  } catch {}
  return { version: CACHE_VERSION, files: {} };
}

function saveCache(c) {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(c));
  } catch {}
}

function dirSignature(file) {
  // A session's cost also changes when its subagent transcripts grow.
  let sig = 0;
  const dir = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
  try {
    for (const f of fs.readdirSync(dir)) sig += fs.statSync(path.join(dir, f)).size;
  } catch {}
  return sig;
}

function localDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function summarizeSession(file, project) {
  const s = parseTranscript(file);
  if (!s.turns.length) return null;
  const findings = diagnose(s);
  const byDay = {};
  const byHour = {}; // "dow-hour" local -> cost
  const addTurn = (t) => {
    if (!t.ts) return;
    const day = localDay(t.ts);
    const m = (byDay[day] = byDay[day] || {});
    m[t.model] = (m[t.model] || 0) + t.cost;
    const d = new Date(t.ts);
    const k = `${d.getDay()}-${d.getHours()}`;
    byHour[k] = (byHour[k] || 0) + t.cost;
  };
  s.turns.forEach(addTurn);
  // Subagent cost is attributed to the session's days in proportion to its own turns.
  const subCost = s.subagents.reduce((a, x) => a + x.cost, 0);
  if (subCost && s.cost) {
    const f = subCost / s.cost;
    for (const day of Object.keys(byDay)) for (const m of Object.keys(byDay[day])) byDay[day][m] *= 1 + f;
    for (const k of Object.keys(byHour)) byHour[k] *= 1 + f;
  } else if (subCost && s.start) {
    const day = localDay(s.start);
    byDay[day] = byDay[day] || {};
    byDay[day][s.mainModel] = (byDay[day][s.mainModel] || 0) + subCost;
  }
  return {
    sessionId: s.sessionId,
    project,
    cwd: s.cwd,
    gitBranch: s.gitBranch,
    firstPrompt: s.firstPrompt,
    start: s.start,
    end: s.end,
    mainModel: s.mainModel,
    models: mergeModels(s.models, s.subagents),
    apiCalls: s.total.apiCalls,
    userPrompts: s.userPrompts,
    input: s.total.input,
    output: s.total.output,
    cacheRead: s.total.cacheRead,
    cacheWrite: s.total.cacheWrite,
    mainCost: s.cost,
    subCost,
    cost: s.total.cost,
    subagents: s.subagents.map((x) => ({ label: x.label, cost: x.cost })),
    cacheHitRate: s.cacheHitRate,
    peakContext: s.peakContext,
    lastContext: s.lastContext,
    compactions: s.compactions,
    purpose: classifyPurpose(s),
    edits: s.edits,
    limitHits: s.limitHits,
    topTools: topTools(s.toolCalls),
    findings: findings.map(({ id, title, cost, evidence, fix }) => ({ id, title, cost, evidence, fix })),
    score: score(s, findings),
    byDay,
    byHour,
  };
}

// Main-session and subagent usage per model, for FinOps exports.
function mergeModels(main, subs) {
  const out = {};
  for (const src of [main, ...subs.map((x) => x.models || {})]) {
    for (const [model, u] of Object.entries(src)) {
      const o = (out[model] = out[model] || { calls: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
      for (const k of Object.keys(o)) o[k] += u[k] || 0;
    }
  }
  return out;
}

function topTools(calls) {
  const by = {};
  for (const c of calls) {
    const b = (by[c.name] = by[c.name] || { name: c.name, calls: 0, tokens: 0 });
    b.calls++;
    b.tokens += c.tokens;
  }
  return Object.values(by).sort((a, b) => b.tokens - a.tokens).slice(0, 8);
}

function loadSessions({ days = 30, project = null } = {}) {
  const cache = loadCache();
  const since = Date.now() - days * 86400000;
  const out = [];
  let dirty = false;
  for (const f of listSessionFiles({ project })) {
    if (f.mtime < since) continue;
    const size = fs.statSync(f.file).size;
    const sig = `${size}:${f.mtime}:${dirSignature(f.file)}`;
    let entry = cache.files[f.file];
    if (!entry || entry.sig !== sig) {
      let summary = null;
      try {
        summary = summarizeSession(f.file, f.project);
      } catch {}
      entry = cache.files[f.file] = { sig, summary };
      dirty = true;
    }
    if (entry.summary) out.push(entry.summary);
  }
  if (dirty) saveCache(cache);
  // Sessions whose transcripts were cleaned up survive in the ledger.
  const seen = new Set(out.map((s) => s.sessionId));
  for (const s of readLedger()) {
    if (!seen.has(s.sessionId) && (s.end || 0) >= since && (!project || String(s.project).includes(project))) out.push(s);
  }
  return out.sort((a, b) => (b.end || 0) - (a.end || 0));
}

function ledgerPath() {
  return path.join(dataDir(), 'ledger.jsonl');
}

function appendLedger(summary) {
  const { topTools: _t, ...lean } = summary;
  try {
    fs.appendFileSync(ledgerPath(), JSON.stringify({ ...lean, recordedAt: Date.now() }) + '\n');
    // The Stop hook appends once per turn; keep only the latest line per session.
    if (fs.statSync(ledgerPath()).size > 4 * 1024 * 1024) {
      fs.writeFileSync(ledgerPath(), readLedger().map((s) => JSON.stringify(s)).join('\n') + '\n');
    }
  } catch {}
}

function readLedger() {
  const latest = new Map();
  let text = '';
  try {
    text = fs.readFileSync(ledgerPath(), 'utf8');
  } catch {
    return [];
  }
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const s = JSON.parse(line);
      latest.set(s.sessionId, s);
    } catch {}
  }
  return [...latest.values()];
}

// Called from the Stop/SessionEnd hooks: one ledger line per finished turn is
// plenty, and keeps history beyond transcript cleanup.
function recordSession(file) {
  const project = path.basename(path.dirname(file));
  const summary = summarizeSession(file, project);
  if (summary) appendLedger(summary);
  return summary;
}

function spendOn(sessions, day) {
  let total = 0;
  for (const s of sessions) for (const c of Object.values((s.byDay || {})[day] || {})) total += c;
  return total;
}

module.exports = { loadSessions, recordSession, summarizeSession, localDay, spendOn, readLedger };
