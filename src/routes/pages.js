'use strict';

const path = require('path');
const express = require('express');
const { requireAuthPage, guestOnlyPage } = require('../middleware/security');

function createPagesRouter({ viewsDir }) {
  const router = express.Router();

  const view = (name) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(viewsDir, name));
  };

  router.get('/', (req, res) => res.redirect(req.session.userId ? '/dashboard' : '/login'));
  router.get('/login', guestOnlyPage, view('login.html'));
  router.get('/register', guestOnlyPage, view('register.html'));
  router.get('/dashboard', requireAuthPage, view('dashboard.html'));

  return router;
}

module.exports = { createPagesRouter };
