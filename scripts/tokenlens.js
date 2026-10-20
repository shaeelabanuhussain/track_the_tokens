#!/usr/bin/env node
'use strict';
// TokenLens CLI: statusline, hook handlers and reports.
// Usage: node tokenlens.js <command> [options]   (run "help" for the list)

const fs = require('fs');
const path = require('path');
const { listSessionFiles, parseTranscript, contextLimitFor } = require('./lib/transcripts');
const { diagnose, score, fmtK, pct, shortPath } = require('./lib/insights');
const { loadSessions, recordSession, spendOn, localDay } = require('./lib/store');
const { loadConfig, dataDir } = require('./lib/config');
const { timingAdvice } = require('./lib/timing');
const { nextTip, BEST_PRACTICES } = require('./lib/tips');
const { priceFor, displayName } = require('./lib/pricing');
const pdf2md = require('./lib/pdf2md');

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const flag = (name, def = null) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const usd = (n) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2));

const C = process.env.NO_COLOR
  ? new Proxy({}, { get: () => (s) => s })
  : {
      dim: (s) => `\x1b[2m${s}\x1b[22m`,
      bold: (s) => `\x1b[1m${s}\x1b[22m`,
      green: (s) => `\x1b[32m${s}\x1b[39m`,
      yellow: (s) => `\x1b[33m${s}\x1b[39m`,
      red: (s) => `\x1b[31m${s}\x1b[39m`,
      cyan: (s) => `\x1b[36m${s}\x1b[39m`,
      magenta: (s) => `\x1b[35m${s}\x1b[39m`,
    };

function readStdin() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function projectSlug(cwd) {
  return String(cwd || process.cwd()).replace(/[^a-zA-Z0-9]/g, '-');
}

// Resolve a transcript: explicit path/id, else the newest one for this directory.
function resolveTranscript(input = {}) {
  if (input.transcript_path && fs.existsSync(input.transcript_path)) return input.transcript_path;
  const id = flag('session') || input.session_id;
  const files = listSessionFiles();
  const slug = projectSlug(input.cwd);
  if (id && id !== true) {
    // The same id can exist in two projects (e.g. a headless run that inherited it): prefer this directory.
    const hits = files.filter((f) => f.sessionId === id || f.sessionId.startsWith(id));
    const hit = hits.find((f) => f.project === slug) || hits[0];
    if (hit) return hit.file;
  }
  const local = files.find((f) => f.project === slug);
  return (local || files[0] || {}).file || null;
}

// ---------------------------------------------------------------- statusline

function cmdStatusline() {
  const input = readStdin();
  const cfg = loadConfig();
  const file = resolveTranscript(input);
  const s = file ? parseTranscript(file) : null;
  const model = (input.model && input.model.id) || (s && s.mainModel) || '';
  const limit = (input.context_window && input.context_window.context_window_size) || contextLimitFor(model);
  const ctxTokens = s ? s.lastContext : 0;
  const ctxPct =
    input.context_window && input.context_window.used_percentage != null
      ? Math.round(input.context_window.used_percentage)
      : Math.round((ctxTokens / limit) * 100);

  const mainCost = s ? s.cost : (input.cost && input.cost.total_cost_usd) || 0;
  const subCost = s ? s.subagents.reduce((a, x) => a + x.cost, 0) : 0;
  let dayCost = 0;
  try {
    dayCost = spendOn(loadSessions({ days: 2 }), localDay(Date.now()));
  } catch {}

  const pc = input.prompt_cache || {};
  const nowSec = Date.now() / 1000;
  const lastTs = s && s.end ? s.end : null;
  const ttlMs = s && s.turns.some((t) => t.cacheWrite1h > 0) ? 3600000 : 300000;
  const cacheCold = pc.expires_at ? pc.expires_at < nowSec : lastTs ? Date.now() - lastTs > ttlMs : false;
  const p = priceFor(model);
  const recacheUsd = (ctxTokens * p.input * (ttlMs > 300000 ? 2 : 1.25)) / 1e6;
  const timing = timingAdvice();

  const tip = nextTip({
    contextPct: ctxPct,
    contextTokens: ctxTokens,
    sessionCost: mainCost + subCost,
    budget: cfg.budgetPerSession,
    dayCost,
    dayBudget: cfg.budgetPerDay,
    cacheCold,
    recacheUsd,
    peak: timing.peakNow,
    warnPct: cfg.contextWarnPct,
  });

  const bar = (n) => {
    const filled = Math.min(10, Math.round(n / 10));
    const b = '▰'.repeat(filled) + '▱'.repeat(10 - filled);
    return n >= 80 ? C.red(b) : n >= cfg.contextWarnPct ? C.yellow(b) : C.green(b);
  };
  const costColor = (n, budget) => (n >= budget ? C.red : n >= budget * 0.6 ? C.yellow : C.green);

  const hit = s ? s.cacheHitRate : pc.hit_ratio || 0;
  const parts = [
    C.magenta(C.bold('◆ TokenLens')),
    C.cyan(displayName(model)),
    `${costColor(mainCost + subCost, cfg.budgetPerSession)(usd(mainCost + subCost))} session${subCost > 0.005 ? C.dim(` (agents ${usd(subCost)})`) : ''}`,
    `${costColor(dayCost, cfg.budgetPerDay)(usd(dayCost))} today`,
    `ctx ${bar(ctxPct)} ${ctxPct}% ${C.dim(fmtK(ctxTokens))}`,
    `cache ${hit >= 0.8 ? C.green(pct(hit)) : C.yellow(pct(hit))}${cacheCold ? C.red(' cold') : ''}`,
  ];
  const rl = input.rate_limits || {};
  const line2 = [];
  line2.push(timing.peakNow ? C.yellow('⏰ ' + timing.short) : C.green('⏰ ' + timing.short));
  if (rl.five_hour && rl.five_hour.used_percentage != null) {
    const u = Math.round(rl.five_hour.used_percentage);
    line2.push(`5h limit ${u >= 80 ? C.red(u + '%') : u >= 50 ? C.yellow(u + '%') : u + '%'}`);
  }
  if (rl.seven_day && rl.seven_day.used_percentage != null) line2.push(`week ${Math.round(rl.seven_day.used_percentage)}%`);
  const tipText = tip.level === 'alert' ? C.red('⚠ ' + tip.text) : tip.level === 'warn' ? C.yellow('💡 ' + tip.text) : C.dim('💡 ' + tip.text);
  line2.push(tipText);

  process.stdout.write(parts.join(C.dim(' │ ')) + '\n' + line2.join(C.dim(' │ ')) + '\n');
}

// ---------------------------------------------------------------- hooks

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function cmdHook() {
  const event = args[1];
  const input = readStdin();
  const cfg = loadConfig();
  try {
    if (event === 'session-start') return hookSessionStart(input, cfg);
    if (event === 'pre-read') return hookPreRead(input, cfg);
    if (event === 'prompt') return hookPrompt(input, cfg);
    if (event === 'stop') return hookStop(input, cfg);
    if (event === 'session-end') return hookSessionEnd(input);
  } catch (e) {
    // Hooks fail open: never block the developer because of TokenLens.
    if (process.env.TOKENLENS_DEBUG) process.stderr.write(String(e.stack || e));
  }
}

function hookSessionStart(input, cfg) {
  if (!cfg.sessionStartBanner) return;
  const sessions = loadSessions({ days: 2 });
  const today = spendOn(sessions, localDay(Date.now()));
  const last = sessions.find((s) => s.sessionId !== input.session_id);
  const timing = timingAdvice();
  const bits = [`TokenLens: today ${usd(today)}`];
  if (last) bits.push(`last session ${usd(last.cost)} (efficiency ${last.score}/100${last.findings[0] ? `, top leak: ${last.findings[0].title}` : ''})`);
  bits.push(timing.peakNow ? `⏰ ${timing.short}` : '⏰ off-peak: good time for heavy work');
  if (input.source === 'resume' && input.prompt_cache_likely_expired && input.context_tokens > 50000) {
    const cost = input.estimated_cache_write_usd ? ` (~${usd(input.estimated_cache_write_usd)})` : '';
    bits.push(`⚠ resumed a ${fmtK(input.context_tokens)}-token session with a cold cache: your first message re-writes it${cost}. A fresh session + handoff is often cheaper.`);
  }
  const claudeMd = path.join(input.cwd || process.cwd(), 'CLAUDE.md');
  try {
    const lines = fs.readFileSync(claudeMd, 'utf8').split('\n').length;
    if (lines > 200) bits.push(`CLAUDE.md is ${lines} lines (loads every call; aim for <200).`);
  } catch {}
  // systemMessage is shown to the user only: TokenLens adds zero tokens to Claude's context here.
  out({ systemMessage: bits.join(' · ') });
}

function hookPreRead(input, cfg) {
  if (!cfg.pdfAutoConvert) return;
  const ti = input.tool_input || {};
  const file = ti.file_path;
  if (!file || !/\.pdf$/i.test(file) || !fs.existsSync(file)) return;
  if (ti.pages) return; // an explicit page range was asked for: respect it
  let r;
  try {
    r = pdf2md.convert(file);
  } catch {
    return; // no text layer (scanned PDF): let Claude read it as images
  }
  out({
    systemMessage: `TokenLens: converted ${path.basename(file)} → ${path.basename(r.mdPath)} (~${fmtK(r.mdTokens)} instead of ~${fmtK(r.pdfTokens)} tokens, ${pct(r.savedPct)} saved)`,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `TokenLens converted this PDF to Markdown to save ~${fmtK(r.savedTokens)} tokens. Read ${r.mdPath} instead. If you truly need page images (charts, scans), Read the PDF with an explicit pages range.`,
    },
  });
}

function hookPrompt(input, cfg) {
  const msgs = [];
  const prompt = String(input.prompt || '');
  // Plain PDF paths in the prompt (not @-attached): convert up front.
  const added = [];
  for (const m of prompt.matchAll(/(?:^|[\s"'`(])((?:[~.]?\/)?[^\s"'`()]+\.pdf)\b/gi)) {
    let p = m[1].replace(/^~/, require('os').homedir());
    p = path.resolve(input.cwd || process.cwd(), p);
    if (!cfg.pdfAutoConvert || !fs.existsSync(p)) continue;
    try {
      const r = pdf2md.convert(p);
      added.push(`${m[1]} is available as Markdown at ${r.mdPath}; read that instead of the PDF.`);
      msgs.push(`📄 ${path.basename(p)} → Markdown (${pct(r.savedPct)} fewer tokens)`);
    } catch {}
  }

  const file = resolveTranscript(input);
  if (file) {
    const s = parseTranscript(file, { includeSubagents: true });
    const total = s.total.cost;
    const limit = contextLimitFor(s.mainModel);
    const ctxPct = Math.round((s.lastContext / limit) * 100);
    const idleMs = s.end ? Date.now() - s.end : 0;
    const ttl = s.turns.some((t) => t.cacheWrite1h > 0) ? 3600000 : 300000;
    if (cfg.idleCacheWarn && idleMs > ttl && s.lastContext > 50000) {
      const p = priceFor(s.mainModel);
      const cost = (s.lastContext * p.input * (ttl > 300000 ? 2 : 1.25)) / 1e6;
      msgs.push(`⚠ You were away ${Math.round(idleMs / 60000)} min, so the prompt cache expired: this message re-writes ${fmtK(s.lastContext)} tokens (~${usd(cost)}). Next time, /tokenlens:handoff before a break.`);
    }
    if (ctxPct >= 80) msgs.push(`⚠ Context ${ctxPct}% full. Run /compact or /tokenlens:handoff + /clear soon.`);
    else if (ctxPct >= cfg.contextWarnPct) msgs.push(`💡 Context ${ctxPct}%: consider "/compact <what to keep>".`);
    const budget = cfg.budgetPerSession;
    if (budget && total >= budget) msgs.push(`💸 This session has cost ${usd(total)} (budget ${usd(budget)}).`);
  }

  const res = {};
  if (msgs.length) res.systemMessage = 'TokenLens: ' + msgs.join(' · ');
  if (added.length) res.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', additionalContext: added.join('\n') };
  if (Object.keys(res).length) out(res);
}

function hookStop(input, cfg) {
  const file = resolveTranscript(input);
  if (!file) return;
  const before = readMark(input.session_id);
  const summary = recordSession(file);
  if (!summary) return;
  writeMark(input.session_id, summary.cost);
  // Tell the user once when a budget line is crossed.
  const budget = cfg.budgetPerSession;
  if (budget && before < budget && summary.cost >= budget) {
    out({ systemMessage: `TokenLens: this session just passed your ${usd(budget)} budget (${usd(summary.cost)}). /tokenlens:report shows where it went.` });
  }
}

function hookSessionEnd(input) {
  const file = resolveTranscript(input);
  if (file) recordSession(file);
}

function markFile(id) {
  return path.join(dataDir(), 'marks', `${String(id || 'unknown').replace(/[^\w-]/g, '')}.json`);
}
function readMark(id) {
  try {
    return JSON.parse(fs.readFileSync(markFile(id), 'utf8')).cost || 0;
  } catch {
    return 0;
  }
}
function writeMark(id, cost) {
  try {
    fs.mkdirSync(path.dirname(markFile(id)), { recursive: true });
    fs.writeFileSync(markFile(id), JSON.stringify({ cost }));
  } catch {}
}

// ---------------------------------------------------------------- reports

function cmdReport() {
  const file = resolveTranscript({ cwd: process.cwd() });
  if (!file) return console.log('No Claude Code sessions found.');
  const s = parseTranscript(file);
  const findings = diagnose(s);
  if (flag('json')) return console.log(JSON.stringify({ ...s, turns: undefined, toolCalls: undefined, findings }, null, 2));
  const sc = score(s, findings);
  const limit = contextLimitFor(s.mainModel);
  const dur = s.start && s.end ? Math.round((s.end - s.start) / 60000) : 0;
  const L = [];
  L.push(`## TokenLens session report`);
  L.push(`Session \`${s.sessionId.slice(0, 8)}\` · ${displayName(s.mainModel)} · ${dur} min · ${s.userPrompts} prompts · ${s.total.apiCalls} API calls`);
  L.push('');
  L.push(`| Metric | Value |`);
  L.push(`|---|---|`);
  L.push(`| **Total cost** | **${usd(s.total.cost)}** (main ${usd(s.cost)}${s.subagents.length ? `, ${s.subagents.length} subagents ${usd(s.total.cost - s.cost)}` : ''}) |`);
  L.push(`| Efficiency score | ${sc}/100 |`);
  L.push(`| Input (uncached) | ${fmtK(s.total.input)} |`);
  L.push(`| Cache writes / reads | ${fmtK(s.total.cacheWrite)} / ${fmtK(s.total.cacheRead)} (hit rate ${pct(s.cacheHitRate)}) |`);
  L.push(`| Output | ${fmtK(s.total.output)} |`);
  L.push(`| Context now / peak | ${fmtK(s.lastContext)} / ${fmtK(s.peakContext)} of ${fmtK(limit)} |`);
  const tools = {};
  for (const c of s.toolCalls) {
    const t = (tools[c.name] = tools[c.name] || { n: 0, tok: 0 });
    t.n++;
    t.tok += c.tokens;
  }
  const topT = Object.entries(tools).sort((a, b) => b[1].tok - a[1].tok).slice(0, 5);
  if (topT.length) {
    L.push('', `**Where the context went (tool output):** ` + topT.map(([n, t]) => `${n} ${t.n}x ~${fmtK(t.tok)}`).join(' · '));
  }
  if (s.subagents.length) {
    L.push('', `**Subagents:** ` + s.subagents.sort((a, b) => b.cost - a.cost).slice(0, 5).map((x) => `${x.label} ${usd(x.cost)}`).join(' · '));
  }
  L.push('', findings.length ? '### Top cost leaks' : '### No significant leaks found. Nice, lean session.');
  findings.slice(0, 5).forEach((f, i) => {
    L.push(`${i + 1}. **${f.title}**${f.cost >= 0.01 ? ` (~${usd(f.cost)})` : ''}: ${f.evidence}`);
    L.push(`   → ${f.fix}`);
  });
  L.push('', `⏰ ${timingAdvice().advice}`);
  console.log(L.join('\n'));
}

function cmdSessions() {
  const days = Number(flag('days', 7));
  const sessions = loadSessions({ days, project: flag('project') === true ? null : flag('project') });
  if (flag('json')) return console.log(JSON.stringify(sessions, null, 2));
  const total = sessions.reduce((a, s) => a + s.cost, 0);
  const L = [`## Sessions, last ${days} days: ${sessions.length} sessions, ${usd(total)}`, '', '| When | Project | Task | Model | Cost | Score | Top leak |', '|---|---|---|---|---:|---:|---|'];
  for (const s of sessions.slice(0, Number(flag('limit', 20)))) {
    const when = s.end ? new Date(s.end).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const proj = shortPath(s.cwd || s.project);
    const task = (s.firstPrompt || '').slice(0, 40).replace(/\|/g, '/');
    L.push(`| ${when} | ${proj} | ${task} | ${displayName(s.mainModel)} | ${usd(s.cost)} | ${s.score} | ${s.findings[0] ? s.findings[0].title : '-'} |`);
  }
  console.log(L.join('\n'));
}

function cmdDiagnose() {
  const days = Number(flag('days', 7));
  const sessions = loadSessions({ days });
  const agg = {};
  for (const s of sessions) {
    for (const f of s.findings) {
      const a = (agg[f.id] = agg[f.id] || { title: f.title.replace(/^\d+\s*/, ''), fix: f.fix, cost: 0, sessions: 0 });
      a.cost += f.cost;
      a.sessions++;
    }
  }
  const total = sessions.reduce((a, s) => a + s.cost, 0);
  const list = Object.entries(agg).sort((a, b) => b[1].cost - a[1].cost);
  const waste = list.reduce((a, [, x]) => a + x.cost, 0);
  const L = [`## TokenLens diagnosis, last ${days} days`, `${sessions.length} sessions · spend ${usd(total)} · avoidable ≈ ${usd(waste)} (${total ? pct(waste / total) : '0%'})`, ''];
  list.forEach(([id, x], i) => {
    L.push(`${i + 1}. **${LEAK_NAMES[id] || x.title}**: ~${usd(x.cost)} across ${x.sessions} session(s)`);
    L.push(`   → ${x.fix}`);
  });
  if (!list.length) L.push('No recurring leaks found.');
  console.log(L.join('\n'));
}

const LEAK_NAMES = {
  'cache-expired': 'Prompt cache expired after breaks',
  'context-bloat': 'Oversized context carried turn after turn',
  'big-tool-output': 'Huge tool outputs (file reads, logs, command output)',
  'repeated-reads': 'Same files re-read many times',
  'pdf-read': 'PDFs read raw instead of as Markdown',
  'model-overkill': 'Opus used for small, simple replies',
  'tool-errors': 'Failed tool calls and retries',
  'low-cache-hit': 'Low prompt-cache hit rate',
  marathon: 'Marathon sessions (many prompts / compactions)',
  'subagent-share': 'Subagent-heavy sessions',
};

function cmdTips() {
  const t = timingAdvice();
  const L = ['## Claude Code token best practices', ''];
  let area = '';
  for (const b of BEST_PRACTICES) {
    if (b.area !== area) L.push(`**${(area = b.area)}**`);
    L.push(`- ${b.tip}`);
  }
  L.push('', `**Timing:** ${t.advice}`);
  console.log(L.join('\n'));
}

function cmdTiming() {
  console.log(timingAdvice().advice);
}

function cmdPdf() {
  const file = args[1];
  if (!file) return console.log('Usage: tokenlens pdf2md <file.pdf> [--force]');
  try {
    const r = pdf2md.convert(file, { force: !!flag('force') });
    console.log(`✓ ${r.mdPath}\n  ${r.pages} page(s) · ~${fmtK(r.pdfTokens)} tokens as PDF → ~${fmtK(r.mdTokens)} as Markdown (${pct(r.savedPct)} saved) · engine: ${r.engine}`);
  } catch (e) {
    console.log(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}

function cmdDashboard() {
  const days = Number(flag('days', 30));
  const sessions = loadSessions({ days });
  const html = require('./lib/dashboard').render(sessions, { days, timing: timingAdvice(), leakNames: LEAK_NAMES, tips: BEST_PRACTICES });
  const outFile = flag('out') && flag('out') !== true ? path.resolve(flag('out')) : path.join(dataDir(), 'dashboard.html');
  fs.writeFileSync(outFile, html);
  console.log(`✓ Dashboard written: ${outFile}`);
  if (flag('open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      require('child_process').spawn(opener, [outFile], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
    } catch {}
  }
}

function cmdExport() {
  const days = Number(flag('days', 30));
  const format = flag('format', 'focus');
  const sessions = loadSessions({ days });
  const text = require('./lib/export')[format === 'otel' ? 'toOtel' : format === 'json' ? 'toJson' : 'toFocus'](sessions);
  const outFile = flag('out');
  if (outFile && outFile !== true) {
    fs.writeFileSync(outFile, text);
    console.log(`✓ Wrote ${format} export (${sessions.length} sessions) to ${outFile}`);
  } else process.stdout.write(text);
}

function cmdSetup() {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude');
  const settingsFile = flag('project') ? path.join(process.cwd(), '.claude', 'settings.json') : path.join(home, 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {}
  const script = path.resolve(__dirname, 'tokenlens.js').split(path.sep).join('/');
  if (flag('uninstall')) {
    if (settings.statusLine && String(settings.statusLine.command).includes('tokenlens')) delete settings.statusLine;
  } else {
    if (settings.statusLine && !String(settings.statusLine.command).includes('tokenlens') && !flag('force')) {
      console.log(`A statusLine is already configured (${settings.statusLine.command}). Re-run with --force to replace it.`);
      return;
    }
    settings.statusLine = { type: 'command', command: `node "${script}" statusline`, padding: 0, refreshInterval: 10 };
  }
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  if (fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, settingsFile + '.tokenlens.bak');
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  const cfgFile = path.join(dataDir(), 'config.json');
  if (!fs.existsSync(cfgFile)) fs.writeFileSync(cfgFile, JSON.stringify(require('./lib/config').DEFAULTS, null, 2) + '\n');
  console.log(flag('uninstall') ? `✓ Removed TokenLens statusline from ${settingsFile}` : `✓ TokenLens statusline enabled in ${settingsFile} (backup: settings.json.tokenlens.bak)\n✓ Budgets and options: ${cfgFile}`);
}

function cmdBudget() {
  const cfgFile = path.join(dataDir(), 'config.json');
  const cfg = loadConfig();
  if (args[1]) cfg.budgetPerSession = Number(args[1]);
  if (args[2]) cfg.budgetPerDay = Number(args[2]);
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`Budget: ${usd(cfg.budgetPerSession)} per session, ${usd(cfg.budgetPerDay)} per day (${cfgFile})`);
}

function cmdWhatif() {
  const days = Number(flag('days', 30));
  const sessions = loadSessions({ days });
  const r = require('./lib/export').whatIf(sessions);
  console.log(
    [
      `## What-if, last ${days} days (actual ${usd(r.actual)})`,
      `- Fix the detected leaks: **${usd(r.actual - r.withoutLeaks)} saved** (${pct(1 - r.withoutLeaks / (r.actual || 1))})`,
      `- Route Opus work to Sonnet where possible (est. half of Opus spend): **${usd(r.routingSaving)} saved**`,
      `- Raise cache hit rate to 90%: **${usd(r.cacheSaving)} saved**`,
      `- All three: ≈ **${usd(r.combined)}** instead of ${usd(r.actual)}`,
    ].join('\n'),
  );
}

function cmdHelp() {
  console.log(`TokenLens: observe, diagnose and optimize Claude Code token spend.

  report [--session ID] [--json]   This session: cost, tokens, cache, leaks + fixes
  sessions [--days 7] [--project]  Recent sessions with cost and efficiency score
  diagnose [--days 7]              Recurring cost leaks across sessions, in dollars
  dashboard [--days 30] [--open]   Self-contained HTML dashboard
  whatif [--days 30]               Savings if leaks, routing and caching were fixed
  export --format focus|otel|json  FinOps export (FOCUS 1.x CSV, OTel GenAI JSON)
  pdf2md <file.pdf>                Convert a PDF to Markdown and show token savings
  tips | timing                    Best practices | peak / off-peak advice
  budget <session$> [day$]         Set budgets used by warnings
  setup [--project] [--uninstall]  Enable the TokenLens statusline
  statusline | hook <event>        Used by Claude Code`);
}

const commands = {
  statusline: cmdStatusline,
  hook: cmdHook,
  report: cmdReport,
  sessions: cmdSessions,
  diagnose: cmdDiagnose,
  tips: cmdTips,
  timing: cmdTiming,
  pdf2md: cmdPdf,
  dashboard: cmdDashboard,
  export: cmdExport,
  setup: cmdSetup,
  budget: cmdBudget,
  whatif: cmdWhatif,
  help: cmdHelp,
};

(commands[cmd] || cmdHelp)();
