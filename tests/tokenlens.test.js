'use strict';
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenlens-test-'));
process.env.CLAUDE_CONFIG_DIR = home;
const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'tokenlens.js');
const run = (args, input) => execFileSync('node', [CLI, ...args], { env: { ...process.env, NO_COLOR: '1', CLAUDE_CONFIG_DIR: home }, input: input || '', encoding: 'utf8' });

const { priceFor, costOf, displayName } = require('../scripts/lib/pricing');
const { parseTranscript } = require('../scripts/lib/transcripts');
const { diagnose } = require('../scripts/lib/insights');
const { isPeak, DEFAULT_PEAK } = require('../scripts/lib/timing');

function writeTranscript(name, lines) {
  const dir = path.join(home, 'projects', '-work-app');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name + '.jsonl');
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return f;
}

const usage = (i, r, w, o) => ({ input_tokens: i, cache_read_input_tokens: r, cache_creation_input_tokens: w, output_tokens: o, cache_creation: { ephemeral_5m_input_tokens: w, ephemeral_1h_input_tokens: 0 } });

test('pricing: longest prefix wins and per-model cache read rates apply', () => {
  assert.strictEqual(priceFor('claude-opus-4-20250514').input, 15);
  assert.strictEqual(priceFor('claude-opus-4-5-20251101').input, 5);
  assert.strictEqual(priceFor('claude-opus-5-5').read, 0.05);
  assert.strictEqual(priceFor('us.anthropic.claude-sonnet-4-6').key, 'claude-sonnet-4-6');
  assert.strictEqual(displayName('claude-opus-4-20250514'), 'Opus 4');
  assert.strictEqual(displayName('claude-sonnet-5-5'), 'Sonnet 5.5');
  // 1M input + 1M output on Sonnet 4.5 = $3 + $15
  const c = costOf({ model: 'claude-sonnet-4-5', input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  assert.ok(Math.abs(c - 18) < 1e-9);
  // Haiku 5.5 long-prompt tier
  const h = costOf({ model: 'claude-haiku-5-5', input: 200000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  assert.ok(Math.abs(h - 0.1) < 1e-9);
});

test('transcripts: streamed blocks sharing one message.id are counted once', () => {
  const ts = '2026-10-20T10:00:00.000Z';
  const u = usage(10, 1000, 500, 200);
  const f = writeTranscript('dedup', [
    { type: 'user', timestamp: ts, message: { role: 'user', content: 'hello' } },
    { type: 'assistant', timestamp: ts, message: { id: 'm1', model: 'claude-sonnet-4-5', content: [{ type: 'thinking' }], usage: u } },
    { type: 'assistant', timestamp: ts, message: { id: 'm1', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'hi' }], usage: u } },
    { type: 'assistant', timestamp: ts, message: { id: 'm1', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } }], usage: u } },
    { type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(4000) }] } },
  ]);
  const s = parseTranscript(f);
  assert.strictEqual(s.apiCalls, 1);
  assert.strictEqual(s.output, 200);
  assert.strictEqual(s.cacheRead, 1000);
  assert.strictEqual(s.userPrompts, 1);
  assert.strictEqual(s.toolCalls.length, 1);
  assert.strictEqual(s.toolCalls[0].tokens, 1000);
});

test('insights: idle cache expiry, big tool output and PDF reads are found and priced', () => {
  const lines = [{ type: 'user', timestamp: '2026-10-20T10:00:00Z', message: { role: 'user', content: 'go' } }];
  let t = Date.parse('2026-10-20T10:00:00Z');
  for (let i = 0; i < 6; i++) {
    t += i === 3 ? 30 * 60000 : 30000; // a 30-minute break before call 4
    const cold = i === 3;
    lines.push({ type: 'assistant', timestamp: new Date(t).toISOString(), message: { id: 'c' + i, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'u' + i, name: 'Read', input: { file_path: i === 0 ? '/docs/spec.pdf' : '/big.log' } }], usage: usage(5, cold ? 0 : 90000, cold ? 95000 : 2000, 300) } });
    lines.push({ type: 'user', timestamp: new Date(t).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u' + i, content: 'x'.repeat(i === 1 ? 60000 : 400) }] } });
  }
  const s = parseTranscript(writeTranscript('leaky', lines));
  const ids = diagnose(s).map((f) => f.id);
  assert.ok(ids.includes('cache-expired'), ids.join());
  assert.ok(ids.includes('big-tool-output'), ids.join());
  assert.ok(ids.includes('pdf-read'), ids.join());
  assert.ok(diagnose(s).every((f) => f.fix && f.cost >= 0));
});

test('timing: peak window is weekdays 05:00-11:00 Pacific', () => {
  assert.strictEqual(isPeak(new Date('2026-10-20T13:00:00Z'), DEFAULT_PEAK), true); // Tue 06:00 PDT
  assert.strictEqual(isPeak(new Date('2026-10-20T20:00:00Z'), DEFAULT_PEAK), false); // Tue 13:00 PDT
  assert.strictEqual(isPeak(new Date('2026-10-18T13:00:00Z'), DEFAULT_PEAK), false); // Sunday
});

test('pdf2md: built-in extractor converts a text PDF with no external tools', () => {
  const pdf2md = require('../scripts/lib/pdf2md');
  const tmp = path.join(home, 'sample.pdf');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'sample.pdf'), tmp);
  const r = pdf2md.convert(tmp, { engine: 'builtin', force: true });
  const md = fs.readFileSync(r.mdPath, 'utf8');
  assert.match(md, /## Quarterly Token Report/);
  assert.match(md, /Team spend fell 42%/);
  assert.ok(r.mdTokens < r.pdfTokens);
});

test('hook pre-read: denies a PDF Read and points Claude at the Markdown', () => {
  const tmp = path.join(home, 'hook.pdf');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'sample.pdf'), tmp);
  const res = JSON.parse(run(['hook', 'pre-read'], JSON.stringify({ tool_name: 'Read', tool_input: { file_path: tmp } })));
  assert.strictEqual(res.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(res.hookSpecificOutput.permissionDecisionReason, /hook\.md/);
  // A non-PDF read is left alone
  assert.strictEqual(run(['hook', 'pre-read'], JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } })), '');
});

test('hook session-start: shows a banner to the user without adding model context', () => {
  const res = JSON.parse(run(['hook', 'session-start'], JSON.stringify({ session_id: 'new', cwd: '/work/app', source: 'startup' })));
  assert.match(res.systemMessage, /TokenLens: today/);
  assert.strictEqual(res.hookSpecificOutput, undefined);
});

test('statusline: renders cost, context and a tip from Claude Code input', () => {
  const f = path.join(home, 'projects', '-work-app', 'leaky.jsonl');
  const outp = run(['statusline'], JSON.stringify({ transcript_path: f, model: { id: 'claude-opus-5-5' }, context_window: { context_window_size: 200000, used_percentage: 72 }, rate_limits: { five_hour: { used_percentage: 41 } } }));
  assert.match(outp, /TokenLens/);
  assert.match(outp, /Opus 5\.5/);
  assert.match(outp, /ctx .* 72%/);
  assert.match(outp, /5h limit 41%/);
});

test('demo data, FOCUS export and dashboard', () => {
  execFileSync('node', [path.join(ROOT, 'scripts', 'demo', 'generate.js'), home], { encoding: 'utf8' });
  const csv = run(['export', '--format', 'focus', '--days', '30']);
  const [header, first] = csv.split('\n');
  assert.ok(header.startsWith('BilledCost,'));
  for (const col of ['EffectiveCost', 'ChargePeriodStart', 'ConsumedQuantity', 'ConsumedUnit', 'ServiceName', 'ProviderName', 'SkuId', 'Tags']) assert.ok(header.split(',').includes(col), col);
  assert.match(first, /Claude Code/);
  const otel = JSON.parse(run(['export', '--format', 'otel']));
  assert.ok(otel.resourceSpans[0].scopeSpans[0].spans[0].attributes['gen_ai.usage.output_tokens'] > 0);
  const outFile = path.join(home, 'dash.html');
  run(['dashboard', '--out', outFile]);
  const html = fs.readFileSync(outFile, 'utf8');
  assert.match(html, /<title>TokenLens Dashboard<\/title>/);
  assert.ok(!/__DATA__/.test(html));
  assert.match(run(['diagnose', '--days', '30']), /avoidable/);
});
