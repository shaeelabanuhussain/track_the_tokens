'use strict';
// Reads Claude Code session transcripts (~/.claude/projects/<project>/<session>.jsonl)
// and turns them into per-session usage, cost and waste attribution.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { priceFor, costOf } = require('./pricing');

const CHARS_PER_TOKEN = 4; // rough estimate for tool output that never shows up as billed usage on its own

function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function projectsDir() {
  return path.join(claudeHome(), 'projects');
}

function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a partially written last line is normal while a session is live
    }
  }
  return out;
}

// Every main transcript plus its subagent transcripts, newest first.
function listSessionFiles({ project } = {}) {
  const root = projectsDir();
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  const files = [];
  for (const d of dirs) {
    if (project && !d.name.includes(project)) continue;
    const dir = path.join(root, d.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      files.push({ file: full, project: d.name, sessionId: f.replace(/\.jsonl$/, ''), mtime: stat.mtimeMs });
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

function subagentFiles(mainFile) {
  const dir = path.join(mainFile.replace(/\.jsonl$/, ''), 'subagents');
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function textSize(content) {
  if (content == null) return 0;
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const c of content) {
      if (c.type === 'text') n += (c.text || '').length;
      else if (c.type === 'image' || c.type === 'document') n += 6000; // ~1.5k tokens per page/image
      else n += JSON.stringify(c).length;
    }
    return n;
  }
  return JSON.stringify(content).length;
}

function describeTool(name, input = {}) {
  if (!input || typeof input !== 'object') return name;
  const target = input.file_path || input.path || input.notebook_path || input.url || input.pattern || input.command || input.query || input.description || '';
  const t = String(target).replace(/\s+/g, ' ');
  return t ? `${name}: ${t.length > 70 ? t.slice(0, 67) + '...' : t}` : name;
}

// Parse a transcript. Assistant messages are streamed as several JSONL lines
// sharing one message.id, each repeating the usage block, so we keep one per id.
function parseTranscript(file, { includeSubagents = true } = {}) {
  const entries = readJsonl(file);
  const turns = new Map(); // message.id -> turn
  const toolUses = new Map(); // tool_use_id -> {name, input, turnId}
  const toolResults = []; // {id, chars, isError}
  let firstPrompt = null;
  let userPrompts = 0;
  let cwd = null;
  let gitBranch = null;
  let compactions = 0;
  let limitHits = 0;
  const prompts = [];

  for (const e of entries) {
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.gitBranch && !gitBranch) gitBranch = e.gitBranch;
    if (e.type === 'system' && (e.subtype === 'compact_boundary' || /compact/i.test(e.content || ''))) compactions++;
    if (e.isCompactSummary) compactions++;

    if (e.type === 'user' && e.message) {
      const c = e.message.content;
      if (typeof c === 'string') {
        if (!e.isMeta && !c.startsWith('<command-') && !c.startsWith('<local-command')) {
          userPrompts++;
          if (!firstPrompt) firstPrompt = c;
          if (prompts.length < 5) prompts.push(c.slice(0, 300));
        }
      } else if (Array.isArray(c)) {
        for (const block of c) {
          if (block.type === 'tool_result') {
            toolResults.push({ id: block.tool_use_id, chars: textSize(block.content), isError: !!block.is_error });
          } else if (block.type === 'text' && !e.isMeta && !firstPrompt) {
            firstPrompt = block.text;
          }
        }
      }
    }

    if (e.type === 'assistant' && e.message && e.message.usage) {
      const m = e.message;
      const id = m.id || e.uuid;
      const u = m.usage;
      const cc = u.cache_creation || {};
      const prev = turns.get(id);
      const turn = {
        id,
        model: m.model,
        ts: e.timestamp ? Date.parse(e.timestamp) : null,
        input: u.input_tokens || 0,
        output: Math.max(u.output_tokens || 0, prev ? prev.output : 0),
        cacheRead: u.cache_read_input_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
        cacheWrite1h: cc.ephemeral_1h_input_tokens || 0,
        cacheWrite5m: cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : null,
        webSearches: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0,
        tools: prev ? prev.tools : [],
      };
      if (turn.cacheWrite5m == null) turn.cacheWrite5m = Math.max(0, turn.cacheWrite - turn.cacheWrite1h);
      if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === 'tool_use') {
            toolUses.set(block.id, { name: block.name, input: block.input, turnId: id });
            if (!turn.tools.includes(block.name)) turn.tools.push(block.name);
          }
        }
      }
      if (m.model === '<synthetic>') {
        // Claude Code records plan/rate-limit stops as synthetic assistant messages.
        const text = JSON.stringify(m.content || '');
        if (/usage limit|rate limit|limit reached|limit will reset/i.test(text)) limitHits++;
        continue;
      }
      turns.set(id, turn);
    }
  }

  const list = [...turns.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const t of list) {
    t.context = t.input + t.cacheRead + t.cacheWrite;
    t.cost = costOf(t);
  }

  // Tool output becomes input context on every later turn, so it is the main
  // "step that causes the spend". Attribute an estimate per tool call.
  const turnIndex = new Map(list.map((t, i) => [t.id, i]));
  const toolStats = [];
  for (const r of toolResults) {
    const use = toolUses.get(r.id);
    if (!use) continue;
    const idx = turnIndex.has(use.turnId) ? turnIndex.get(use.turnId) : list.length - 1;
    toolStats.push({
      name: use.name,
      label: describeTool(use.name, use.input),
      input: use.input,
      tokens: Math.round(r.chars / CHARS_PER_TOKEN),
      isError: r.isError,
      turnIndex: idx,
      laterTurns: Math.max(0, list.length - idx - 1),
      model: list[idx] ? list[idx].model : null,
    });
  }

  const session = summarize(list);
  session.file = file;
  session.sessionId = path.basename(file).replace(/\.jsonl$/, '');
  session.cwd = cwd;
  session.gitBranch = gitBranch;
  session.firstPrompt = firstPrompt ? firstPrompt.replace(/\s+/g, ' ').slice(0, 120) : '';
  session.userPrompts = userPrompts;
  session.prompts = prompts;
  session.limitHits = limitHits;
  session.edits = [...toolUses.values()].filter((u) => /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(u.name)).length;
  session.compactions = compactions;
  session.turns = list;
  session.toolCalls = toolStats;

  session.subagents = [];
  if (includeSubagents) {
    for (const sf of subagentFiles(file)) {
      const sub = parseTranscript(sf, { includeSubagents: false });
      if (!sub.turns.length) continue;
      let label = path.basename(sf, '.jsonl');
      try {
        const meta = JSON.parse(fs.readFileSync(sf.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
        label = meta.description || meta.agentType || label;
      } catch {}
      session.subagents.push({ label, ...pick(sub) });
    }
  }
  session.total = session.subagents.reduce(
    (acc, s) => addTotals(acc, s),
    pick(session),
  );
  return session;
}

function pick(s) {
  return { models: s.models, cost: s.cost, input: s.input, output: s.output, cacheRead: s.cacheRead, cacheWrite: s.cacheWrite, apiCalls: s.apiCalls };
}

function addTotals(a, b) {
  return {
    cost: a.cost + b.cost,
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    apiCalls: a.apiCalls + b.apiCalls,
  };
}

function summarize(turns) {
  const s = { apiCalls: turns.length, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, models: {}, start: null, end: null, peakContext: 0, lastContext: 0 };
  for (const t of turns) {
    s.input += t.input;
    s.output += t.output;
    s.cacheRead += t.cacheRead;
    s.cacheWrite += t.cacheWrite;
    s.cost += t.cost;
    const m = (s.models[t.model] = s.models[t.model] || { calls: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
    m.calls++;
    m.cost += t.cost;
    m.input += t.input;
    m.output += t.output;
    m.cacheRead += t.cacheRead;
    m.cacheWrite5m += t.cacheWrite5m;
    m.cacheWrite1h += t.cacheWrite1h;
    if (t.ts) {
      if (!s.start || t.ts < s.start) s.start = t.ts;
      if (!s.end || t.ts > s.end) s.end = t.ts;
    }
    if (t.context > s.peakContext) s.peakContext = t.context;
    s.lastContext = t.context;
  }
  const promptTokens = s.input + s.cacheRead + s.cacheWrite;
  s.cacheHitRate = promptTokens ? s.cacheRead / promptTokens : 0;
  s.mainModel = Object.entries(s.models).sort((a, b) => b[1].cost - a[1].cost).map(([k]) => k)[0] || 'unknown';
  return s;
}

function contextLimitFor(model) {
  return priceFor(model).context || 200000;
}

module.exports = {
  claudeHome,
  projectsDir,
  listSessionFiles,
  parseTranscript,
  readJsonl,
  contextLimitFor,
  CHARS_PER_TOKEN,
};
