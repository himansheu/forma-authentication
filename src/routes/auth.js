'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const { validateRegistration, validatePasswordChange, MAX_PASSWORD_BYTES } = require('../validate');
const { newToken, issueCsrf, requireAuthApi } = require('../middleware/security');
const { publicSessionId, describeAgent } = require('../util');

const INVALID_CREDENTIALS = {
  error: 'invalid_credentials',
  message: 'Username, email or password is incorrect.',
};

const regenerate = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
const save = (req) =>
  new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
const destroy = (req) =>
  new Promise((resolve, reject) => req.session.destroy((e) => (e ? reject(e) : resolve())));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function tooLong(password) {
  return Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES;
}

function createAuthRouter({ db, cfg }) {
  const router = express.Router();

  // Every query below is prepared and parameterised. No SQL is built from user input.
  const q = {
    findTaken: db.prepare('SELECT username, email FROM users WHERE username = @username OR email = @email'),
    insertUser: db.prepare(
      'INSERT INTO users (username, email, password_hash, created_at) VALUES (@username, @email, @hash, @now)'
    ),
    byIdentifier: db.prepare(
      'SELECT id, username, email, password_hash FROM users WHERE username = @id OR email = @id'
    ),
    byId: db.prepare('SELECT id, username, email, password_hash, created_at FROM users WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    sessionsForUser: db.prepare(
      'SELECT sid, user_agent, created_at, expires FROM sessions WHERE user_id = ? AND expires > ? ORDER BY created_at DESC'
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE sid = ? AND user_id = ?'),
    deleteOthers: db.prepare('DELETE FROM sessions WHERE user_id = ? AND sid != ?'),
  };

  // Compared against when the account does not exist, so "no such user" and
  // "wrong password" take the same time and return the same message.
  const DUMMY_HASH = bcrypt.hashSync('forma-timing-equaliser', cfg.bcryptRounds);

  const limiter = (opts = {}) =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: cfg.rateLimitMax,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, res) =>
        res.status(429).json({
          error: 'rate_limited',
          message: 'Too many attempts. Wait a few minutes, then try again.',
        }),
      ...opts,
    });
  const registerLimiter = limiter();
  const loginLimiter = limiter({ skipSuccessfulRequests: true });
  const passwordLimiter = limiter({ skipSuccessfulRequests: true });

  /** Start a fresh session for `user` (prevents session fixation) and return its CSRF token. */
  async function signIn(req, user) {
    const ua = (req.get('user-agent') || '').slice(0, 300);
    await regenerate(req);
    req.session.userId = user.id;
    req.session.ua = ua;
    req.session.csrf = newToken();
    await save(req);
    return req.session.csrf;
  }

  // --- CSRF bootstrap ------------------------------------------------------
  router.get('/csrf', (req, res) => {
    res.json({ csrf: issueCsrf(req) });
  });

  // --- Register ------------------------------------------------------------
  router.post(
    '/register',
    registerLimiter,
    wrap(async (req, res) => {
      const { values, errors } = validateRegistration(req.body);
      if (Object.keys(errors).length) {
        return res.status(400).json({ error: 'validation', errors });
      }

      const conflicts = {};
      for (const row of q.findTaken.all({ username: values.username, email: values.email })) {
        if (row.username.toLowerCase() === values.username.toLowerCase()) {
          conflicts.username = 'That username is taken.';
        }
        if (row.email.toLowerCase() === values.email) {
          conflicts.email = 'That email already has an account.';
        }
      }
      if (Object.keys(conflicts).length) {
        return res.status(409).json({ error: 'conflict', errors: conflicts });
      }

      const hash = await bcrypt.hash(values.password, cfg.bcryptRounds);

      let id;
      try {
        id = q.insertUser.run({
          username: values.username,
          email: values.email,
          hash,
          now: Date.now(),
        }).lastInsertRowid;
      } catch (err) {
        // Two people registering the same name at once: the UNIQUE index decides.
        if (err && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
          const field = /email/.test(err.message) ? 'email' : 'username';
          return res.status(409).json({
            error: 'conflict',
            errors: {
              [field]: field === 'email' ? 'That email already has an account.' : 'That username is taken.',
            },
          });
        }
        throw err;
      }

      const csrf = await signIn(req, { id: Number(id) });
      res.status(201).json({ user: { username: values.username, email: values.email }, csrf });
    })
  );

  // --- Login ---------------------------------------------------------------
  router.post(
    '/login',
    loginLimiter,
    wrap(async (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      const errors = {};
      if (!identifier) errors.identifier = 'Enter your username or email.';
      if (!password) errors.password = 'Enter your password.';
      if (Object.keys(errors).length) {
        return res.status(400).json({ error: 'validation', errors });
      }
      if (identifier.length > 254 || tooLong(password)) {
        return res.status(401).json(INVALID_CREDENTIALS);
      }

      const user = q.byIdentifier.get({ id: identifier });
      const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !ok) {
        return res.status(401).json(INVALID_CREDENTIALS);
      }

      const csrf = await signIn(req, user);
      res.json({ user: { username: user.username, email: user.email }, csrf });
    })
  );

  // --- Logout --------------------------------------------------------------
  router.post(
    '/logout',
    wrap(async (req, res) => {
      await destroy(req);
      res.clearCookie('forma.sid', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: cfg.secureCookie,
      });
      res.json({ ok: true });
    })
  );

  // --- Who am I ------------------------------------------------------------
  router.get(
    '/me',
    requireAuthApi,
    wrap(async (req, res) => {
      const user = q.byId.get(req.session.userId);
      if (!user) {
        await destroy(req);
        return res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
      }
      res.json({
        user: { username: user.username, email: user.email, createdAt: user.created_at },
      });
    })
  );

  // --- Devices -------------------------------------------------------------
  router.get('/sessions', requireAuthApi, (req, res) => {
    const rows = q.sessionsForUser.all(req.session.userId, Date.now());
    res.json({
      sessions: rows.map((r) => ({
        id: publicSessionId(r.sid),
        current: r.sid === req.sessionID,
        device: describeAgent(r.user_agent),
        createdAt: r.created_at,
        expiresAt: r.expires,
      })),
    });
  });

  router.delete('/sessions/:id', requireAuthApi, (req, res) => {
    const rows = q.sessionsForUser.all(req.session.userId, Date.now());
    const target = rows.find((r) => publicSessionId(r.sid) === req.params.id);
    if (!target || target.sid === req.sessionID) {
      return res.status(404).json({ error: 'not_found', message: 'That session is no longer active.' });
    }
    q.deleteSession.run(target.sid, req.session.userId);
    res.json({ ok: true });
  });

  router.delete('/sessions', requireAuthApi, (req, res) => {
    const info = q.deleteOthers.run(req.session.userId, req.sessionID);
    res.json({ ok: true, revoked: info.changes });
  });

  // --- Change password -----------------------------------------------------
  router.post(
    '/password',
    requireAuthApi,
    passwordLimiter,
    wrap(async (req, res) => {
      const { values, errors } = validatePasswordChange(req.body);
      if (Object.keys(errors).length) {
        return res.status(400).json({ error: 'validation', errors });
      }

      const user = q.byId.get(req.session.userId);
      const matches =
        user && !tooLong(values.current) && (await bcrypt.compare(values.current, user.password_hash));
      if (!matches) {
        return res.status(400).json({
          error: 'validation',
          errors: { current: "That isn't your current password." },
        });
      }
      if (values.current === values.next) {
        return res.status(400).json({
          error: 'validation',
          errors: { next: 'Choose a password different from your current one.' },
        });
      }

      const hash = await bcrypt.hash(values.next, cfg.bcryptRounds);
      q.setPassword.run(hash, user.id);

      // A password change signs every other device out.
      const info = q.deleteOthers.run(user.id, req.sessionID);
      req.session.csrf = newToken();
      await save(req);
      res.json({ ok: true, revoked: info.changes, csrf: req.session.csrf });
    })
  );

  return router;
}

module.exports = { createAuthRouter };
