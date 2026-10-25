'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nonnegative(value) { return Number.isFinite(value) && value >= 0 ? value : 0; }
function cleanUsage(value = {}) {
  const days = {};
  for (const [key, row] of Object.entries(value.days || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) days[key] = { usageMs: nonnegative(row?.usageMs), companionshipMs: nonnegative(row?.companionshipMs) };
  }
  return { version: 1, usageMs: nonnegative(value.usageMs), companionshipMs: nonnegative(value.companionshipMs), days };
}
/** One clock for the entire app. Two companion windows never count twice. */
class UsageTracker {
  constructor({ file, wallNow = Date.now, monotonicNow = () => performance.now(), maxGapMs = 120000 } = {}) {
    this.file = file; this.wallNow = wallNow; this.monotonicNow = monotonicNow; this.maxGapMs = maxGapMs;
    this.data = cleanUsage(); this.session = { usageMs: 0, companionshipMs: 0 };
    this.active = { main: false, companion: false, paused: false };
    this.lastWall = wallNow(); this.lastMono = monotonicNow(); this.writeQueue = Promise.resolve();
  }
  async load() {
    if (this.file) {
      try { this.data = cleanUsage(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('陪伴记录读取失败，原文件已保留。', { cause: error }); }
    }
    this.lastWall = this.wallNow(); this.lastMono = this.monotonicNow();
    return this.snapshot();
  }
  update(next = {}) { this.tick(); this.active = { ...this.active, ...next }; return this.snapshot(false); }
  tick() {
    const wall = this.wallNow(), mono = this.monotonicNow();
    const delta = mono - this.lastMono, wallDelta = wall - this.lastWall;
    const fromWall = this.lastWall;
    this.lastWall = wall; this.lastMono = mono;
    // Resume events normally pause the clock. A missed event or stalled process must not count hours of sleep.
    if (this.active.paused || delta <= 0 || delta > this.maxGapMs || (!this.active.main && !this.active.companion)) return;
    this.data.usageMs += delta; this.session.usageMs += delta;
    if (this.active.companion) { this.data.companionshipMs += delta; this.session.companionshipMs += delta; }
    // Monotonic elapsed time is authoritative. Wall time is used only to allocate a normal interval across midnight.
    if (Math.abs(wallDelta - delta) > 5000 || wallDelta <= 0) this.addDay(dayKey(wall), delta);
    else {
      let cursor = fromWall;
      while (cursor < wall) {
        const d = new Date(cursor); d.setHours(24, 0, 0, 0);
        const end = Math.min(wall, d.getTime());
        this.addDay(dayKey(cursor), delta * ((end - cursor) / wallDelta)); cursor = end;
      }
    }
  }
  addDay(key, ms) {
    const row = this.data.days[key] ||= { usageMs: 0, companionshipMs: 0 };
    row.usageMs += ms; if (this.active.companion) row.companionshipMs += ms;
  }
  snapshot(tick = true) {
    if (tick) this.tick();
    return { ...structuredClone(this.data), today: { date: dayKey(this.wallNow()), ...(this.data.days[dayKey(this.wallNow())] || { usageMs: 0, companionshipMs: 0 }) }, session: { ...this.session }, running: !this.active.paused && (this.active.main || this.active.companion) };
  }
  async save() {
    this.tick(); if (!this.file) return;
    const value = JSON.stringify(this.data);
    const job = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(`${this.file}.tmp`, value, 'utf8'); await fs.rename(`${this.file}.tmp`, this.file);
    });
    this.writeQueue = job.catch(() => {}); return job;
  }
  async reset() { this.tick(); this.data = cleanUsage(); this.session = { usageMs: 0, companionshipMs: 0 }; await this.save(); return this.snapshot(); }
}
module.exports = { UsageTracker, cleanUsage, dayKey };
