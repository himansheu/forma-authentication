// Mirrors src/validate.js so people get feedback before a round trip.
// The server re-checks everything; this file is a convenience, not a gate.

export function checkUsername(v) {
  if (!v) return 'Pick a username.';
  if (v.length < 3) return 'Use at least 3 characters.';
  if (v.length > 24) return 'Use 24 characters or fewer.';
  if (!/^[A-Za-z0-9_]+$/.test(v)) return 'Use only letters, numbers and underscores.';
  return '';
}

export function checkEmail(v) {
  if (!v) return 'Enter your email address.';
  if (v.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v)) return "That email address doesn't look right.";
  return '';
}

export function passwordRules(v) {
  return {
    length: v.length >= 8,
    number: /\d/.test(v),
  };
}

export function checkPassword(v) {
  if (!v) return 'Choose a password.';
  const r = passwordRules(v);
  if (!r.length) return 'Use at least 8 characters.';
  if (!r.number) return 'Add at least one number.';
  if (new TextEncoder().encode(v).length > 72) return 'Use a shorter password (72 bytes at most).';
  return '';
}

export function checkConfirm(password, confirm) {
  if (!confirm) return 'Type the password again.';
  if (password !== confirm) return "The two passwords don't match.";
  return '';
}
