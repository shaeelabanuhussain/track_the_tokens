'use strict';
// FinOps exports. FOCUS (FinOps Open Cost & Usage Specification) rows let
// Claude Code spend sit next to cloud bills in any FOCUS-aware tool; the OTel
// export uses the OpenTelemetry GenAI semantic convention attribute names.

const { priceFor, CACHE_WRITE_5M, CACHE_WRITE_1H } = require('./pricing');

const FOCUS_COLUMNS = [
  'BilledCost', 'BillingAccountId', 'BillingAccountName', 'BillingCurrency', 'BillingPeriodStart', 'BillingPeriodEnd',
  'ChargeCategory', 'ChargeClass', 'ChargeDescription', 'ChargeFrequency', 'ChargePeriodStart', 'ChargePeriodEnd',
  'ConsumedQuantity', 'ConsumedUnit', 'ContractedCost', 'ContractedUnitPrice', 'EffectiveCost', 'InvoiceIssuerName',
  'ListCost', 'ListUnitPrice', 'PricingCategory', 'PricingQuantity', 'PricingUnit', 'ProviderName', 'PublisherName',
  'RegionId', 'RegionName', 'ResourceId', 'ResourceName', 'ResourceType', 'ServiceCategory', 'ServiceName',
  'ServiceSubcategory', 'SkuId', 'SkuPriceId', 'SubAccountId', 'SubAccountName', 'Tags',
];

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function iso(ts) {
  return ts ? new Date(ts).toISOString() : '';
}

function monthBounds(ts) {
  const d = new Date(ts || Date.now());
  return [new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString()];
}

function tokenLines(model, u) {
  const p = priceFor(model);
  return [
    ['input', u.input, p.input],
    ['output', u.output, p.output],
    ['cache_read', u.cacheRead, p.input * p.read],
    ['cache_write_5m', u.cacheWrite5m, p.input * CACHE_WRITE_5M],
    ['cache_write_1h', u.cacheWrite1h, p.input * CACHE_WRITE_1H],
  ].filter(([, q]) => q > 0);
}

function toFocus(sessions) {
  const rows = [FOCUS_COLUMNS.join(',')];
  for (const s of sessions) {
    const [bpStart, bpEnd] = monthBounds(s.start);
    const project = s.cwd || s.project;
    for (const [model, u] of Object.entries(s.models || {})) {
      for (const [type, qty, pricePerM] of tokenLines(model, u)) {
        const cost = (qty * pricePerM) / 1e6;
        const row = {
          BilledCost: cost.toFixed(6),
          BillingAccountId: process.env.TOKENLENS_ACCOUNT || 'claude-code',
          BillingAccountName: process.env.TOKENLENS_ACCOUNT_NAME || 'Claude Code',
          BillingCurrency: 'USD',
          BillingPeriodStart: bpStart,
          BillingPeriodEnd: bpEnd,
          ChargeCategory: 'Usage',
          ChargeClass: '',
          ChargeDescription: `${model} ${type} tokens`,
          ChargeFrequency: 'Usage-Based',
          ChargePeriodStart: iso(s.start),
          ChargePeriodEnd: iso(s.end),
          ConsumedQuantity: qty,
          ConsumedUnit: 'Tokens',
          ContractedCost: cost.toFixed(6),
          ContractedUnitPrice: (pricePerM / 1e6).toExponential(4),
          EffectiveCost: cost.toFixed(6),
          InvoiceIssuerName: 'Anthropic',
          ListCost: cost.toFixed(6),
          ListUnitPrice: (pricePerM / 1e6).toExponential(4),
          PricingCategory: 'Standard',
          PricingQuantity: qty,
          PricingUnit: 'Tokens',
          ProviderName: 'Anthropic',
          PublisherName: 'Anthropic',
          RegionId: '',
          RegionName: '',
          ResourceId: s.sessionId,
          ResourceName: (s.firstPrompt || '').slice(0, 80),
          ResourceType: 'Claude Code Session',
          ServiceCategory: 'AI and Machine Learning',
          ServiceName: 'Claude Code',
          ServiceSubcategory: 'Generative AI',
          SkuId: model,
          SkuPriceId: `${model}:${type}`,
          SubAccountId: project,
          SubAccountName: String(project).split(/[\\/]/).pop(),
          Tags: JSON.stringify({ token_type: type, git_branch: s.gitBranch || '', efficiency_score: s.score }),
        };
        rows.push(FOCUS_COLUMNS.map((c) => csvCell(row[c])).join(','));
      }
    }
  }
  return rows.join('\n') + '\n';
}

// One span per session and model, OTel GenAI attribute names.
function toOtel(sessions) {
  const spans = [];
  for (const s of sessions) {
    for (const [model, u] of Object.entries(s.models || {})) {
      spans.push({
        name: `chat ${model}`,
        traceId: s.sessionId.replace(/-/g, ''),
        startTimeUnixNano: String((s.start || 0) * 1e6),
        endTimeUnixNano: String((s.end || 0) * 1e6),
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': 'anthropic',
          'gen_ai.request.model': model,
          'gen_ai.usage.input_tokens': u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h,
          'gen_ai.usage.output_tokens': u.output,
          'gen_ai.usage.cache_read.input_tokens': u.cacheRead,
          'gen_ai.usage.cache_creation.input_tokens': u.cacheWrite5m + u.cacheWrite1h,
          'gen_ai.conversation.id': s.sessionId,
          'tokenlens.cost_usd': Number(u.cost.toFixed(6)),
          'tokenlens.api_calls': u.calls,
          'tokenlens.project': s.cwd || s.project,
          'tokenlens.efficiency_score': s.score,
        },
      });
    }
  }
  return JSON.stringify({ resourceSpans: [{ resource: { attributes: { 'service.name': 'claude-code' } }, scopeSpans: [{ scope: { name: 'tokenlens' }, spans }] }] }, null, 2) + '\n';
}

function toJson(sessions) {
  return JSON.stringify(sessions, null, 2) + '\n';
}

// Rough, deliberately conservative savings model used by `whatif` and the dashboard.
function whatIf(sessions) {
  let actual = 0;
  let leaks = 0;
  let opus = 0;
  let cacheSaving = 0;
  for (const s of sessions) {
    actual += s.cost;
    leaks += Math.min(s.cost * 0.6, s.findings.reduce((a, f) => a + (f.id === 'marathon' ? 0 : f.cost), 0));
    for (const [model, u] of Object.entries(s.models || {})) {
      if (/opus|fable|mythos/.test(model)) opus += u.cost;
      const p = priceFor(model);
      const prompt = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
      const hit = prompt ? u.cacheRead / prompt : 1;
      if (hit < 0.9 && prompt) {
        const moved = (0.9 - hit) * prompt;
        cacheSaving += (moved * p.input * (CACHE_WRITE_5M - p.read)) / 1e6;
      }
    }
  }
  const sonnetRatio = priceFor('claude-sonnet-5-5').input / priceFor('claude-opus-5-5').input;
  const routingSaving = opus * 0.5 * (1 - sonnetRatio);
  const withoutLeaks = actual - leaks;
  const combined = Math.max(actual * 0.25, actual - leaks - routingSaving * 0.7 - cacheSaving * 0.5);
  return { actual, withoutLeaks, routingSaving, cacheSaving, combined };
}

module.exports = { toFocus, toOtel, toJson, whatIf, FOCUS_COLUMNS };
