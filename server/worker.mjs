const MAX_BODY_BYTES = 16 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;
const CONSENT_VERSION = '2026-11-07';
const PRODUCTION_HOSTS = new Set(['flscratchstats.com', 'www.flscratchstats.com']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const DELETE_EXPIRED_SQL = 'DELETE FROM sponsor_inquiries WHERE created_at < ?1';
// One atomic INSERT prevents concurrent submissions bypassing the rolling dedup window.
const INSERT_SQL = `INSERT INTO sponsor_inquiries
  (id, created_at, name, company, email, message, budget, consent_version)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
  WHERE NOT EXISTS (
    SELECT 1 FROM sponsor_inquiries WHERE email = ?5 AND created_at >= ?9
  )`;

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function error(status, code, extraHeaders) {
  return json(status, { ok: false, error: code }, extraHeaders);
}

function allowedOrigin(request, url) {
  const originHeader = request.headers.get('Origin');
  if (!originHeader || request.headers.get('Sec-Fetch-Site') === 'cross-site') return false;
  let origin;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }
  // Reject non-origin values (paths, credentials, opaque origins and malformed headers).
  if (origin.origin !== originHeader) return false;
  if (PRODUCTION_HOSTS.has(url.hostname)) {
    return url.protocol === 'https:' && !url.port && origin.protocol === 'https:' &&
      !origin.port && PRODUCTION_HOSTS.has(origin.hostname);
  }
  return LOOPBACK_HOSTS.has(url.hostname) &&
    (url.protocol === 'http:' || url.protocol === 'https:') && origin.origin === url.origin;
}

async function boundedBody(request) {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    return { error: error(413, 'body_too_large') };
  }
  if (!request.body) return { error: error(400, 'invalid_json') };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { error: error(413, 'body_too_large') };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { error: error(400, 'invalid_json') };
  } finally {
    reader.releaseLock();
  }
}

function cleanText(value, minimum, maximum, multiline = false) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) return null;
  // Keep messages as plain text; reject control characters while allowing normal line breaks.
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  return controls.test(normalized) ? null : normalized;
}

function validateSubmission(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.consent !== true || (body.website !== undefined && body.website !== '')) return null;
  if (!Number.isFinite(body.formStartedAt) || now - body.formStartedAt < 2000 ||
      now - body.formStartedAt > DAY_MS) return null;
  const name = cleanText(body.name, 2, 120);
  const company = cleanText(body.company, 2, 160);
  const email = cleanText(body.email, 3, 254)?.toLowerCase();
  const message = cleanText(body.message, 20, 4000, true);
  const budget = body.budget === undefined || body.budget === ''
    ? null : cleanText(body.budget, 1, 120);
  if (!name || !company || !email || !message ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      (body.budget !== undefined && body.budget !== '' && !budget)) return null;
  return { name, company, email, message, budget };
}

async function sponsorInquiry(request, env, url) {
  if (request.method !== 'POST') return error(405, 'method_not_allowed', { Allow: 'POST' });
  if (!allowedOrigin(request, url)) return error(403, 'origin_not_allowed');
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error(415, 'json_required');
  }
  const parsed = await boundedBody(request);
  if (parsed.error) return parsed.error;
  const now = Date.now();
  const submission = validateSubmission(parsed.value, now);
  if (!submission) return error(400, 'invalid_submission');
  if (!env.LEADS?.prepare || !env.LEADS?.batch) return error(503, 'inquiries_unavailable');

  const id = crypto.randomUUID();
  try {
    // No IP, user agent or referrer is stored. Bound values never become SQL text.
    const results = await env.LEADS.batch([
      env.LEADS.prepare(DELETE_EXPIRED_SQL).bind(now - RETENTION_MS),
      env.LEADS.prepare(INSERT_SQL).bind(
        id, now, submission.name, submission.company, submission.email,
        submission.message, submission.budget, CONSENT_VERSION, now - DAY_MS,
      ),
    ]);
    if (results.length !== 2 || results.some(result => result.success !== true)) {
      return error(503, 'inquiries_unavailable');
    }
    if (results[1].meta?.changes === 0) {
      return error(409, 'duplicate_inquiry', { 'Retry-After': '86400' });
    }
    if (results[1].meta?.changes !== 1) return error(503, 'inquiries_unavailable');
    return json(201, { ok: true, id });
  } catch {
    // Do not log submissions, bound values or database errors containing personal details.
    return error(503, 'inquiries_unavailable');
  }
}

async function storageHealth(request, env) {
  if (request.method !== 'GET') return error(405, 'method_not_allowed', { Allow: 'GET' });
  if (!env.LEADS?.prepare) return error(503, 'storage_unavailable');
  try {
    // Compile/query the required table without reading a row or exposing private data.
    const result = await env.LEADS.prepare('SELECT id FROM sponsor_inquiries LIMIT 0').run();
    if (result.success !== true) return error(503, 'storage_unavailable');
    return json(200, { ok: true, storage: 'ready' });
  } catch {
    return error(503, 'storage_unavailable');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return storageHealth(request, env);
    if (url.pathname === '/api/sponsorship') return sponsorInquiry(request, env, url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return error(404, 'not_found');
    if (!env.ASSETS?.fetch) return error(503, 'site_unavailable');
    return env.ASSETS.fetch(request);
  },

  // Configure one daily Cron Trigger to enforce retention even when no inquiries arrive.
  async scheduled(_controller, env) {
    if (!env.LEADS?.prepare) return;
    try {
      const result = await env.LEADS.prepare(DELETE_EXPIRED_SQL).bind(Date.now() - RETENTION_MS).run();
      if (result.success !== true) throw new Error('cleanup_failed');
    } catch {
      throw new Error('Sponsor inquiry retention cleanup failed');
    }
  },
};
