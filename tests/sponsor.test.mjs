import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../server/worker.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const migration = readFileSync(new URL('../migrations/0001_sponsor_inquiries.sql', import.meta.url), 'utf8');

// D1-compatible surface backed by real SQLite: SQL syntax, bound values and dedup execute.
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  t.after(() => sqlite.close());
  const calls = [];
  return {
    sqlite,
    calls,
    prepare(sql) {
      const run = (...values) => {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      };
      return {
        run: async () => run(),
        bind(...values) {
          calls.push({ sql, values });
          return { run: async () => run(...values) };
        },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function valid(overrides = {}) {
  return {
    name: 'Taylor Example', company: 'Example Company', email: 'taylor@example.com',
    message: 'We would like to discuss sponsoring the independent statistics tool.',
    budget: '', website: '', formStartedAt: Date.now() - 5000, consent: true,
    ...overrides,
  };
}

function request(body = valid(), options = {}) {
  const { url = 'https://flscratchstats.com/api/sponsorship', headers, ...other } = options;
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(url).origin, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...other,
  });
}

async function responseError(response, status, error) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { ok: false, error });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
}

test('a valid inquiry is durably inserted with normalized email and no public personal data', async t => {
  const db = database(t);
  const response = await worker.fetch(request(valid({ email: ' TAYLOR@EXAMPLE.COM ', budget: 'Discuss individually' })), { LEADS: db });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.match(result.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(Object.keys(result).sort(), ['id', 'ok']);
  const stored = db.sqlite.prepare('SELECT * FROM sponsor_inquiries').get();
  assert.equal(stored.id, result.id);
  assert.equal(stored.email, 'taylor@example.com');
  assert.equal(stored.budget, 'Discuss individually');
  assert.equal(stored.consent_version, '2026-11-07');
  assert.deepEqual(Object.keys(stored).sort(), ['budget', 'company', 'consent_version', 'created_at', 'email', 'id', 'message', 'name']);
});

test('SQL-looking messages and company names stay literal and do not damage the table', async t => {
  const db = database(t);
  const attack = "Example'); DROP TABLE sponsor_inquiries; --";
  const payload = valid({ company: attack, message: `Please discuss this proposal: ${attack}` });
  assert.equal((await worker.fetch(request(payload), { LEADS: db })).status, 201);
  assert.equal(db.sqlite.prepare('SELECT company FROM sponsor_inquiries').get().company, attack);
  assert.ok(db.calls.every(call => !call.sql.includes(attack)));
  assert.ok(db.calls.some(call => call.values.includes(attack)));
  assert.equal((await worker.fetch(request(valid({ email: 'other@example.com' })), { LEADS: db })).status, 201);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM sponsor_inquiries').get().count, 2);
});

test('same email is deduplicated for 24 hours, then can submit again', async t => {
  const db = database(t);
  assert.equal((await worker.fetch(request(), { LEADS: db })).status, 201);
  await responseError(await worker.fetch(request(valid({ email: 'TAYLOR@example.com' })), { LEADS: db }), 409, 'duplicate_inquiry');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM sponsor_inquiries').get().count, 1);
  db.sqlite.prepare('UPDATE sponsor_inquiries SET created_at = ?').run(Date.now() - DAY_MS - 1000);
  assert.equal((await worker.fetch(request(), { LEADS: db })).status, 201);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM sponsor_inquiries').get().count, 2);
});

test('missing or failing database never reports that an inquiry was received', async () => {
  await responseError(await worker.fetch(request(), {}), 503, 'inquiries_unavailable');
  const unavailable = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('private details should not escape'); } };
  await responseError(await worker.fetch(request(), { LEADS: unavailable }), 503, 'inquiries_unavailable');
  for (const results of [[], [{ success: true }, { success: false }], [{ success: true }, { success: true, meta: {} }]]) {
    await responseError(await worker.fetch(request(), { LEADS: { ...unavailable, batch: async () => results } }), 503, 'inquiries_unavailable');
  }
});

test('cross-site, opaque, missing and forged-origin values fail before storage', async t => {
  const db = database(t);
  for (const origin of ['https://attacker.example', 'null', '', 'https://flscratchstats.com.attacker.example', 'https://flscratchstats.com/path', 'http://flscratchstats.com']) {
    await responseError(await worker.fetch(request(valid(), { headers: { Origin: origin } }), { LEADS: db }), 403, 'origin_not_allowed');
  }
  await responseError(await worker.fetch(request(valid(), { headers: { 'Sec-Fetch-Site': 'cross-site' } }), { LEADS: db }), 403, 'origin_not_allowed');
  assert.equal(db.calls.length, 0);
});

test('production www and exact loopback origins work; unrelated local origins do not', async t => {
  const db = database(t);
  for (const url of ['https://www.flscratchstats.com/api/sponsorship', 'http://localhost:8787/api/sponsorship', 'http://127.0.0.1:8787/api/sponsorship', 'http://[::1]:8787/api/sponsorship']) {
    assert.equal((await worker.fetch(request(valid({ email: `${crypto.randomUUID()}@example.com` }), { url }), { LEADS: db })).status, 201);
  }
  await responseError(await worker.fetch(request(valid(), { url: 'http://localhost:8787/api/sponsorship', headers: { Origin: 'http://localhost:9999' } }), { LEADS: db }), 403, 'origin_not_allowed');
});

test('invalid consent, spam traps, timing, types and field limits do not write data', async t => {
  const db = database(t);
  for (const payload of [
    [], null, valid({ consent: false }), valid({ consent: 'true' }), valid({ website: 'filled by bot' }),
    valid({ formStartedAt: Date.now() }), valid({ formStartedAt: Date.now() + 5000 }),
    valid({ formStartedAt: Date.now() - DAY_MS - 5000 }), valid({ formStartedAt: '5000' }),
    valid({ email: 'not an email' }), valid({ email: 'a'.repeat(255) + '@example.com' }),
    valid({ name: 'A' }), valid({ company: 'A' }), valid({ message: 'Too short' }),
    valid({ message: 'a'.repeat(4001) }), valid({ name: 'a'.repeat(121) }),
    valid({ company: 'a'.repeat(161) }), valid({ budget: 'a'.repeat(121) }),
    valid({ name: 'Line\nbreak' }), valid({ message: 'Invalid control here: \u0000 and some text.' }),
    valid({ budget: 500 }), valid({ email: { address: 'bad@example.com' } }),
  ]) {
    await responseError(await worker.fetch(request(payload), { LEADS: db }), 400, 'invalid_submission');
  }
  assert.equal(db.calls.length, 0);
});

test('bad JSON, wrong content type and actual streamed size limits fail safely', async t => {
  const db = database(t);
  await responseError(await worker.fetch(request('{"broken":'), { LEADS: db }), 400, 'invalid_json');
  await responseError(await worker.fetch(request(valid(), { headers: { 'Content-Type': 'text/plain' } }), { LEADS: db }), 415, 'json_required');
  await responseError(await worker.fetch(request('a'.repeat(16385)), { LEADS: db }), 413, 'body_too_large');
  await responseError(await worker.fetch(request(valid(), { headers: { 'Content-Length': '999999' } }), { LEADS: db }), 413, 'body_too_large');
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(' '.repeat(8192)));
    controller.enqueue(new TextEncoder().encode(' '.repeat(8193)));
    controller.close();
  } });
  const streamedRequest = new Request('https://flscratchstats.com/api/sponsorship', {
    method: 'POST', body: stream, duplex: 'half', headers: { Origin: 'https://flscratchstats.com', 'Content-Type': 'application/json' },
  });
  await responseError(await worker.fetch(streamedRequest, { LEADS: db }), 413, 'body_too_large');
  assert.equal(db.calls.length, 0);
});

test('API reads and unknown API paths never expose inquiries or fall through to assets', async () => {
  let assetCalls = 0;
  const env = { ASSETS: { fetch: () => { assetCalls++; return new Response('asset'); } } };
  const get = await worker.fetch(new Request('https://flscratchstats.com/api/sponsorship'), env);
  assert.equal(get.headers.get('Allow'), 'POST');
  await responseError(get, 405, 'method_not_allowed');
  for (const path of ['/api', '/api/sponsor-inquiries', '/api/sponsorship/123']) {
    await responseError(await worker.fetch(new Request(`https://flscratchstats.com${path}`), env), 404, 'not_found');
  }
  assert.equal(assetCalls, 0);
  const asset = new Request('https://flscratchstats.com/g/1647');
  let passed;
  assert.equal(await (await worker.fetch(asset, { ASSETS: { fetch: req => { passed = req; return new Response('game HTML'); } } })).text(), 'game HTML');
  assert.equal(passed, asset);
});

test('30-day retention removes expired rows while preserving recent inquiries', async t => {
  const db = database(t);
  assert.equal((await worker.fetch(request(), { LEADS: db })).status, 201);
  db.sqlite.prepare('UPDATE sponsor_inquiries SET created_at = ?').run(Date.now() - 31 * DAY_MS);
  assert.equal((await worker.fetch(request(valid({ email: 'new@example.com' })), { LEADS: db })).status, 201);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM sponsor_inquiries').get().count, 1);
  db.sqlite.prepare('UPDATE sponsor_inquiries SET created_at = ?').run(Date.now() - 31 * DAY_MS);
  await worker.scheduled({}, { LEADS: db });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM sponsor_inquiries').get().count, 0);
});

test('health checks queryable storage without returning inquiry data or counts', async t => {
  const db = database(t);
  assert.equal((await worker.fetch(request(), { LEADS: db })).status, 201);
  const response = await worker.fetch(new Request('https://flscratchstats.com/api/health'), { LEADS: db });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, storage: 'ready' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM sponsor_inquiries').get().count, 1);
  const post = await worker.fetch(new Request('https://flscratchstats.com/api/health', { method: 'POST' }), { LEADS: db });
  assert.equal(post.headers.get('Allow'), 'GET');
  await responseError(post, 405, 'method_not_allowed');
});

test('health fails closed for missing binding, missing migrated table and database failures', async t => {
  const healthRequest = () => new Request('https://flscratchstats.com/api/health');
  await responseError(await worker.fetch(healthRequest(), {}), 503, 'storage_unavailable');
  const db = database(t);
  db.sqlite.exec('DROP TABLE sponsor_inquiries');
  await responseError(await worker.fetch(healthRequest(), { LEADS: db }), 503, 'storage_unavailable');
  for (const binding of [
    { prepare: () => { throw new Error('private database details'); } },
    { prepare: () => ({ run: async () => ({ success: false }) }) },
  ]) {
    await responseError(await worker.fetch(healthRequest(), { LEADS: binding }), 503, 'storage_unavailable');
  }
});
