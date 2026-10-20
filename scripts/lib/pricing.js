'use strict';
// USD per million tokens, from platform.claude.com/docs/en/about-claude/pricing
// (checked 2026-10-20). Cache writes cost 1.25x input (5-minute TTL) or 2x input
// (1-hour TTL). Cache reads cost `read` x input (0.1x unless noted).
// Override or extend with ~/.claude/tokenlens/pricing.json, same shape.

const fs = require('fs');
const path = require('path');
const os = require('os');

// Longest matching prefix wins, so list specific versions next to families.
const DEFAULT_PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, read: 0.025, context: 1000000 },
  'claude-mythos-5-1': { input: 10, output: 50, read: 0.025, context: 1000000 },
  'claude-fable-5': { input: 10, output: 50, context: 1000000 },
  'claude-mythos-5': { input: 10, output: 50, context: 1000000 },
  'claude-opus-5-5': { input: 4, output: 20, read: 0.05, context: 1000000 },
  'claude-opus-5': { input: 5, output: 25, context: 1000000 },
  'claude-opus-4-8': { input: 5, output: 25, context: 1000000 },
  'claude-opus-4-7': { input: 5, output: 25, context: 1000000 },
  'claude-opus-4-6': { input: 5, output: 25, context: 1000000 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.05, context: 1000000 },
  'claude-sonnet-5': { input: 2, output: 10, context: 1000000 },
  'claude-sonnet-4-6': { input: 3, output: 15, context: 1000000 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, longAbove: 100000, longInput: 0.5, longOutput: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-3-opus': { input: 15, output: 75 },
};

const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
const CACHE_READ = 0.1;
const WEB_SEARCH_USD = 0.01;

let overrides = null;
function loadOverrides() {
  if (overrides) return overrides;
  overrides = {};
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  try {
    overrides = JSON.parse(fs.readFileSync(path.join(home, 'tokenlens', 'pricing.json'), 'utf8'));
  } catch {}
  return overrides;
}

function normalize(model) {
  return String(model || '')
    .toLowerCase()
    .replace(/^(us|eu|apac|global)\.anthropic\./, '')
    .replace(/^anthropic[./]/, '')
    .replace(/\[1m\]$/, '')
    .replace(/@.*$/, '')
    .replace(/\./g, '-');
}

function priceFor(model) {
  const table = { ...DEFAULT_PRICES, ...loadOverrides() };
  const id = normalize(model);
  let best = null;
  for (const key of Object.keys(table)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  const known = !!best;
  const p = known ? table[best] : DEFAULT_PRICES['claude-sonnet-4'];
  return { context: 200000, read: CACHE_READ, ...p, key: best, known };
}

function costOf(t) {
  const p = priceFor(t.model);
  const prompt = t.input + t.cacheRead + t.cacheWrite;
  const long = p.longAbove && prompt > p.longAbove;
  const inRate = (long ? p.longInput : p.input) / 1e6;
  const outRate = (long ? p.longOutput : p.output) / 1e6;
  return (
    t.input * inRate +
    t.cacheWrite5m * inRate * CACHE_WRITE_5M +
    t.cacheWrite1h * inRate * CACHE_WRITE_1H +
    t.cacheRead * inRate * p.read +
    t.output * outRate +
    (t.webSearches || 0) * WEB_SEARCH_USD
  );
}

// Friendly name for display: claude-opus-5-5 -> Opus 5.5
function displayName(model) {
  const m = normalize(model).match(/claude-(?:(\d)-(\d)-)?(opus|sonnet|haiku|fable|mythos)(?:-(\d+))?(?:-(\d)(?!\d))?/);
  if (!m) return model || 'unknown';
  const family = m[3][0].toUpperCase() + m[3].slice(1);
  if (m[1]) return `${family} ${m[1]}.${m[2]}`;
  const minor = m[5] && m[5].length === 1 ? '.' + m[5] : '';
  return `${family} ${m[4] || ''}${minor}`.trim();
}

module.exports = { priceFor, costOf, displayName, DEFAULT_PRICES, CACHE_WRITE_5M, CACHE_WRITE_1H, CACHE_READ };
