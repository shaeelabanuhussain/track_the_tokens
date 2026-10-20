#!/usr/bin/env node
'use strict';
// Generates a realistic two-week demo dataset of Claude Code transcripts (a
// small team, mixed habits) into <out>/projects/... so every TokenLens view can
// be demoed without real data:  CLAUDE_CONFIG_DIR=<out> node scripts/tokenlens.js dashboard

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};
const out = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : path.join(__dirname, '..', '..', 'demo-data'));
let seed = Number(opt('seed', 42));
// --mix lean:3,qa-logs:1 weights the habits; --per-day 2-4 sets sessions per working day;
// --limit-hits N adds plan-limit stops (heavy users).
const MIX = opt('mix', null);
const [PER_MIN, PER_MAX] = opt('per-day', '2-4').split('-').map(Number);
let limitHitsLeft = Number(opt('limit-hits', 0));
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const uuid = () => crypto.createHash('md5').update(String(rand())).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5');

const PROJECTS = [
  { cwd: '/home/dev/bistec/hr-portal', branch: 'feature/leave-requests' },
  { cwd: '/home/dev/bistec/payments-api', branch: 'fix/refund-rounding' },
  { cwd: '/home/qa/bistec/e2e-tests', branch: 'qa/regression-oct' },
  { cwd: '/home/dev/bistec/mobile-app', branch: 'main' },
];

// Archetypes: each one is a working habit, good or bad.
const ARCHETYPES = [
  { name: 'lean', prompts: [4, 9], model: 'claude-sonnet-5-5', start: 18000, growth: 2500, idleBreaks: 0, bigReads: 0, pdf: false, agents: 0, tasks: ['Add validation to leave request form', 'Fix flaky date test in payroll module', 'Rename UserDto fields to match API', 'Write unit tests for refund calculator'] },
  { name: 'marathon', prompts: [35, 55], model: 'claude-opus-5-5', start: 30000, growth: 6000, idleBreaks: 3, bigReads: 3, pdf: false, agents: 1, compact: 2, tasks: ['Refactor the whole payments module and also fix the login bug and update docs', 'Investigate production errors, then build the export feature'] },
  { name: 'pdf-reader', prompts: [6, 12], model: 'claude-opus-5-5', start: 22000, growth: 4000, idleBreaks: 1, bigReads: 1, pdf: true, agents: 0, tasks: ['Implement the requirements in docs/SRS-v3.pdf', 'Create test cases from the client test plan PDF', 'Summarise the API spec PDF and generate endpoints'] },
  { name: 'explorer', prompts: [8, 16], model: 'claude-opus-5-5', start: 25000, growth: 9000, idleBreaks: 1, bigReads: 5, pdf: false, agents: 3, tasks: ['Understand how authentication works across the repo', 'Find why the e2e suite is slow', 'Map all usages of the legacy billing client'] },
  { name: 'qa-logs', prompts: [8, 14], model: 'claude-sonnet-5-5', start: 20000, growth: 7000, idleBreaks: 2, bigReads: 4, pdf: false, agents: 0, errors: 4, tasks: ['Why are 37 regression tests failing? (pasted full CI log)', 'Triage the Playwright failures from last night'] },
  { name: 'chatty-opus', prompts: [15, 25], model: 'claude-opus-5-5', start: 16000, growth: 1500, idleBreaks: 1, bigReads: 0, pdf: false, agents: 0, small: true, tasks: ['Quick questions about TypeScript generics', 'Explain these git commands', 'Help me word the release notes'] },
];

function usage(input, cacheRead, cacheWrite, output, ttl1h) {
  return {
    input_tokens: input,
    cache_creation_input_tokens: cacheWrite,
    cache_read_input_tokens: cacheRead,
    output_tokens: output,
    cache_creation: ttl1h ? { ephemeral_1h_input_tokens: cacheWrite, ephemeral_5m_input_tokens: 0 } : { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: cacheWrite },
    service_tier: 'standard',
  };
}

function writeSession(project, arch, startTs) {
  const sessionId = uuid();
  const dir = path.join(out, 'projects', project.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  const base = { cwd: project.cwd, gitBranch: project.branch, sessionId, version: '2.1.300', isSidechain: false };
  let ts = startTs;
  let ctx = arch.start;
  const nPrompts = arch.prompts[0] + Math.floor(rand() * (arch.prompts[1] - arch.prompts[0]));
  const task = pick(arch.tasks);
  const breaksAt = new Set(Array.from({ length: arch.idleBreaks }, () => 1 + Math.floor(rand() * (nPrompts - 1))));
  let bigLeft = arch.bigReads;
  let errLeft = arch.errors || 0;
  const ttl1h = rand() < 0.5;
  const model = arch.model;
  let msgN = 0;
  const assistant = (u, content, model2 = model) => {
    const id = 'msg_' + sessionId.slice(0, 8) + '_' + msgN++;
    // Claude Code writes one line per content block, each repeating usage.
    for (const block of content) {
      lines.push({ ...base, type: 'assistant', uuid: uuid(), timestamp: new Date(ts).toISOString(), requestId: 'req_' + id, message: { id, model: model2, role: 'assistant', type: 'message', content: [block], usage: u } });
    }
  };

  for (let p = 0; p < nPrompts; p++) {
    if (breaksAt.has(p)) ts += (ttl1h ? 75 : 25) * 60000 + rand() * 20 * 60000;
    else ts += 40000 + rand() * 180000;
    const text = p === 0 ? task : pick(['continue', 'now fix the failing test', 'also update the README', 'looks good, next step', 'that broke the build, check again', 'add error handling there']);
    lines.push({ ...base, type: 'user', uuid: uuid(), timestamp: new Date(ts).toISOString(), message: { role: 'user', content: text } });

    const steps = arch.small ? 1 : 2 + Math.floor(rand() * 4);
    for (let s = 0; s < steps; s++) {
      ts += 5000 + rand() * 25000;
      const cold = s === 0 && breaksAt.has(p);
      const added = Math.round(arch.growth * (0.5 + rand()));
      const write = cold ? ctx + added : added;
      const read = cold ? 0 : ctx;
      const outTok = arch.small ? 120 + Math.floor(rand() * 250) : 300 + Math.floor(rand() * 1800);
      const lastStep = s === steps - 1;
      if (lastStep) {
        assistant(usage(3, read, write, outTok, ttl1h), [{ type: 'text', text: 'Done.' }]);
      } else {
        const toolId = 'toolu_' + uuid().replace(/-/g, '').slice(0, 20);
        let tool = { type: 'tool_use', id: toolId, name: 'Read', input: { file_path: `${project.cwd}/src/${pick(['index.ts', 'service.ts', 'routes.ts', 'utils.ts', 'model.ts'])}` } };
        let resultLen = 2000 + Math.floor(rand() * 8000);
        let isError = false;
        if (arch.pdf && p === 0 && s === 0) {
          tool.input.file_path = `${project.cwd}/docs/${pick(['SRS-v3.pdf', 'test-plan.pdf', 'api-spec.pdf'])}`;
          resultLen = 120000;
        } else if (bigLeft > 0 && rand() < 0.5) {
          bigLeft--;
          tool = rand() < 0.5
            ? { type: 'tool_use', id: toolId, name: 'Bash', input: { command: pick(['npm test', 'cat logs/app.log', 'git log', 'npx playwright test']) } }
            : { type: 'tool_use', id: toolId, name: 'Read', input: { file_path: `${project.cwd}/${pick(['package-lock.json', 'dist/bundle.js', 'src/legacy/BillingClient.ts'])}` } };
          resultLen = 40000 + Math.floor(rand() * 80000);
        } else if (errLeft > 0 && rand() < 0.4) {
          errLeft--;
          tool = { type: 'tool_use', id: toolId, name: 'Bash', input: { command: pick(['npm run test:e2e', 'yarn lint', 'pytest -x']) } };
          resultLen = 1500;
          isError = true;
        } else if (rand() < 0.3) {
          tool = { type: 'tool_use', id: toolId, name: 'Edit', input: { file_path: `${project.cwd}/src/service.ts` } };
          resultLen = 300;
        }
        assistant(usage(3, read, write, outTok, ttl1h), [{ type: 'text', text: 'Checking.' }, tool]);
        lines.push({ ...base, type: 'user', uuid: uuid(), timestamp: new Date(ts + 2000).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'x'.repeat(resultLen), is_error: isError }] } });
        ctx += Math.round(resultLen / 4);
      }
      ctx += added;
    }
    if (arch.compact && p > 0 && p % Math.floor(nPrompts / (arch.compact + 1)) === 0 && ctx > 120000) {
      lines.push({ ...base, type: 'system', subtype: 'compact_boundary', timestamp: new Date(ts).toISOString(), content: 'Conversation compacted' });
      ctx = 35000;
    }
  }
  if (limitHitsLeft > 0 && rand() < 0.5) {
    limitHitsLeft--;
    lines.push({ ...base, type: 'assistant', timestamp: new Date(ts + 1000).toISOString(), message: { id: 'msg_limit_' + sessionId.slice(0, 8), model: '<synthetic>', content: [{ type: 'text', text: 'Claude usage limit reached. Your limit will reset at 6pm.' }], usage: usage(0, 0, 0, 0, false) } });
  }
  fs.writeFileSync(path.join(dir, sessionId + '.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  // Subagents
  for (let a = 0; a < arch.agents; a++) {
    const sub = path.join(dir, sessionId, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const aid = 'agent-' + uuid().slice(0, 12);
    const sl = [];
    let sctx = 12000;
    const subModel = rand() < 0.3 ? 'claude-haiku-5-5' : model;
    for (let i = 0; i < 6 + Math.floor(rand() * 10); i++) {
      const add = 4000 + Math.floor(rand() * 9000);
      sl.push({ ...base, isSidechain: true, type: 'assistant', timestamp: new Date(ts - 600000 + i * 20000).toISOString(), message: { id: `msg_${aid}_${i}`, model: subModel, content: [{ type: 'text', text: '...' }], usage: usage(3, sctx, add, 400 + Math.floor(rand() * 900), ttl1h) } });
      sctx += add;
    }
    fs.writeFileSync(path.join(sub, aid + '.jsonl'), sl.map((l) => JSON.stringify(l)).join('\n') + '\n');
    fs.writeFileSync(path.join(sub, aid + '.meta.json'), JSON.stringify({ agentType: 'Explore', description: pick(['Search auth flow', 'Find slow tests', 'Map billing usages', 'Scan for TODOs']) }));
  }
}

function weighted() {
  const parts = MIX.split(',').map((x) => x.split(':')).map(([n, w]) => [ARCHETYPES.find((a) => a.name === n), Number(w || 1)]).filter(([a]) => a);
  let r = rand() * parts.reduce((a, [, w]) => a + w, 0);
  for (const [a, w] of parts) if ((r -= w) < 0) return a;
  return parts[0][0];
}

fs.rmSync(path.join(out, 'projects'), { recursive: true, force: true });
const now = Date.now();
let count = 0;
for (let d = 13; d >= 0; d--) {
  const day = new Date(now - d * 86400000);
  if (day.getDay() === 0 || day.getDay() === 6) continue;
  const n = PER_MIN + Math.floor(rand() * (PER_MAX - PER_MIN + 1));
  for (let i = 0; i < n; i++) {
    const startHour = pick([9, 10, 11, 13, 14, 15, 16, 18, 19, 20, 21]);
    const start = new Date(day);
    start.setHours(startHour, Math.floor(rand() * 60), 0, 0);
    if (start.getTime() > now - 3600000) continue;
    const arch = MIX ? weighted() : d < 4 && rand() < 0.5 ? ARCHETYPES[0] : pick(ARCHETYPES);
    writeSession(pick(PROJECTS), arch, start.getTime());
    count++;
  }
}
console.log(`✓ ${count} demo sessions written to ${path.join(out, 'projects')}`);
console.log(`  Try: CLAUDE_CONFIG_DIR=${out} node scripts/tokenlens.js dashboard --open`);
