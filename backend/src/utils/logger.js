/**
 * Minimal structured logger. Any key that looks like a secret is redacted so
 * API keys / tokens / passwords never reach the logs.
 */
const SECRET_KEY = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|service[_-]?role)/i;

function redact(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') {
    if (typeof value === 'string') return value.replace(/api_key=[^&\s"]+/gi, 'api_key=[REDACTED]');
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), code: value.code, status: value.status };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function write(level, message, meta) {
  if (process.env.NODE_ENV === 'test' && level === 'debug') return;
  const line = { time: new Date().toISOString(), level, message: redact(message), ...(meta ? { meta: redact(meta) } : {}) };
  const text = JSON.stringify(line);
  if (level === 'error' || level === 'warn') console.error(text);
  else console.log(text);
}

export const logger = {
  debug: (m, meta) => write('debug', m, meta),
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
  redact,
};
