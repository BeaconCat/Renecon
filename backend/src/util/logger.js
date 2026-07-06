/**
 * Minimal leveled logger with an in-memory ring buffer.
 *
 * The ring buffer lets the WebGUI pull recent runtime logs over REST without
 * wiring up a separate log-shipping stack.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BUFFER = 500;

const buffer = [];
let minLevel = LEVELS.info;

function push(level, scope, message) {
  const entry = {
    time: new Date().toISOString(),
    level,
    scope,
    message,
  };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  if (LEVELS[level] >= minLevel) {
    const line = `[${entry.time}] ${level.toUpperCase().padEnd(5)} ${scope} - ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
}

function format(args) {
  return args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ');
}

function safeStringify(value) {
  try {
    if (value instanceof Error) return value.stack || value.message;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Create a scoped logger. Scope shows up in every line so log origins stay
 * traceable across modules.
 * @param {string} scope
 */
export function createLogger(scope) {
  return {
    debug: (...args) => push('debug', scope, format(args)),
    info: (...args) => push('info', scope, format(args)),
    warn: (...args) => push('warn', scope, format(args)),
    error: (...args) => push('error', scope, format(args)),
  };
}

export function setLogLevel(level) {
  if (LEVELS[level] != null) minLevel = LEVELS[level];
}

/**
 * Return recent log entries, newest last.
 * @param {number} [limit]
 */
export function getRecentLogs(limit = 200) {
  return buffer.slice(-limit);
}
