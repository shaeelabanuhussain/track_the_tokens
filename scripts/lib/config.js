'use strict';
// User settings and TokenLens' own data live in ~/.claude/tokenlens/.

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  budgetPerSession: 5, // USD: warn when a session crosses this
  budgetPerDay: 25, // USD
  contextWarnPct: 60, // nudge to /compact or /clear above this
  idleCacheWarn: true, // warn when returning to a big context after the cache expired
  pdfAutoConvert: true, // convert PDFs to Markdown before Claude reads them
  sessionStartBanner: true,
  timezone: null, // defaults to the system timezone
  teamDir: null, // shared folder for /tokenlens:share and /tokenlens:team
  shareTaskTitles: false, // include the first 80 chars of each task when sharing
  developer: null, // { "name", "email", "role" }; defaults to git config
};

function dataDir() {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const dir = path.join(home, 'tokenlens');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

let cached = null;
function loadConfig() {
  if (cached) return cached;
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(path.join(dataDir(), 'config.json'), 'utf8'));
  } catch {}
  cached = { ...DEFAULTS, ...user };
  return cached;
}

module.exports = { loadConfig, dataDir, DEFAULTS };
