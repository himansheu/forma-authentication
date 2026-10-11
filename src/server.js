'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { SqliteStore } = require('./sessionStore');
const { originGuard, csrfGuard } = require('./middleware/security');
const { createAuthRouter } = require('./routes/auth');
const { createPagesRouter } = require('./routes/pages');

const VIEWS = path.join(__dirname, '..', 'views');
const PUBLIC = path.join(__dirname, '..', 'public');

function createApp(cfg, db) {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Fonts come from Google Fonts. Self-host them and drop these two hosts if you prefer.
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          // Plain-http localhost must keep working in development.
          upgradeInsecureRequests: cfg.isProd ? [] : null,
        },
      },
      strictTransportSecurity: cfg.isProd,
    })
  );

  // Static assets first: no session lookup for CSS/JS.
  app.use(express.static(PUBLIC, { index: false, maxAge: cfg.isProd ? '1h' : 0 }));

  app.use(express.json({ limit: '10kb' }));

  const store = new SqliteStore(db, { ttlMs: cfg.sessionTtlMs });
  app.use(
    session({
      name: 'forma.sid',
      secret: cfg.secret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true, // not readable from JavaScript
        sameSite: 'lax', // not sent on cross-site POSTs
        secure: cfg.secureCookie, // HTTPS only in production
        maxAge: cfg.sessionTtlMs,
      },
    })
  );

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', originGuard, csrfGuard, createAuthRouter({ db, cfg }));
  app.use(createPagesRouter({ viewsDir: VIEWS }));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'not_found', message: 'No such endpoint.' });
    }
    res.status(404).sendFile(path.join(VIEWS, '404.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'bad_request', message: 'That request could not be read.' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'too_large', message: 'That request is too large.' });
    }
    console.error('[forma] unhandled error:', err);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side. Try again in a moment.' });
  });

  return app;
}

if (require.main === module) {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const app = createApp(cfg, db);
  const server = app.listen(cfg.port, () => {
    console.log(`[forma] listening on http://localhost:${cfg.port}`);
  });

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
