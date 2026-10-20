'use strict';
// "Best time to use Claude". On 2026-03-26 Anthropic said 5-hour session limits
// for Free/Pro/Max drain faster during weekday peak hours, 05:00-11:00
// America/Los_Angeles. Weekly limits are unchanged. The window is configurable
// in ~/.claude/tokenlens/config.json (peak: { start, end, tz, days }) in case it changes.

const { loadConfig } = require('./config');

const DEFAULT_PEAK = { start: 5, end: 11, tz: 'America/Los_Angeles', days: [1, 2, 3, 4, 5] };

function partsIn(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: 'numeric', minute: 'numeric' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: days[p.weekday], hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

function isPeak(date, peak) {
  const p = partsIn(date, peak.tz);
  return peak.days.includes(p.day) && p.hour >= peak.start && p.hour < peak.end;
}

// Minutes until the peak state flips, scanning in 15-minute steps (handles DST).
function minutesUntilFlip(date, peak) {
  const now = isPeak(date, peak);
  for (let m = 15; m <= 7 * 24 * 60; m += 15) {
    if (isPeak(new Date(date.getTime() + m * 60000), peak) !== now) return m;
  }
  return null;
}

function localHourRange(peak, localTz, ref = new Date()) {
  // Find the local clock times of today's peak start/end.
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: localTz, hour: '2-digit', minute: '2-digit' });
  let start = null;
  let end = null;
  const base = new Date(ref);
  base.setUTCMinutes(0, 0, 0);
  for (let h = -24; h < 48; h++) {
    const d = new Date(base.getTime() + h * 3600000);
    const p = partsIn(d, peak.tz);
    if (p.hour === peak.start && start === null && p.minute === 0) start = fmt.format(d);
    if (p.hour === peak.end && end === null && p.minute === 0) end = fmt.format(d);
  }
  return { start, end };
}

function timingAdvice(date = new Date()) {
  const cfg = loadConfig();
  const peak = { ...DEFAULT_PEAK, ...(cfg.peak || {}) };
  const localTz = cfg.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const peakNow = isPeak(date, peak);
  const flip = minutesUntilFlip(date, peak);
  const range = localHourRange(peak, localTz, date);
  const inText = flip == null ? '' : flip < 90 ? `${flip}m` : `${Math.round(flip / 60)}h`;
  return {
    peakNow,
    flipInMinutes: flip,
    localTz,
    localPeak: range,
    short: peakNow ? `peak hrs, off-peak in ${inText}` : `off-peak${flip && flip < 180 ? `, peak in ${inText}` : ''}`,
    advice: peakNow
      ? `Peak hours now (${range.start}-${range.end} ${localTz}, weekdays): your 5-hour plan limit drains faster. Do reviews, planning and small edits now; queue big refactors, large-context analysis and agent fan-outs for off-peak (in ~${inText}).`
      : `Off-peak now: best time for token-heavy work (big refactors, multi-agent runs, whole-repo analysis). Peak is ${range.start}-${range.end} ${localTz} on weekdays.`,
  };
}

module.exports = { timingAdvice, isPeak, DEFAULT_PEAK };
