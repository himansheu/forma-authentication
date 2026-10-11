import { createMark } from './mark.js';
import { get, post, del } from './api.js';
import * as v from './validators.js';
import { field, setError, clearError, showAlert, hideAlert, setBusy, wireReveal, reducedMotion } from './ui.js';

const main = document.getElementById('main');
const mark = createMark(document.getElementById('mark'));
const $ = (id) => document.getElementById(id);

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function relative(ms) {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const units = [
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ];
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(Math.round(diff / size), unit);
  }
  return 'just now';
}

function pageAlert(message) {
  const box = $('page-alert');
  box.textContent = message;
  box.hidden = !message;
}

function toLogin() {
  window.location.replace('/login');
}

/* ---------- Load ---------- */

async function load() {
  const [me, sessions] = await Promise.all([get('/api/me'), get('/api/sessions')]);
  if (me.status === 401 || sessions.status === 401) return toLogin();

  if (!me.ok || !sessions.ok) {
    $('name').textContent = 'Something went wrong';
    $('sub').textContent = '';
    pageAlert(
      (me.data && me.data.message) || (sessions.data && sessions.data.message) ||
        "We couldn't load your account. Reload the page to try again."
    );
    main.setAttribute('aria-busy', 'false');
    return;
  }

  renderIdentity(me.data.user);
  renderSessions(sessions.data.sessions);
  main.setAttribute('aria-busy', 'false');
}

function renderIdentity(user) {
  const name = $('name');
  name.textContent = user.username;
  name.dataset.size = user.username.length <= 8 ? 'l' : user.username.length <= 14 ? 'm' : 's';
  $('sub').textContent = 'Your mark is built from this name.';
  $('f-username').textContent = user.username;
  $('f-email').textContent = user.email;
  $('f-joined').textContent = dateFmt.format(new Date(user.createdAt));
  document.title = `${user.username} – FORMA`;

  mark.setName(user.username);
  if (reducedMotion()) {
    for (let i = 0; i < 4; i++) mark.place(i, true);
  } else {
    mark.complete(110);
  }
}

/* ---------- Devices ---------- */

function renderSessions(list) {
  const ul = $('sessions');
  ul.replaceChildren();
  const ordered = [...list].sort((a, b) => Number(b.current) - Number(a.current));

  for (const s of ordered) {
    const li = document.createElement('li');
    li.className = 'session';

    const info = document.createElement('div');
    const device = document.createElement('p');
    device.className = 'session__device';
    device.textContent = s.device;
    if (s.current) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'This device';
      device.append(' ', tag);
    }
    const meta = document.createElement('p');
    meta.className = 'session__meta';
    meta.textContent = `Signed in ${relative(s.createdAt)}. Expires ${relative(s.expiresAt)}.`;
    info.append(device, meta);
    li.append(info);

    if (!s.current) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--quiet btn--small';
      btn.textContent = 'Sign out';
      btn.setAttribute('aria-label', `Sign out ${s.device}`);
      btn.addEventListener('click', () => revokeOne(s.id, btn));
      li.append(btn);
    }
    ul.append(li);
  }

  const others = ordered.filter((s) => !s.current).length;
  $('revoke-others').hidden = others === 0;
  $('sessions-note').textContent = others === 0 ? 'This is the only place you are signed in.' : '';
}

async function refreshSessions() {
  const res = await get('/api/sessions');
  if (res.status === 401) return toLogin();
  if (res.ok) renderSessions(res.data.sessions);
}

async function revokeOne(id, btn) {
  btn.disabled = true;
  const res = await del(`/api/sessions/${encodeURIComponent(id)}`);
  if (res.status === 401) return toLogin();
  if (!res.ok && res.status !== 404) {
    btn.disabled = false;
    pageAlert(res.data.message || "That device couldn't be signed out. Try again.");
    return;
  }
  pageAlert('');
  await refreshSessions();
  $('sessions-note').textContent = 'Signed out.';
}

$('revoke-others').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  const res = await del('/api/sessions');
  e.currentTarget.disabled = false;
  if (res.status === 401) return toLogin();
  if (!res.ok) return pageAlert(res.data.message || "Couldn't sign out other devices. Try again.");
  pageAlert('');
  await refreshSessions();
});

/* ---------- Logout ---------- */

$('logout').addEventListener('click', async () => {
  const btn = $('logout');
  const label = btn.querySelector('.btn__label');
  btn.disabled = true;
  label.textContent = btn.dataset.busy;
  const res = await post('/api/logout');
  if (res.ok || res.status === 401) return toLogin();
  btn.disabled = false;
  label.textContent = 'Sign out';
  pageAlert(res.data.message || "Couldn't sign you out. Try again.");
});

/* ---------- Change password ---------- */

const pw = $('pw-form');
const order = ['current', 'next', 'confirm'];
const f = Object.fromEntries(order.map((n) => [n, field(pw, n)]));
wireReveal(pw.querySelector('.reveal'), order.map((n) => f[n].input));

const checks = {
  current: () => (f.current.input.value ? '' : 'Enter your current password.'),
  next: () => v.checkPassword(f.next.input.value),
  confirm: () => v.checkConfirm(f.next.input.value, f.confirm.input.value),
};

for (const name of order) {
  f[name].input.addEventListener('input', () => {
    clearError(f[name]);
    hideAlert(pw);
    $('pw-success').hidden = true;
  });
}

pw.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pw.classList.contains('is-busy')) return;
  hideAlert(pw);
  $('pw-success').hidden = true;

  let first = null;
  for (const name of order) {
    const message = checks[name]();
    if (message) {
      setError(f[name], message);
      first = first || name;
    }
  }
  if (first) {
    f[first].input.focus();
    return;
  }

  setBusy(pw, true);
  const res = await post('/api/password', {
    current: f.current.input.value,
    next: f.next.input.value,
    confirm: f.confirm.input.value,
  });
  setBusy(pw, false);

  if (res.status === 401) return toLogin();

  if (res.ok) {
    pw.reset();
    const success = $('pw-success');
    success.textContent =
      res.data.revoked > 0
        ? `Password changed. ${res.data.revoked} other ${res.data.revoked === 1 ? 'device was' : 'devices were'} signed out.`
        : 'Password changed.';
    success.hidden = false;
    await refreshSessions();
    return;
  }

  if (res.data.errors) {
    let firstBad = null;
    for (const name of order) {
      if (res.data.errors[name]) {
        setError(f[name], res.data.errors[name]);
        firstBad = firstBad || name;
      }
    }
    if (firstBad) f[firstBad].input.focus();
  } else {
    showAlert(pw, res.data.message || 'Something went wrong. Try again.');
  }
});

load();
