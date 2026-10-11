'use strict';

/*
 * Integration tests: a real Express app, real SQLite (in memory), real bcrypt
 * (cost 4 so the suite stays fast). Run with `npm test`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

function boot(extraEnv = {}) {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-secret-'.padEnd(48, 'x'),
    BCRYPT_ROUNDS: '4',
    RATE_LIMIT_MAX: '1000',
    ...extraEnv,
  });
  const db = openDb(':memory:');
  const server = createApp(cfg, db).listen(0);
  const base = { host: '127.0.0.1', port: server.address().port };
  return { cfg, db, server, base, close: () => new Promise((r) => server.close(() => (db.close(), r()))) };
}

/** A tiny browser: keeps cookies and the CSRF token between calls. */
function client(base) {
  const jar = {};
  let csrf = null;

  function send(method, path, body, opts = {}) {
    return new Promise((resolve, reject) => {
      const headers = { ...(opts.headers || {}) };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) headers.cookie = cookie;
      const payload = body === undefined ? null : JSON.stringify(body);
      if (payload) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(payload);
      }
      if (opts.csrf !== false && csrf) headers['x-csrf-token'] = csrf;
      if (opts.csrf) headers['x-csrf-token'] = opts.csrf;

      const req = http.request({ ...base, method, path, headers }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'] || [];
          for (const sc of setCookie) {
            const [pair] = sc.split(';');
            const i = pair.indexOf('=');
            const name = pair.slice(0, i);
            const value = pair.slice(i + 1);
            if (!value || /expires=Thu, 01 Jan 1970/i.test(sc)) delete jar[name];
            else jar[name] = value;
          }
          let data = null;
          try {
            data = JSON.parse(text);
          } catch (_) {
            /* html or empty */
          }
          if (data && data.csrf) csrf = data.csrf;
          resolve({ status: res.statusCode, headers: res.headers, setCookie, data, text });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  return {
    jar,
    get: (p, o) => send('GET', p, undefined, o),
    post: (p, b, o) => send('POST', p, b, o),
    del: (p, o) => send('DELETE', p, undefined, o),
    async start() {
      const r = await send('GET', '/api/csrf');
      csrf = r.data.csrf;
      return r;
    },
    sid: () => jar['forma.sid'],
    setCookieHeader: (v) => (jar['forma.sid'] = v),
  };
}

const good = (n) => ({ username: `user_${n}`, email: `user_${n}@example.com`, password: 'secret123', confirm: 'secret123' });

test('registration', async (t) => {
  const app = boot();
  t.after(app.close);

  await t.test('creates an account, signs in, and stores only a bcrypt hash', async () => {
    const c = client(app.base);
    await c.start();
    const r = await c.post('/api/register', good(1));
    assert.equal(r.status, 201);
    assert.equal(r.data.user.username, 'user_1');

    const cookie = r.setCookie.find((s) => s.startsWith('forma.sid='));
    assert.ok(cookie, 'session cookie set');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    const row = app.db.prepare('SELECT password_hash FROM users WHERE username = ?').get('user_1');
    assert.match(row.password_hash, /^\$2[aby]\$/);
    assert.notEqual(row.password_hash, 'secret123');

    assert.equal((await c.get('/api/me')).status, 200);
  });

  await t.test('rejects bad input on the server', async () => {
    const c = client(app.base);
    await c.start();
    const cases = [
      [{ ...good(2), password: 'short1', confirm: 'short1' }, 'password'],
      [{ ...good(2), password: 'longenoughbutnodigit', confirm: 'longenoughbutnodigit' }, 'password'],
      [{ ...good(2), confirm: 'different123' }, 'confirm'],
      [{ ...good(2), username: 'ab' }, 'username'],
      [{ ...good(2), username: "x'; DROP TABLE users;--" }, 'username'],
      [{ ...good(2), email: 'not-an-email' }, 'email'],
      [{}, 'username'],
    ];
    for (const [body, field] of cases) {
      const r = await c.post('/api/register', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.ok(r.data.errors[field], `expected an error on ${field}`);
    }
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users WHERE username = ?').get('user_2').n, 0);
  });

  await t.test('usernames and emails are unique, ignoring case', async () => {
    const c = client(app.base);
    await c.start();
    assert.equal((await c.post('/api/register', good(3))).status, 201);

    const d = client(app.base);
    await d.start();
    const dupName = await d.post('/api/register', { ...good(4), username: 'USER_3' });
    assert.equal(dupName.status, 409);
    assert.ok(dupName.data.errors.username);

    const dupEmail = await d.post('/api/register', { ...good(5), email: 'USER_3@EXAMPLE.COM' });
    assert.equal(dupEmail.status, 409);
    assert.ok(dupEmail.data.errors.email);
  });
});

test('login', async (t) => {
  const app = boot();
  t.after(app.close);

  const seed = client(app.base);
  await seed.start();
  await seed.post('/api/register', good(10));

  await t.test('works with username or email, any case', async () => {
    for (const identifier of ['user_10', 'USER_10', 'user_10@example.com', 'User_10@Example.com']) {
      const c = client(app.base);
      await c.start();
      const r = await c.post('/api/login', { identifier, password: 'secret123' });
      assert.equal(r.status, 200, identifier);
      assert.equal(r.data.user.username, 'user_10');
    }
  });

  await t.test('gives the same generic error for a wrong password and an unknown account', async () => {
    const c = client(app.base);
    await c.start();
    const wrong = await c.post('/api/login', { identifier: 'user_10', password: 'nope-nope-1' });
    const unknown = await c.post('/api/login', { identifier: 'nobody_here', password: 'nope-nope-1' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.data, unknown.data);
    assert.equal(c.sid() && (await c.get('/api/me')).status, 401, 'a failed login does not sign anyone in');
  });

  await t.test('is not injectable', async () => {
    const c = client(app.base);
    await c.start();
    for (const identifier of ["' OR '1'='1", "user_10' --", '" OR ""="']) {
      const r = await c.post('/api/login', { identifier, password: "' OR '1'='1" });
      assert.equal(r.status, 401, identifier);
    }
  });

  await t.test('issues a new session id at sign-in (no fixation)', async () => {
    const c = client(app.base);
    await c.start();
    const before = c.sid();
    assert.ok(before);
    await c.post('/api/login', { identifier: 'user_10', password: 'secret123' });
    assert.notEqual(c.sid(), before);
  });

  await t.test('is rate limited', async () => {
    const limited = boot({ RATE_LIMIT_MAX: '3' });
    try {
      const c = client(limited.base);
      await c.start();
      const statuses = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await c.post('/api/login', { identifier: 'ghost', password: 'whatever1' })).status);
      }
      assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});

test('csrf and origin protection', async (t) => {
  const app = boot();
  t.after(app.close);

  const c = client(app.base);
  await c.start();
  await c.post('/api/register', good(20));

  await t.test('state-changing requests need the token', async () => {
    const none = await c.post('/api/logout', undefined, { csrf: false });
    assert.equal(none.status, 403);
    assert.equal(none.data.error, 'csrf');

    const wrong = await c.post('/api/logout', undefined, { csrf: 'f'.repeat(64) });
    assert.equal(wrong.status, 403);

    assert.equal((await c.get('/api/me')).status, 200, 'still signed in after rejected logouts');
  });

  await t.test('a cross-origin Origin header is refused even with a valid token', async () => {
    const r = await c.post('/api/logout', undefined, { headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
  });

  await t.test('a login form post without the token never reaches the handler', async () => {
    const fresh = client(app.base);
    const r = await fresh.post('/api/login', { identifier: 'user_20', password: 'secret123' });
    assert.equal(r.status, 403);
  });
});

test('protected pages and logout', async (t) => {
  const app = boot();
  t.after(app.close);

  await t.test('dashboard redirects guests and is open to members', async () => {
    const guest = client(app.base);
    const r = await guest.get('/dashboard');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/login');
    assert.equal((await guest.get('/api/me')).status, 401);

    const member = client(app.base);
    await member.start();
    await member.post('/api/register', good(30));
    const page = await member.get('/dashboard');
    assert.equal(page.status, 200);
    assert.match(page.headers['cache-control'], /no-store/);

    // Signed-in people are sent past the login and register pages.
    assert.equal((await member.get('/login')).headers.location, '/dashboard');
  });

  await t.test('logout destroys the session on the server, not just in the browser', async () => {
    const c = client(app.base);
    await c.start();
    await c.post('/api/register', good(31));
    const stolen = c.sid();

    const out = await c.post('/api/logout');
    assert.equal(out.status, 200);
    assert.equal(c.sid(), undefined, 'cookie cleared');
    assert.equal((await c.get('/api/me')).status, 401);

    // Replaying the old cookie must not work.
    const thief = client(app.base);
    thief.setCookieHeader(stolen);
    assert.equal((await thief.get('/api/me')).status, 401);
    assert.equal((await thief.get('/dashboard')).status, 302);
  });
});

test('devices and password change', async (t) => {
  const app = boot();
  t.after(app.close);

  const a = client(app.base);
  await a.start();
  await a.post('/api/register', good(40));

  const b = client(app.base);
  await b.start();
  await b.post('/api/login', { identifier: 'user_40', password: 'secret123' }, {});

  await t.test('lists every signed-in device and marks the current one', async () => {
    const r = await a.get('/api/sessions');
    assert.equal(r.status, 200);
    assert.equal(r.data.sessions.length, 2);
    assert.equal(r.data.sessions.filter((s) => s.current).length, 1);
    for (const s of r.data.sessions) assert.match(s.id, /^[0-9a-f]{16}$/);
  });

  await t.test('can sign another device out, but not itself, through the list', async () => {
    const list = (await a.get('/api/sessions')).data.sessions;
    const mine = list.find((s) => s.current);
    const theirs = list.find((s) => !s.current);

    assert.equal((await a.del(`/api/sessions/${mine.id}`)).status, 404);
    assert.equal((await a.del(`/api/sessions/${theirs.id}`)).status, 200);
    assert.equal((await b.get('/api/me')).status, 401);
    assert.equal((await a.get('/api/me')).status, 200);
  });

  await t.test('changing the password checks the old one and signs other devices out', async () => {
    const c = client(app.base);
    await c.start();
    await c.post('/api/login', { identifier: 'user_40', password: 'secret123' });

    const wrong = await a.post('/api/password', { current: 'not-it-123', next: 'brandnew456', confirm: 'brandnew456' });
    assert.equal(wrong.status, 400);
    assert.ok(wrong.data.errors.current);

    const weak = await a.post('/api/password', { current: 'secret123', next: 'nodigitshere', confirm: 'nodigitshere' });
    assert.equal(weak.status, 400);
    assert.ok(weak.data.errors.next);

    const ok = await a.post('/api/password', { current: 'secret123', next: 'brandnew456', confirm: 'brandnew456' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.revoked, 1);
    assert.equal((await c.get('/api/me')).status, 401);
    assert.equal((await a.get('/api/me')).status, 200);

    const d = client(app.base);
    await d.start();
    assert.equal((await d.post('/api/login', { identifier: 'user_40', password: 'secret123' })).status, 401);
    assert.equal((await d.post('/api/login', { identifier: 'user_40', password: 'brandnew456' })).status, 200);
  });
});

test('hardening', async (t) => {
  const app = boot();
  t.after(app.close);

  await t.test('sends a strict CSP and hides the framework', async () => {
    const c = client(app.base);
    const r = await c.get('/login');
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-powered-by'], undefined);
    const csp = r.headers['content-security-policy'];
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
  });

  await t.test('API errors are JSON and unknown pages are 404', async () => {
    const c = client(app.base);
    await c.start();
    const bad = await c.post('/api/login', undefined, {});
    assert.equal(bad.status, 400);
    assert.equal((await c.get('/api/nope')).status, 404);
    assert.equal((await c.get('/nowhere')).status, 404);
  });
});
