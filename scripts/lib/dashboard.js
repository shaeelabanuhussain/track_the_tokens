'use strict';
// Self-contained HTML dashboard (no CDN, works offline). Data is embedded as
// JSON; charts are drawn as inline SVG by a small script in the page.

const { displayName } = require('./pricing');
const { whatIf } = require('./export');

function render(sessions, { days, timing, leakNames, tips }) {
  const data = {
    generatedAt: Date.now(),
    days,
    timing,
    leakNames,
    tips,
    whatIf: whatIf(sessions),
    sessions: sessions.map((s) => ({
      id: s.sessionId,
      project: String(s.cwd || s.project).split(/[\\/]/).slice(-2).join('/'),
      branch: s.gitBranch || '',
      task: (s.firstPrompt || '').slice(0, 140),
      start: s.start,
      end: s.end,
      model: displayName(s.mainModel),
      models: Object.fromEntries(Object.entries(s.models || {}).map(([m, u]) => [displayName(m), u.cost])),
      cost: s.cost,
      subCost: s.subCost || 0,
      input: s.input,
      output: s.output,
      cacheRead: s.cacheRead,
      cacheWrite: s.cacheWrite,
      hit: s.cacheHitRate,
      peak: s.peakContext,
      prompts: s.userPrompts,
      calls: s.apiCalls,
      score: s.score,
      findings: s.findings,
      subagents: s.subagents || [],
      byDay: Object.fromEntries(Object.entries(s.byDay || {}).map(([d, m]) => [d, Object.fromEntries(Object.entries(m).map(([k, v]) => [displayName(k), v]))])),
      byHour: s.byHour || {},
    })),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return TEMPLATE.replace('__DATA__', json);
}

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TokenLens Dashboard</title>
<style>
:root {
  color-scheme: light;
  --bg: #f6f6f4; --surface-1: #fcfcfb; --surface-2: #f0efec; --border: #e2e1dc;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #7a7974;
  --accent: #2a78d6; --peak: rgba(237,161,0,.16);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #6250d6; --s8: #e34948;
  --good: #008300; --warn: #b87800; --bad: #d03b3b;
  --seq-0: #cde2fb; --seq-1: #86b6ef; --seq-2: #3987e5; --seq-3: #1c5cab; --seq-4: #0d366b;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #111110; --surface-1: #1a1a19; --surface-2: #232321; --border: #33332f;
    --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
    --accent: #3987e5; --peak: rgba(201,133,0,.18);
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
    --good: #3fb950; --warn: #d6a01e; --bad: #f06a6a;
    --seq-0: #104281; --seq-1: #1c5cab; --seq-2: #3987e5; --seq-3: #6da7ec; --seq-4: #b7d3f6;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #111110; --surface-1: #1a1a19; --surface-2: #232321; --border: #33332f;
  --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
  --accent: #3987e5; --peak: rgba(201,133,0,.18);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
  --good: #3fb950; --warn: #d6a01e; --bad: #f06a6a;
  --seq-0: #104281; --seq-1: #1c5cab; --seq-2: #3987e5; --seq-3: #6da7ec; --seq-4: #b7d3f6;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text-primary); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { padding: 20px 24px 8px; display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; justify-content: space-between; max-width: 1280px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0; letter-spacing: -.01em; }
h1 span { color: var(--accent); }
h2 { font-size: 15px; margin: 0 0 12px; }
.sub { color: var(--text-secondary); font-size: 13px; }
main { max-width: 1280px; margin: 0 auto; padding: 8px 24px 40px; display: grid; gap: 16px; }
.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; min-width: 0; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.kpi .label { color: var(--text-secondary); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.kpi .value { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; margin-top: 2px; }
.kpi .note { color: var(--text-muted); font-size: 12px; }
.grid2 { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; }
@media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } header, main { padding-left: 16px; padding-right: 16px; } }
.banner { border-radius: 12px; padding: 12px 16px; border: 1px solid var(--border); background: var(--surface-2); display: flex; gap: 10px; align-items: center; }
.banner b { white-space: nowrap; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
svg text { fill: var(--text-secondary); font-size: 11px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.tip { position: fixed; pointer-events: none; background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.15); display: none; z-index: 10; max-width: 280px; }
.leak { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 10px 0; border-top: 1px solid var(--border); }
.leak:first-of-type { border-top: 0; }
.leak .t { font-weight: 600; }
.leak .c { font-variant-numeric: tabular-nums; font-weight: 650; }
.leak .f { grid-column: 1 / -1; color: var(--text-secondary); font-size: 13px; }
.leak .bar { grid-column: 1 / -1; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.leak .bar span { display: block; height: 100%; background: var(--s2); border-radius: 3px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 8px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-secondary); font-weight: 600; font-size: 12px; cursor: pointer; user-select: none; white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.row { cursor: pointer; }
tr.row:hover td { background: var(--surface-2); }
tr.detail td { background: var(--surface-2); color: var(--text-secondary); }
.scroll { overflow-x: auto; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid currentColor; }
.good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); }
.task { color: var(--text-secondary); max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
input[type=search] { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-primary); border-radius: 8px; padding: 6px 10px; min-width: 220px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.tips { columns: 2 320px; column-gap: 24px; padding-left: 18px; margin: 0; }
.tips li { margin: 0 0 8px; break-inside: avoid; }
.tips b { color: var(--text-secondary); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
.whatif div { display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid var(--border); }
.whatif div:first-child { border-top: 0; }
.whatif .total { font-weight: 700; }
button.theme { background: var(--surface-2); color: var(--text-primary); border: 1px solid var(--border); border-radius: 8px; padding: 4px 10px; cursor: pointer; }
details summary { cursor: pointer; color: var(--text-secondary); font-size: 12px; margin-top: 8px; }
.empty { color: var(--text-muted); padding: 24px; text-align: center; }
</style>
</head>
<body>
<header>
  <div><h1>◆ Token<span>Lens</span></h1><div class="sub" id="range"></div></div>
  <div class="sub">Observe · Diagnose · Optimize &nbsp; <button class="theme" id="theme" aria-label="Toggle dark mode">◐</button></div>
</header>
<main>
  <div class="banner" id="timing"></div>
  <section class="kpis" id="kpis"></section>
  <section class="grid2">
    <div class="card"><h2>Daily spend by model</h2><div class="legend" id="dailyLegend"></div><div id="daily"></div>
      <details><summary>Show as table</summary><div class="scroll" id="dailyTable"></div></details></div>
    <div class="card"><h2>Biggest cost leaks <span class="sub">· estimated avoidable spend</span></h2><div id="leaks"></div></div>
  </section>
  <section class="grid2">
    <div class="card"><h2>When you spend <span class="sub">· by hour of day (your time). Shaded = peak hours, when plan limits drain faster</span></h2><div id="hours"></div></div>
    <div class="card"><h2>What if… <span class="sub">· estimated savings over this period</span></h2><div class="whatif" id="whatif"></div></div>
  </section>
  <section class="card">
    <div class="toolbar"><h2 style="margin:0">Sessions</h2><input type="search" id="q" placeholder="Filter by project, task, model…" aria-label="Filter sessions"></div>
    <div class="scroll"><table id="sessions"></table></div>
  </section>
  <section class="card"><h2>Best practices</h2><ul class="tips" id="tips"></ul></section>
</main>
<div class="tip" id="tip" role="tooltip"></div>
<script>
const D = __DATA__;
const $ = (id) => document.getElementById(id);
const usd = (n) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2));
const k = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n || 0));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const S = D.sessions;
const tip = $('tip');
function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
function hideTip() { tip.style.display = 'none'; }

// theme toggle
$('theme').onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('tl-theme', r.dataset.theme); } catch (e) {} };
try { const t = localStorage.getItem('tl-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

$('range').textContent = 'Last ' + D.days + ' days · ' + S.length + ' sessions · generated ' + new Date(D.generatedAt).toLocaleString();
$('timing').innerHTML = (D.timing.peakNow ? '<b class="warn">⏰ Peak hours</b>' : '<b class="good">⏰ Off-peak</b>') + '<span>' + esc(D.timing.advice) + '</span>';

// KPIs
const total = S.reduce((a, s) => a + s.cost, 0);
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const today = dayKey(Date.now());
const todayCost = S.reduce((a, s) => a + Object.values(s.byDay[today] || {}).reduce((x, y) => x + y, 0), 0);
const prompt = S.reduce((a, s) => a + s.input + s.cacheRead + s.cacheWrite, 0);
const hit = prompt ? S.reduce((a, s) => a + s.cacheRead, 0) / prompt : 0;
const waste = S.reduce((a, s) => a + Math.min(s.cost * 0.6, s.findings.reduce((x, f) => x + f.cost, 0)), 0);
const avgScore = S.length ? Math.round(S.reduce((a, s) => a + s.score, 0) / S.length) : 100;
const kpis = [
  ['Spend', usd(total), 'last ' + D.days + ' days'],
  ['Today', usd(todayCost), new Date().toLocaleDateString()],
  ['Sessions', S.length, S.length ? usd(total / S.length) + ' avg / session' : ''],
  ['Tokens', k(prompt + S.reduce((a, s) => a + s.output, 0)), k(S.reduce((a, s) => a + s.output, 0)) + ' output'],
  ['Cache hit rate', Math.round(hit * 100) + '%', hit >= 0.8 ? 'healthy' : 'below 80% target'],
  ['Avoidable', usd(waste), total ? Math.round(waste / total * 100) + '% of spend' : ''],
  ['Efficiency', avgScore + '/100', 'average session score'],
];
$('kpis').innerHTML = kpis.map(([l, v, n]) => '<div class="card kpi"><div class="label">' + l + '</div><div class="value">' + v + '</div><div class="note">' + esc(n) + '</div></div>').join('');

// Daily stacked bars, models in fixed order by total spend
const days = [];
for (let i = Math.min(D.days, 30) - 1; i >= 0; i--) days.push(dayKey(Date.now() - i * 86400000));
const modelTotals = {};
S.forEach((s) => Object.values(s.byDay).forEach((m) => Object.entries(m).forEach(([mm, c]) => (modelTotals[mm] = (modelTotals[mm] || 0) + c))));
let models = Object.keys(modelTotals).sort((a, b) => modelTotals[b] - modelTotals[a]);
if (models.length > 7) models = models.slice(0, 7).concat(['Other']);
const color = (m) => m === 'Other' ? 'var(--text-muted)' : 'var(--s' + (models.indexOf(m) + 1) + ')';
const daily = days.map((d) => { const row = { d, total: 0 }; models.forEach((m) => (row[m] = 0)); S.forEach((s) => Object.entries(s.byDay[d] || {}).forEach(([m, c]) => { const key = models.includes(m) ? m : 'Other'; row[key] += c; row.total += c; })); return row; });
$('dailyLegend').innerHTML = models.map((m) => '<span><i style="background:' + color(m) + '"></i>' + esc(m) + '</span>').join('');
(function drawDaily() {
  const W = 640, H = 220, L = 44, B = 22, T = 8;
  const max = Math.max(0.01, ...daily.map((r) => r.total));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const bw = (W - L) / daily.length;
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) { const y = T + (H - T - B) * (1 - v / top); g += '<line x1="' + L + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="var(--border)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + usd(v) + '</text>'; }
  daily.forEach((r, i) => {
    let y = H - B;
    const x = L + i * bw + bw * 0.15, w = Math.max(2, bw * 0.7);
    models.forEach((m) => { if (!r[m]) return; const h = (H - T - B) * r[m] / top; y -= h; g += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + Math.max(0, h - 2) + '" rx="3" fill="' + color(m) + '"/>'; });
    g += '<rect class="hit" data-i="' + i + '" x="' + (L + i * bw) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" fill="transparent"/>';
    if (i % Math.ceil(daily.length / 8) === 0 || i === daily.length - 1) g += '<text x="' + (x + w / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + r.d.slice(5) + '</text>';
  });
  $('daily').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily spend by model">' + g + '</svg>';
  $('daily').querySelectorAll('.hit').forEach((el) => { el.onmousemove = (e) => { const r = daily[el.dataset.i]; showTip(e, '<b>' + r.d + '</b> · ' + usd(r.total) + '<br>' + models.filter((m) => r[m]).map((m) => '<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + color(m) + '"></i> ' + esc(m) + ' ' + usd(r[m])).join('<br>')); }; el.onmouseleave = hideTip; });
  $('dailyTable').innerHTML = '<table><tr><th>Day</th>' + models.map((m) => '<th class="num">' + esc(m) + '</th>').join('') + '<th class="num">Total</th></tr>' + daily.filter((r) => r.total).map((r) => '<tr><td>' + r.d + '</td>' + models.map((m) => '<td class="num">' + usd(r[m]) + '</td>').join('') + '<td class="num">' + usd(r.total) + '</td></tr>').join('') + '</table>';
})();
function niceStep(max) { const raw = max / 4; const p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p; return 10 * p; }

// Leaks aggregated across sessions
const agg = {};
S.forEach((s) => s.findings.forEach((f) => { const a = (agg[f.id] = agg[f.id] || { id: f.id, cost: 0, n: 0, fix: f.fix }); a.cost += f.cost; a.n++; }));
const leaks = Object.values(agg).filter((a) => a.cost > 0.005 || a.id === 'marathon').sort((a, b) => b.cost - a.cost);
const maxLeak = Math.max(0.01, ...leaks.map((l) => l.cost));
$('leaks').innerHTML = leaks.length ? leaks.slice(0, 6).map((l) => '<div class="leak"><div class="t">' + esc(D.leakNames[l.id] || l.id) + ' <span class="sub">· ' + l.n + ' session' + (l.n > 1 ? 's' : '') + '</span></div><div class="c">' + usd(l.cost) + '</div><div class="bar"><span style="width:' + (100 * l.cost / maxLeak) + '%"></span></div><div class="f">→ ' + esc(l.fix) + '</div></div>').join('') : '<div class="empty">No leaks detected. Lean work!</div>';

// Spend by hour of day, peak window shaded
(function drawHours() {
  const hours = Array(24).fill(0);
  S.forEach((s) => Object.entries(s.byHour).forEach(([key, c]) => { hours[Number(key.split('-')[1])] += c; }));
  const W = 640, H = 180, L = 44, B = 22, T = 8;
  const max = Math.max(0.01, ...hours);
  const step = niceStep(max), top = Math.ceil(max / step) * step;
  const bw = (W - L) / 24;
  const ph = D.timing.localPeak || {};
  const ps = ph.start ? Number(ph.start.slice(0, 2)) + Number(ph.start.slice(3)) / 60 : null;
  const pe = ph.end ? Number(ph.end.slice(0, 2)) + Number(ph.end.slice(3)) / 60 : null;
  let g = '';
  if (ps != null && pe != null) {
    const seg = (a, b) => '<rect x="' + (L + a * bw) + '" y="' + T + '" width="' + ((b - a) * bw) + '" height="' + (H - T - B) + '" fill="var(--peak)"/>';
    g += pe > ps ? seg(ps, pe) : seg(ps, 24) + seg(0, pe);
    g += '<text x="' + (L + (pe > ps ? ps : ps) * bw + 4) + '" y="' + (T + 12) + '" style="fill:var(--warn)">peak</text>';
  }
  for (let v = 0; v <= top + 1e-9; v += step) { const y = T + (H - T - B) * (1 - v / top); g += '<line x1="' + L + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="var(--border)"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + usd(v) + '</text>'; }
  hours.forEach((c, h) => {
    const bh = (H - T - B) * c / top;
    const x = L + h * bw + bw * 0.18, w = bw * 0.64;
    if (c) g += '<rect x="' + x + '" y="' + (H - B - bh) + '" width="' + w + '" height="' + bh + '" rx="3" fill="var(--s1)"/>';
    g += '<rect class="hit" data-h="' + h + '" x="' + (L + h * bw) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" fill="transparent"/>';
    if (h % 3 === 0) g += '<text x="' + (x + w / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + String(h).padStart(2, '0') + ':00</text>';
  });
  $('hours').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Spend by hour of day">' + g + '</svg>';
  $('hours').querySelectorAll('.hit').forEach((el) => { el.onmousemove = (e) => showTip(e, '<b>' + String(el.dataset.h).padStart(2, '0') + ':00–' + String((+el.dataset.h + 1) % 24).padStart(2, '0') + ':00</b><br>' + usd(hours[el.dataset.h])); el.onmouseleave = hideTip; });
})();

// What-if
const w = D.whatIf;
$('whatif').innerHTML = [
  ['Actual spend', usd(w.actual)],
  ['Fix the detected leaks', '−' + usd(w.actual - w.withoutLeaks)],
  ['Route half of Opus work to Sonnet', '−' + usd(w.routingSaving)],
  ['Lift cache hit rate to 90%', '−' + usd(w.cacheSaving)],
].map(([a, b]) => '<div><span>' + a + '</span><b>' + b + '</b></div>').join('') + '<div class="total"><span>Optimized estimate</span><span class="good">' + usd(w.combined) + ' (' + (w.actual ? Math.round((1 - w.combined / w.actual) * 100) : 0) + '% less)</span></div><p class="sub">Estimates: overlapping savings are not double-counted; real results depend on the work.</p>';

// Sessions table
let sortKey = 'end', sortDir = -1, open = null;
const cols = [['end', 'When'], ['project', 'Project'], ['task', 'Task'], ['model', 'Model'], ['cost', 'Cost', 1], ['calls', 'Calls', 1], ['hit', 'Cache', 1], ['peak', 'Peak ctx', 1], ['score', 'Score', 1]];
function scoreCls(s) { return s >= 80 ? 'good' : s >= 55 ? 'warn' : 'bad'; }
function drawTable() {
  const q = $('q').value.toLowerCase();
  const rows = S.filter((s) => !q || (s.project + ' ' + s.task + ' ' + s.model + ' ' + s.branch).toLowerCase().includes(q)).sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * sortDir);
  let h = '<thead><tr>' + cols.map(([key, label, num]) => '<th data-k="' + key + '"' + (num ? ' class="num"' : '') + '>' + label + (sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') + '</tr></thead><tbody>';
  if (!rows.length) h += '<tr><td colspan="9" class="empty">No sessions match.</td></tr>';
  rows.forEach((s) => {
    h += '<tr class="row" data-id="' + s.id + '"><td>' + (s.end ? new Date(s.end).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') + '</td><td>' + esc(s.project) + (s.branch ? '<div class="sub">' + esc(s.branch) + '</div>' : '') + '</td><td class="task" title="' + esc(s.task) + '">' + esc(s.task) + '</td><td>' + esc(s.model) + '</td><td class="num"><b>' + usd(s.cost) + '</b>' + (s.subCost > 0.005 ? '<div class="sub">agents ' + usd(s.subCost) + '</div>' : '') + '</td><td class="num">' + s.calls + '</td><td class="num">' + Math.round(s.hit * 100) + '%</td><td class="num">' + k(s.peak) + '</td><td class="num"><span class="pill ' + scoreCls(s.score) + '">' + s.score + '</span></td></tr>';
    if (open === s.id) {
      h += '<tr class="detail"><td colspan="9"><b>Tokens</b>: input ' + k(s.input) + ' · cache write ' + k(s.cacheWrite) + ' · cache read ' + k(s.cacheRead) + ' · output ' + k(s.output) + ' · ' + s.prompts + ' prompts<br>';
      if (s.subagents.length) h += '<b>Subagents</b>: ' + s.subagents.map((a) => esc(a.label) + ' ' + usd(a.cost)).join(' · ') + '<br>';
      h += s.findings.length ? s.findings.map((f) => '<div style="margin-top:6px"><b>' + esc(f.title) + '</b>' + (f.cost >= 0.01 ? ' (~' + usd(f.cost) + ')' : '') + '<br>' + esc(f.evidence) + '<br>→ ' + esc(f.fix) + '</div>').join('') : 'No leaks found in this session.';
      h += '</td></tr>';
    }
  });
  $('sessions').innerHTML = h + '</tbody>';
  $('sessions').querySelectorAll('th').forEach((th) => (th.onclick = () => { const kk = th.dataset.k; sortDir = sortKey === kk ? -sortDir : -1; sortKey = kk; drawTable(); }));
  $('sessions').querySelectorAll('tr.row').forEach((tr) => (tr.onclick = () => { open = open === tr.dataset.id ? null : tr.dataset.id; drawTable(); }));
}
$('q').oninput = drawTable;
drawTable();

// Tips
let area = '';
$('tips').innerHTML = D.tips.map((t) => { const head = t.area !== area ? '<b>' + esc((area = t.area)) + '</b><br>' : ''; return '<li>' + head + esc(t.tip) + '</li>'; }).join('');
</script>
</body>
</html>
`;

module.exports = { render };
