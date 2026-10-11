import { createMark } from './mark.js';
import { post } from './api.js';
import * as v from './validators.js';
import { field, setError, clearError, showAlert, hideAlert, setBusy, wireReveal, reducedMotion, wait } from './ui.js';

const form = document.getElementById('form');
const done = document.getElementById('done');
const mark = createMark(document.getElementById('mark'));

const order = ['username', 'email', 'password', 'confirm'];
const f = Object.fromEntries(order.map((n) => [n, field(form, n)]));
const touched = {};

const checks = {
  username: () => v.checkUsername(f.username.input.value.trim()),
  email: () => v.checkEmail(f.email.input.value.trim()),
  password: () => v.checkPassword(f.password.input.value),
  confirm: () => v.checkConfirm(f.password.input.value, f.confirm.input.value),
};

const ruleEls = {
  length: form.querySelector('[data-rule="length"]'),
  number: form.querySelector('[data-rule="number"]'),
};

function syncRules() {
  const met = v.passwordRules(f.password.input.value);
  for (const [name, li] of Object.entries(ruleEls)) {
    li.dataset.met = String(met[name]);
    li.querySelector('.sr-only').textContent = met[name] ? 'Done: ' : 'Still needed: ';
  }
}

/** Each valid answer stamps one cell of the mark. */
function syncMark() {
  order.forEach((name, i) => mark.place(i, checks[name]() === ''));
}

function validateField(name, show) {
  const message = checks[name]();
  if (show) (message ? setError : clearError)(f[name], message);
  return message;
}

for (const name of order) {
  const { input } = f[name];
  input.addEventListener('input', () => {
    if (name === 'username') mark.setName(input.value.trim());
    syncMark();
    if (name === 'password') syncRules();
    if (touched[name]) validateField(name, true);
    if (name === 'password' && touched.confirm) validateField('confirm', true);
    hideAlert(form);
  });
  input.addEventListener('blur', () => {
    if (!input.value && !touched[name]) return; // don't scold an untouched field on tab-through
    touched[name] = true;
    validateField(name, true);
  });
}

wireReveal(form.querySelector('.reveal'), [f.password.input, f.confirm.input]);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (form.classList.contains('is-busy')) return;
  hideAlert(form);

  let first = null;
  let problems = 0;
  for (const name of order) {
    touched[name] = true;
    if (validateField(name, true)) {
      problems++;
      first = first || name;
    }
  }
  if (first) {
    showAlert(form, problems === 1 ? 'One answer needs fixing.' : `${problems} answers need fixing.`);
    f[first].input.focus();
    return;
  }

  setBusy(form, true);
  mark.busy(true);
  const res = await post('/api/register', {
    username: f.username.input.value.trim(),
    email: f.email.input.value.trim(),
    password: f.password.input.value,
    confirm: f.confirm.input.value,
  });
  mark.busy(false);

  if (res.ok) {
    await succeed(res.data.user);
    return;
  }

  setBusy(form, false);
  const errors = res.data.errors;
  if (errors) {
    let firstBad = null;
    for (const name of order) {
      if (errors[name]) {
        setError(f[name], errors[name]);
        firstBad = firstBad || name;
      }
    }
    showAlert(form, res.status === 409 ? 'Those details are already in use.' : 'Check the highlighted answers.');
    if (firstBad) f[firstBad].input.focus();
  } else {
    showAlert(form, res.data.message || 'Something went wrong. Try again.');
  }
});

async function succeed(user) {
  form.hidden = true;
  document.querySelector('.intro').hidden = true;
  done.hidden = false;
  done.querySelector('[data-name]').textContent = user.username;
  done.focus();
  mark.setName(user.username);
  await mark.complete(reducedMotion() ? 0 : 140);
  await wait(reducedMotion() ? 600 : 1300);
  window.location.assign('/dashboard');
}

syncRules();
