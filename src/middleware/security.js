'use strict';

const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/** Returns the session's CSRF token, creating one if needed. */
function issueCsrf(req) {
  if (!req.session.csrf) req.session.csrf = newToken();
  return req.session.csrf;
}

const csrfFailure = {
  error: 'csrf',
  message: 'This page has expired. Reload it and try again.',
};

/**
 * Defence in depth, layer 1: when the browser sends an Origin header on a
 * state-changing request it must match the host we are serving.
 */
function originGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch (_) {
      /* malformed origin -> reject below */
    }
    if (host !== req.get('host')) return res.status(403).json(csrfFailure);
  }
  next();
}

/**
 * Layer 2: synchroniser token. Every state-changing request must echo the
 * per-session token in the X-CSRF-Token header (a custom header cannot be
 * set by a cross-site form post). Cookies are also SameSite=Lax.
 */
function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = req.get('x-csrf-token');
  const expected = req.session && req.session.csrf;
  if (!sent || !expected || !safeEqual(sent, expected)) {
    return res.status(403).json(csrfFailure);
  }
  next();
}

function requireAuthApi(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
  }
  next();
}

function requireAuthPage(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function guestOnlyPage(req, res, next) {
  if (req.session.userId) return res.redirect('/dashboard');
  next();
}

module.exports = {
  newToken,
  issueCsrf,
  originGuard,
  csrfGuard,
  requireAuthApi,
  requireAuthPage,
  guestOnlyPage,
};
