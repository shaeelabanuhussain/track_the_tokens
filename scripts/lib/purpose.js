'use strict';
// What a session was for, from the developer's first prompts and the tools used.
// Only the category leaves the machine when sharing with a team, never the prompt.

const PURPOSES = [
  'Feature development',
  'Bug fixing',
  'Testing & QA',
  'Code review',
  'Refactoring',
  'Docs & analysis',
  'DevOps & build',
  'Learning & exploration',
  'General Q&A',
];

// Productive delivery work: what extra allowance is meant for.
const DELIVERY = new Set(['Feature development', 'Bug fixing', 'Testing & QA', 'Code review', 'Refactoring', 'DevOps & build', 'Docs & analysis']);

// A clear action verb at the start of the task decides it.
const LEADING = [
  [/^(fix|debug|investigate|resolve|diagnose)\b/, 'Bug fixing'],
  [/^(write|add|create|generate) (unit |e2e |integration )?tests?\b|^(test|verify|validate|triage)\b/, 'Testing & QA'],
  [/^(review|audit)\b/, 'Code review'],
  [/^(refactor|rename|restructure|migrate|upgrade|clean ?up|simplify)\b/, 'Refactoring'],
  [/^(document|summari[sz]e|draft|translate)\b/, 'Docs & analysis'],
  [/^(deploy|release|configure|set ?up|provision)\b/, 'DevOps & build'],
  [/^(add|implement|create|build|develop|integrate|make)\b/, 'Feature development'],
  [/^(explain|understand|learn|teach|map|find|search|explore|compare)\b/, 'Learning & exploration'],
];

// Otherwise, the first keyword family that matches, in priority order.
const KEYWORDS = [
  [/\b(tests?|spec|e2e|playwright|cypress|selenium|jest|pytest|junit|qa|test cases?|test plan|regression)\b/, 'Testing & QA'],
  [/\b(bug|error|exception|crash|broken|failing|fails?|failed|not working|regression bug|stack ?trace|500)\b/, 'Bug fixing'],
  [/\b(review|pull request|\bpr\b|code quality)\b/, 'Code review'],
  [/\b(refactor\w*|tech debt|cleanup|rename)\b/, 'Refactoring'],
  [/\b(readme|docs?|documentation|release notes|changelog|requirements|srs|spec document|summary|pdf)\b/, 'Docs & analysis'],
  [/\b(deploy\w*|pipeline|ci|cd|docker|kubernetes|k8s|terraform|helm|build fails?|infra\w*)\b/, 'DevOps & build'],
  [/\b(feature|endpoint|api|page|screen|component|form|implement\w*|integrat\w*|export)\b/, 'Feature development'],
  [/\b(explain|how (do|does|to)|what is|why|questions?|understand|learn|example)\b/, 'Learning & exploration'],
];

function classifyText(text) {
  const t = String(text || '').toLowerCase().replace(/^[^a-z]+/, '').replace(/^(please|can you|could you|help me|i need to|let'?s|we need to)\s+/, '');
  for (const [re, p] of LEADING) if (re.test(t)) return p;
  for (const [re, p] of KEYWORDS) if (re.test(t)) return p;
  return null;
}

function classifyPurpose(session) {
  const prompts = session.prompts && session.prompts.length ? session.prompts : [session.firstPrompt || ''];
  const first = classifyText(prompts[0]);
  if (first) return first;
  const rest = classifyText(prompts.slice(1).join(' '));
  if (rest) return rest;
  return session.edits > 0 ? 'Feature development' : 'General Q&A';
}

module.exports = { classifyPurpose, classifyText, PURPOSES, DELIVERY };
