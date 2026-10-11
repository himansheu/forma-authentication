'use strict';

/*
 * Server-side validation. The browser runs the same rules for fast feedback
 * (public/js/validators.js) but nothing here trusts the browser.
 */

const USERNAME_RE = /^[A-Za-z0-9_]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_PASSWORD_BYTES = 72; // bcrypt ignores anything past 72 bytes

function str(v) {
  return typeof v === 'string' ? v : '';
}

function checkUsername(value) {
  if (!value) return 'Pick a username.';
  if (value.length < 3) return 'Use at least 3 characters.';
  if (value.length > 24) return 'Use 24 characters or fewer.';
  if (!USERNAME_RE.test(value)) return 'Use only letters, numbers and underscores.';
  return '';
}

function checkEmail(value) {
  if (!value) return 'Enter your email address.';
  if (value.length > 254 || !EMAIL_RE.test(value)) return "That email address doesn't look right.";
  return '';
}

function checkPassword(value) {
  if (!value) return 'Choose a password.';
  if (value.length < 8) return 'Use at least 8 characters.';
  if (!/\d/.test(value)) return 'Add at least one number.';
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) return 'Use a shorter password (72 bytes at most).';
  return '';
}

function checkConfirm(password, confirm) {
  if (!confirm) return 'Type the password again.';
  if (password !== confirm) return "The two passwords don't match.";
  return '';
}

function validateRegistration(body) {
  const b = body && typeof body === 'object' ? body : {};
  const values = {
    username: str(b.username).trim(),
    email: str(b.email).trim().toLowerCase(),
    password: str(b.password),
    confirm: str(b.confirm),
  };
  const errors = {};
  const u = checkUsername(values.username);
  const e = checkEmail(values.email);
  const p = checkPassword(values.password);
  const c = checkConfirm(values.password, values.confirm);
  if (u) errors.username = u;
  if (e) errors.email = e;
  if (p) errors.password = p;
  if (c) errors.confirm = c;
  return { values, errors };
}

function validatePasswordChange(body) {
  const b = body && typeof body === 'object' ? body : {};
  const values = { current: str(b.current), next: str(b.next), confirm: str(b.confirm) };
  const errors = {};
  if (!values.current) errors.current = 'Enter your current password.';
  const p = checkPassword(values.next);
  const c = checkConfirm(values.next, values.confirm);
  if (p) errors.next = p;
  if (c) errors.confirm = c;
  return { values, errors };
}

module.exports = {
  MAX_PASSWORD_BYTES,
  checkUsername,
  checkEmail,
  checkPassword,
  checkConfirm,
  validateRegistration,
  validatePasswordChange,
};
