'use strict';
// Team report as a self-contained HTML page: who spends what, on what, and
// who qualifies for a bigger allowance.

const { STYLE } = require('./dashboard');
const { VERDICTS, PURPOSES } = require('./team');

function renderTeam(rows, { days, policy }) {
  const data = { days, policy, verdicts: VERDICTS, purposes: PURPOSES, generatedAt: Date.now(), rows };
  return TEMPLATE.replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c'));
}

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TokenLens Team Report</title>
${STYLE}
<style>
.verdict { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid currentColor; white-space: nowrap; }
.v-eligible { color: var(--good); } .v-coach { color: var(--warn); } .v-review { color: var(--bad); } .v-within { color: var(--text-muted); }
.stack { display: flex; height: 14px; border-radius: 4px; overflow: hidden; gap: 2px; min-width: 160px; }
.stack span { display: block; height: 100%; }
.reasons { color: var(--text-secondary); font-size: 12px; margin-top: 4px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.dev h3 { margin: 0 0 4px; font-size: 15px; }
.dev .big { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
.meter { height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; margin: 6px 0 2px; }
.meter span { display: block; height: 100%; border-radius: 4px; }
.policy li { margin-bottom: 4px; }
</style>
</head>
<body>
<header>
  <div><h1>◆ Token<span>Lens</span> · Team</h1><div class="sub" id="range"></div></div>
  <div class="sub">Who uses tokens, for what, and who needs more &nbsp; <button class="theme" id="theme" aria-label="Toggle dark mode">◐</button></div>
</header>
<main>
  <section class="kpis" id="kpis"></section>
  <section class="card"><h2>Developers</h2><div class="cards" id="devs"></div></section>
  <section class="card"><h2>Spend by purpose</h2><div class="legend" id="legend"></div><div class="scroll"><table id="purposeTable"></table></div></section>
  <section class="card"><h2>Extra-token eligibility policy</h2><ul class="policy" id="policy"></ul>
    <p class="sub">Shared summaries contain purpose categories and numbers only. Prompt text is never shared unless a developer turns on <code>shareTaskTitles</code>.</p></section>
</main>
<div class="tip" id="tip" role="tooltip"></div>
<script>
const D = __DATA__;
const $ = (id) => document.getElementById(id);
const usd = (n) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2));
const pct = (x) => Math.round(x * 100) + '%';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tip = $('tip');
function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
$('theme').onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; };

const R = D.rows;
const total = R.reduce((a, r) => a + r.spend, 0);
$('range').textContent = 'Last ' + D.days + ' days · ' + R.length + ' developers · generated ' + new Date(D.generatedAt).toLocaleString();
const avoid = R.reduce((a, r) => a + r.avoidable, 0);
const count = (v) => R.filter((r) => r.verdict === v).length;
$('kpis').innerHTML = [
  ['Team spend', usd(total), 'last ' + D.days + ' days'],
  ['Developers', R.length, R.reduce((a, r) => a + r.sessions, 0) + ' sessions'],
  ['Eligible for more', count('eligible'), 'heavy, efficient, delivery-focused'],
  ['Coach first', count('coach'), 'heavy but wasteful'],
  ['Review', count('review'), 'heavy, little delivery work'],
  ['Avoidable', usd(avoid), total ? pct(avoid / total) + ' of team spend' : ''],
].map(([l, v, n]) => '<div class="card kpi"><div class="label">' + l + '</div><div class="value">' + v + '</div><div class="note">' + esc(n) + '</div></div>').join('');

// fixed purpose -> color order; General Q&A folds to gray
const color = (p) => { const i = D.purposes.indexOf(p); return i >= 0 && i < 8 ? 'var(--s' + (i + 1) + ')' : 'var(--text-muted)'; };
const order = { eligible: 0, coach: 1, review: 2, within: 3 };
const sorted = R.slice().sort((a, b) => order[a.verdict] - order[b.verdict] || b.spend - a.spend);
function stack(r) {
  return '<div class="stack" role="img" aria-label="Spend by purpose">' + Object.entries(r.byPurpose).sort((a, b) => D.purposes.indexOf(a[0]) - D.purposes.indexOf(b[0])).map(([p, c]) => '<span data-tip="' + esc(p + ': ' + usd(c) + ' (' + pct(c / (r.spend || 1)) + ')') + '" style="width:' + (100 * c / (r.spend || 1)) + '%;background:' + color(p) + '"></span>').join('') + '</div>';
}
$('devs').innerHTML = sorted.map((r) => {
  const v = D.verdicts[r.verdict];
  const u = Math.min(1, r.utilization);
  const mcol = r.utilization >= 1 ? 'var(--bad)' : r.utilization >= 0.8 ? 'var(--warn)' : 'var(--good)';
  return '<div class="card dev"><h3>' + esc(r.developer.name) + (r.developer.role ? ' <span class="sub">· ' + esc(r.developer.role) + '</span>' : '') + '</h3>'
    + '<span class="verdict v-' + r.verdict + '">' + v.icon + ' ' + esc(v.label) + '</span>'
    + '<div style="display:flex;justify-content:space-between;margin-top:10px"><div><div class="big">' + usd(r.projected) + '</div><div class="sub">per month (est.)</div></div><div style="text-align:right"><div class="big">' + r.efficiency + '</div><div class="sub">efficiency</div></div></div>'
    + '<div class="meter"><span style="width:' + (u * 100) + '%;background:' + mcol + '"></span></div><div class="sub">' + pct(r.utilization) + ' of $' + r.allowance + ' allowance' + (r.limitHits ? ' · ' + r.limitHits + ' plan-limit stops' : '') + '</div>'
    + '<div style="margin-top:10px">' + stack(r) + '</div>'
    + '<div class="sub" style="margin-top:4px">' + pct(r.deliveryShare) + ' delivery work · ' + pct(r.avoidableShare) + ' avoidable · cache ' + pct(r.cacheHitRate) + ' · ' + r.sessions + ' sessions</div>'
    + (r.verdict === 'eligible' ? '<p><b class="v-eligible">→ Raise allowance to $' + r.recommendedAllowance + '/month</b></p>' : '')
    + '<div class="reasons">' + esc(r.reasons.join('; ')) + '.</div></div>';
}).join('');
document.querySelectorAll('[data-tip]').forEach((el) => { el.onmousemove = (e) => showTip(e, el.dataset.tip); el.onmouseleave = () => (tip.style.display = 'none'); });

const used = D.purposes.filter((p) => R.some((r) => r.byPurpose[p]));
$('legend').innerHTML = used.map((p) => '<span><i style="background:' + color(p) + '"></i>' + esc(p) + '</span>').join('');
$('purposeTable').innerHTML = '<tr><th>Developer</th>' + used.map((p) => '<th class="num">' + esc(p) + '</th>').join('') + '<th class="num">Total</th></tr>'
  + sorted.map((r) => '<tr><td>' + esc(r.developer.name) + '</td>' + used.map((p) => '<td class="num">' + (r.byPurpose[p] ? usd(r.byPurpose[p]) : '–') + '</td>').join('') + '<td class="num"><b>' + usd(r.spend) + '</b></td></tr>').join('')
  + '<tr><td><b>Team</b></td>' + used.map((p) => '<td class="num"><b>' + usd(R.reduce((a, r) => a + (r.byPurpose[p] || 0), 0)) + '</b></td>').join('') + '<td class="num"><b>' + usd(total) + '</b></td></tr>';

const P = D.policy;
$('policy').innerHTML = [
  '<b>Eligible for more tokens</b>: heavy use (≥ ' + pct(P.heavyUtilization) + ' of allowance, or ≥ ' + P.limitHitsForHeavy + ' plan-limit stops) <b>and</b> efficient (score ≥ ' + P.minEfficiency + ', ≤ ' + pct(P.maxAvoidable) + ' avoidable) <b>and</b> ≥ ' + pct(P.minDelivery) + ' of spend on delivery work. Suggested new allowance: 125% of projected use, at least 1.5× the current one.',
  '<b>Coach first</b>: heavy and delivery-focused but wasteful. Fixing the top leak frees allowance before buying more.',
  '<b>Review purpose</b>: heavy use with little delivery work (mostly learning or general Q&amp;A). Talk about it; it may still be fine.',
  '<b>Within allowance</b>: no change needed. Default allowance $' + P.monthlyAllowanceUsd + '/month per developer (configurable per person).',
].map((t) => '<li>' + t + '</li>').join('');
</script>
</body>
</html>
`;

module.exports = { renderTeam };
