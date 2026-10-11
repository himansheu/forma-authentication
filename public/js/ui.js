// Small DOM helpers shared by every page. All user-supplied text goes through textContent.

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function field(form, name) {
  const input = form.elements[name];
  const clause = input.closest('.clause');
  const note = clause.querySelector('.clause__note');
  return { name, input, clause, note };
}

export function setError(f, message) {
  f.input.setAttribute('aria-invalid', 'true');
  f.clause.classList.add('has-error');
  f.note.textContent = message;
}

export function clearError(f) {
  f.input.removeAttribute('aria-invalid');
  f.clause.classList.remove('has-error');
  f.note.textContent = f.note.dataset.hint || '';
}

export function showAlert(form, message) {
  const box = form.querySelector('.alert');
  box.textContent = message;
  box.hidden = false;
}

export function hideAlert(form) {
  const box = form.querySelector('.alert');
  box.hidden = true;
  box.textContent = '';
}

export function setBusy(form, on) {
  const btn = form.querySelector('button[type="submit"]');
  const label = btn.querySelector('.btn__label');
  if (!btn.dataset.idle) btn.dataset.idle = label.textContent;
  btn.disabled = on;
  btn.setAttribute('aria-busy', String(on));
  label.textContent = on ? btn.dataset.busy : btn.dataset.idle;
  form.classList.toggle('is-busy', on);
}

/** Show/hide toggle for one or more password inputs. */
export function wireReveal(button, inputs) {
  button.addEventListener('click', () => {
    const show = inputs[0].type === 'password';
    inputs.forEach((i) => (i.type = show ? 'text' : 'password'));
    button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
