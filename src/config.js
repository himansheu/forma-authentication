'use strict';

const path = require('path');
const crypto = require('crypto');

require('dotenv').config();

const ROOT = path.join(__dirname, '..');

/**
 * Reads configuration from environment variables.
 * Pass an explicit `env` object in tests; defaults to process.env.
 */
function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';

  let secret = env.SESSION_SECRET;
  const weak = !secret || secret.length < 32 || /change-me/i.test(secret);
  if (weak) {
    if (isProd) {
      throw new Error(
        'SESSION_SECRET is missing or too weak. Run `npm run secret` and put the result in .env.'
      );
    }
    // Development convenience: an ephemeral secret. Sessions are invalidated on restart.
    secret = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[forma] SESSION_SECRET not set - using a temporary one. Sign-ins will not survive a restart.'
    );
  }

  const rounds = Number(env.BCRYPT_ROUNDS) || 12;

  return {
    root: ROOT,
    isProd,
    port: Number(env.PORT) || 3000,
    secret,
    dbPath: env.DATABASE_PATH ? path.resolve(env.DATABASE_PATH) : path.join(ROOT, 'data', 'forma.db'),
    sessionTtlMs: (Number(env.SESSION_TTL_HOURS) || 168) * 60 * 60 * 1000,
    bcryptRounds: Math.min(Math.max(rounds, 4), 15),
    secureCookie: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
    trustProxy: env.TRUST_PROXY === 'true',
    rateLimitMax: Number(env.RATE_LIMIT_MAX) || 10,
  };
}

module.exports = { loadConfig };
