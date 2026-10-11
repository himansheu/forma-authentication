import { createMark } from './mark.js';
import { post } from './api.js';
import { field, setError, clearError, showAlert, hideAlert, setBusy, wireReveal, reducedMotion, wait } from './ui.js';

const form = document.getElementById('form');
const done = document.getElementById('done');
const mark = createMark(document.getElementById('mark'));

const f = {
  identifier: field(form, 'identifier'),
  password: field(form, 'password'),
};

for (const name of Object.keys(f)) {
  f[name].input.addEventListener('input', () => {
    clearError(f[name]);
    hideAlert(form);
    mark.error(false);
  });
}

wireReveal(form.querySelector('.reveal'), [f.password.input]);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (form.classList.contains('is-busy')) return;
  hideAlert(form);
  mark.error(false);

  const identifier = f.identifier.input.value.trim();
  const password = f.password.input.value;

  let first = null;
  if (!identifier) {
    setError(f.identifier, 'Enter your username or email.');
    first = f.identifier;
  }
  if (!password) {
    setError(f.password, 'Enter your password.');
    first = first || f.password;
  }
  if (first) {
    first.input.focus();
    return;
  }

  setBusy(form, true);
  mark.busy(true);
  const res = await post('/api/login', { identifier, password });
  mark.busy(false);

  if (res.ok) {
    await succeed(res.data.user);
    return;
  }

  setBusy(form, false);
  if (res.data.errors) {
    for (const name of Object.keys(f)) if (res.data.errors[name]) setError(f[name], res.data.errors[name]);
    showAlert(form, 'Fill in both answers to continue.');
  } else {
    // One message for "no such account" and "wrong password" on purpose.
    showAlert(form, res.data.message || 'Something went wrong. Try again.');
    mark.error(true);
    if (res.status === 401) {
      f.password.input.value = '';
      f.password.input.focus();
    }
  }
});

async function succeed(user) {
  form.hidden = true;
  document.querySelector('.intro').hidden = true;
  done.hidden = false;
  done.querySelector('[data-name]').textContent = user.username;
  done.focus();
  mark.setName(user.username);
  await mark.complete(reducedMotion() ? 0 : 120);
  await wait(reducedMotion() ? 500 : 900);
  window.location.assign('/dashboard');
}
