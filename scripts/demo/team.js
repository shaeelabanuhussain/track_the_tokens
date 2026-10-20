#!/usr/bin/env node
'use strict';
// Builds a demo team: six developers with different habits, each sharing a
// summary into <out>/team, then prints the team report.
//   node scripts/demo/team.js [out] && node scripts/tokenlens.js team --dir <out>/team --html --open

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'demo-data', 'team-demo'));
const teamDir = path.join(out, 'team');
const CLI = path.join(__dirname, '..', 'tokenlens.js');
const GEN = path.join(__dirname, 'generate.js');

const DEVS = [
  { name: 'Dev A', email: 'dev.a@example.com', role: 'Senior developer', mix: 'lean:1', perDay: '8-10', limitHits: 4 },
  { name: 'Dev B', email: 'dev.b@example.com', role: 'Developer', mix: 'marathon:3,pdf-reader:2,lean:1', perDay: '2-3', limitHits: 3 },
  { name: 'QA C', email: 'qa.c@example.com', role: 'QA engineer', mix: 'qa-logs:3,lean:1', perDay: '2-3' },
  { name: 'Dev D', email: 'dev.d@example.com', role: 'Developer', mix: 'chatty-opus:4,explorer:2', perDay: '7-9', limitHits: 2 },
  { name: 'Dev E', email: 'dev.e@example.com', role: 'Developer', mix: 'lean:3', perDay: '1-2' },
  { name: 'QA F', email: 'qa.f@example.com', role: 'QA lead', mix: 'lean:8,qa-logs:1', perDay: '6-7', limitHits: 3 },
];

fs.rmSync(teamDir, { recursive: true, force: true });
DEVS.forEach((d, i) => {
  const home = path.join(out, 'devs', d.email.split('@')[0]);
  fs.rmSync(home, { recursive: true, force: true });
  execFileSync('node', [GEN, home, '--seed', String(101 + i * 17), '--mix', d.mix, '--per-day', d.perDay, '--limit-hits', String(d.limitHits || 0)]);
  fs.mkdirSync(path.join(home, 'tokenlens'), { recursive: true });
  fs.writeFileSync(path.join(home, 'tokenlens', 'config.json'), JSON.stringify({ developer: { name: d.name, email: d.email, role: d.role }, shareTaskTitles: true }, null, 2));
  execFileSync('node', [CLI, 'share', '--dir', teamDir, '--days', '30'], { env: { ...process.env, CLAUDE_CONFIG_DIR: home } });
});
console.log(`✓ ${DEVS.length} demo developers shared into ${teamDir}`);
console.log(`  Team report: node scripts/tokenlens.js team --dir ${teamDir} [--html --open]`);
