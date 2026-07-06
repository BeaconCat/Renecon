/**
 * Interval scheduler.
 *
 * Every `intervalMinutes` it runs the pipeline over the window since the last
 * run. Reacts to config changes (interval / enabled toggle) live. Also exposes
 * a manual trigger for the WebGUI's "run now" button.
 */

import { getConfig, onConfigChange } from '../config/store.js';
import { getState, setState } from '../db/index.js';
import { runPipeline } from './runner.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('scheduler');
const CURSOR_KEY = 'pipeline.lastWindowEnd';

class Scheduler {
  constructor() {
    this.timer = null;
    this.running = false;         // a run is in flight
    this.lastWindowEnd = null;    // unix seconds
    this.lastRunAt = null;
    this.nextRunAt = null;
    this.intervalMs = null;
  }

  start() {
    // Restore the persisted window cursor so messages archived while Renecon
    // was down still get summarised on the next run (no gap across restarts).
    const saved = getState(CURSOR_KEY);
    if (saved != null) {
      this.lastWindowEnd = Number(saved);
      log.info(`Restored window cursor: ${new Date(this.lastWindowEnd * 1000).toISOString()}`);
    }
    this.applyConfig();
    onConfigChange((cfg, section) => {
      if (section === 'pipeline' || section === '*') this.applyConfig();
    });
  }

  setCursor(unixSeconds) {
    this.lastWindowEnd = unixSeconds;
    try {
      setState(CURSOR_KEY, unixSeconds);
    } catch (err) {
      log.error('Failed to persist window cursor:', err);
    }
  }

  applyConfig() {
    const cfg = getConfig();
    this.clearTimer();
    if (!cfg.pipeline.enabled) {
      this.nextRunAt = null;
      log.info('Pipeline disabled, scheduler idle.');
      return;
    }
    const minutes = Math.max(1, Number(cfg.pipeline.intervalMinutes) || 15);
    this.intervalMs = minutes * 60 * 1000;
    if (this.lastWindowEnd == null) {
      this.setCursor(Math.floor(Date.now() / 1000));
    }
    this.scheduleNext();
    log.info(`Scheduler armed, every ${minutes} min.`);
  }

  scheduleNext() {
    this.clearTimer();
    this.nextRunAt = Date.now() + this.intervalMs;
    this.timer = setTimeout(() => this.tick(), this.intervalMs);
  }

  async tick() {
    const cfg = getConfig();
    if (!cfg.pipeline.enabled) return;
    const windowStart = this.lastWindowEnd;
    const windowEnd = Math.floor(Date.now() / 1000);
    await this.execute(cfg, windowStart, windowEnd);
    this.setCursor(windowEnd);
    if (cfg.pipeline.enabled) this.scheduleNext();
  }

  async execute(cfg, windowStart, windowEnd) {
    if (this.running) {
      log.warn('Previous run still in flight, skipping.');
      return null;
    }
    this.running = true;
    this.lastRunAt = Date.now();
    try {
      return await runPipeline(cfg, windowStart, windowEnd);
    } finally {
      this.running = false;
    }
  }

  /**
   * Manually run over the last `minutes` (default = configured interval).
   * Does not disturb the automatic window bookkeeping.
   */
  async runNow(minutes) {
    const cfg = getConfig();
    const span = (minutes || cfg.pipeline.intervalMinutes || 15) * 60;
    const windowEnd = Math.floor(Date.now() / 1000);
    const windowStart = windowEnd - span;
    return this.execute(cfg, windowStart, windowEnd);
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getState() {
    return {
      enabled: getConfig().pipeline.enabled,
      running: this.running,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      lastWindowEnd: this.lastWindowEnd,
    };
  }
}

export const scheduler = new Scheduler();
