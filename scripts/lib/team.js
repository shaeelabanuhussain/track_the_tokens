'use strict';
// Team view. Each developer shares a privacy-safe summary of their sessions
// (`tokenlens share`) to a shared folder; a lead aggregates them
// (`tokenlens team`): spend per person, what it was spent on, how efficiently,
// and whether a bigger token allowance is justified.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig } = require('./config');
const { DELIVERY, PURPOSES } = require('./purpose');
const { displayName } = require('./pricing');

const POLICY_DEFAULTS = {
  monthlyAllowanceUsd: 250, // per developer; override per person in "allowances": { "email": 400 }
  heavyUtilization: 0.8, // using >= 80% of the allowance counts as heavy
  limitHitsForHeavy: 3, // or hitting plan limits this often
  minEfficiency: 65, // cost-weighted efficiency score
  maxAvoidable: 0.3, // share of spend TokenLens flags as avoidable
  minDelivery: 0.6, // share of spend on delivery work (features, bugs, tests, reviews...)
};

function policy() {
  const cfg = loadConfig();
  return { ...POLICY_DEFAULTS, allowances: {}, ...(cfg.team || {}) };
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function identity() {
  const cfg = loadConfig();
  const email = (cfg.developer && cfg.developer.email) || git(['config', '--global', 'user.email']);
  const name = (cfg.developer && cfg.developer.name) || git(['config', '--global', 'user.name']) || os.userInfo().username;
  const role = (cfg.developer && cfg.developer.role) || '';
  return { name, email, role };
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'developer';
}

// Privacy-safe per-session summary: no prompt text unless shareTaskTitles is on.
function shareable(sessions, { days }) {
  const cfg = loadConfig();
  const me = identity();
  return {
    tokenlensShare: 1,
    developer: me,
    generatedAt: new Date().toISOString(),
    days,
    sessions: sessions.map((s) => ({
      id: s.sessionId.slice(0, 8),
      start: s.start,
      end: s.end,
      project: String(s.cwd || s.project).split(/[\\/]/).pop(),
      purpose: s.purpose || 'General Q&A',
      task: cfg.shareTaskTitles ? (s.firstPrompt || '').slice(0, 80) : undefined,
      model: displayName(s.mainModel),
      cost: round(s.cost),
      subCost: round(s.subCost || 0),
      tokens: s.input + s.output + s.cacheRead + s.cacheWrite,
      output: s.output,
      cacheHitRate: round(s.cacheHitRate, 3),
      score: s.score,
      avoidable: round(Math.min(s.cost * 0.6, s.findings.reduce((a, f) => a + f.cost, 0))),
      topLeak: s.findings[0] ? s.findings[0].id : null,
      edits: s.edits || 0,
      limitHits: s.limitHits || 0,
      prompts: s.userPrompts,
    })),
  };
}

function round(n, d = 4) {
  return Math.round((n || 0) * 10 ** d) / 10 ** d;
}

function writeShare(sessions, { days, dir }) {
  const data = shareable(sessions, { days });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug(data.developer.email || data.developer.name) + '.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return { file, data };
}

function readShares(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (d.tokenlensShare && d.developer && Array.isArray(d.sessions)) out.push(d);
    } catch {}
  }
  return out;
}

const LEAK_HINTS = {
  'cache-expired': 'hand off before breaks instead of resuming cold sessions',
  'context-bloat': 'clear or compact between tasks',
  'big-tool-output': 'trim logs and large file reads',
  'repeated-reads': 'stop re-reading the same files',
  'pdf-read': 'convert PDFs to Markdown',
  'model-overkill': 'use Sonnet for routine work',
  'tool-errors': 'document build/test commands in CLAUDE.md',
  'low-cache-hit': 'avoid mid-session model/config switches',
  'subagent-share': 'run research subagents on Haiku',
};

// One developer's figures and verdict over the window.
function assess(share, { days }, pol = policy()) {
  const since = Date.now() - days * 86400000;
  const ss = share.sessions.filter((s) => (s.end || 0) >= since);
  const spend = ss.reduce((a, s) => a + s.cost, 0);
  const activeDays = new Set(ss.map((s) => new Date(s.start || s.end).toISOString().slice(0, 10))).size;
  // Project from the span actually observed (at least a week), not the whole window.
  const first = Math.min(...ss.map((s) => s.start || s.end || Date.now()));
  const span = Math.min(days, Math.max(7, (Date.now() - first) / 86400000));
  const projected = ss.length ? (spend / span) * 30 : 0;
  const dev = share.developer;
  const allowance = pol.allowances[dev.email] || pol.allowances[dev.name] || pol.monthlyAllowanceUsd;
  const utilization = allowance ? projected / allowance : 0;
  const efficiency = spend ? Math.round(ss.reduce((a, s) => a + s.score * s.cost, 0) / spend) : 100;
  const avoidable = ss.reduce((a, s) => a + (s.avoidable || 0), 0);
  const avoidableShare = spend ? avoidable / spend : 0;
  const byPurpose = {};
  for (const s of ss) byPurpose[s.purpose] = (byPurpose[s.purpose] || 0) + s.cost;
  const delivery = Object.entries(byPurpose).reduce((a, [p, c]) => a + (DELIVERY.has(p) ? c : 0), 0);
  const deliveryShare = spend ? delivery / spend : 0;
  const limitHits = ss.reduce((a, s) => a + (s.limitHits || 0), 0);
  const leakCost = {};
  for (const s of ss) if (s.topLeak) leakCost[s.topLeak] = (leakCost[s.topLeak] || 0) + (s.avoidable || 0);
  const topLeak = Object.entries(leakCost).sort((a, b) => b[1] - a[1])[0];
  const prompt = ss.reduce((a, s) => a + s.tokens - s.output, 0);
  const cacheHitRate = prompt ? ss.reduce((a, s) => a + s.cacheHitRate * (s.tokens - s.output), 0) / prompt : 0;

  const heavy = utilization >= pol.heavyUtilization || limitHits >= pol.limitHitsForHeavy;
  const efficient = efficiency >= pol.minEfficiency && avoidableShare <= pol.maxAvoidable;
  const productive = deliveryShare >= pol.minDelivery;
  const reasons = [];
  let verdict;
  let recommendedAllowance = allowance;
  if (!heavy) {
    verdict = 'within';
    reasons.push(`Uses ${pct(utilization)} of the $${allowance}/month allowance`);
    if (!efficient && avoidable > 1) {
      reasons.push(`but ${pct(avoidableShare)} is avoidable${topLeak ? ` (${LEAK_HINTS[topLeak[0]] || topLeak[0]})` : ''}: coaching would save ~$${Math.round((avoidable / span) * 30)}/month`);
    }
  } else if (efficient && productive) {
    verdict = 'eligible';
    recommendedAllowance = Math.ceil(Math.max(projected * 1.25, allowance * 1.5) / 50) * 50;
    reasons.push(`Heavy use (${pct(utilization)} of allowance${limitHits ? `, ${limitHits} plan-limit stops` : ''})`);
    reasons.push(`efficient (score ${efficiency}, ${pct(avoidableShare)} avoidable)`);
    reasons.push(`${pct(deliveryShare)} on delivery work`);
  } else if (!productive) {
    verdict = 'review';
    reasons.push(`Heavy use, but only ${pct(deliveryShare)} on delivery work`);
    const top = Object.entries(byPurpose).sort((a, b) => b[1] - a[1])[0];
    if (top) reasons.push(`largest share: ${top[0]} (${pct(top[1] / spend)})`);
  } else {
    verdict = 'coach';
    reasons.push(`Heavy use, but ${pct(avoidableShare)} of spend is avoidable (score ${efficiency})`);
    if (topLeak) reasons.push(`fix first: ${LEAK_HINTS[topLeak[0]] || topLeak[0]}`);
    reasons.push(`would free ~$${Math.round((avoidable / span) * 30)}/month`);
  }
  return {
    developer: dev,
    sessions: ss.length,
    activeDays,
    spend,
    projected,
    allowance,
    utilization,
    efficiency,
    avoidable,
    avoidableShare,
    cacheHitRate,
    deliveryShare,
    byPurpose,
    limitHits,
    edits: ss.reduce((a, s) => a + (s.edits || 0), 0),
    topLeak: topLeak ? topLeak[0] : null,
    verdict,
    reasons,
    recommendedAllowance,
  };
}

const VERDICTS = {
  eligible: { label: 'Eligible for more tokens', icon: '✅' },
  coach: { label: 'Coach first, then reassess', icon: '🟡' },
  review: { label: 'Review purpose of use', icon: '🔍' },
  within: { label: 'Within allowance', icon: '⚪' },
};

function pct(x) {
  return Math.round(x * 100) + '%';
}

function usd(n) {
  return '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2));
}

function teamMarkdown(rows, { days }) {
  const total = rows.reduce((a, r) => a + r.spend, 0);
  const L = [];
  L.push(`## TokenLens team report, last ${days} days`);
  L.push(`${rows.length} developers · ${usd(total)} spend · ${rows.filter((r) => r.verdict === 'eligible').length} eligible for more tokens`);
  L.push('', '| Developer | Sessions | Spend | /month vs allowance | Efficiency | Avoidable | Main purpose | Verdict |', '|---|---:|---:|---:|---:|---:|---|---|');
  for (const r of rows) {
    const top = Object.entries(r.byPurpose).sort((a, b) => b[1] - a[1])[0];
    const v = VERDICTS[r.verdict];
    L.push(`| ${r.developer.name}${r.developer.role ? ` (${r.developer.role})` : ''} | ${r.sessions} | ${usd(r.spend)} | ${usd(r.projected)} / $${r.allowance} (${pct(r.utilization)}) | ${r.efficiency} | ${pct(r.avoidableShare)} | ${top ? `${top[0]} ${pct(top[1] / (r.spend || 1))}` : '-'} | ${v.icon} ${v.label} |`);
  }
  L.push('', '### Decisions');
  for (const r of rows) {
    const v = VERDICTS[r.verdict];
    const extra = r.verdict === 'eligible' ? ` → raise allowance to **$${r.recommendedAllowance}/month**` : '';
    L.push(`- **${r.developer.name}**: ${v.icon} ${v.label}${extra}. ${r.reasons.join('; ')}.`);
  }
  const purposes = {};
  for (const r of rows) for (const [p, c] of Object.entries(r.byPurpose)) purposes[p] = (purposes[p] || 0) + c;
  L.push('', '### What the team spends tokens on');
  L.push(Object.entries(purposes).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p} ${usd(c)} (${pct(c / (total || 1))})`).join(' · '));
  L.push('', '_Eligibility policy: heavy use (≥80% of allowance or repeated plan-limit stops) AND efficient (score ≥65, ≤30% avoidable) AND ≥60% delivery work. Thresholds are configurable._');
  return L.join('\n');
}

module.exports = { writeShare, readShares, assess, teamMarkdown, identity, policy, VERDICTS, PURPOSES, POLICY_DEFAULTS };
