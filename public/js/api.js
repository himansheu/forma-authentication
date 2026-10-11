// Thin fetch wrapper: JSON in/out, CSRF header, one retry if the token went stale.

let token = null;

const NETWORK_ERROR = {
  error: 'network',
  message: "Can't reach the server. Check your connection and try again.",
};

async function fetchToken() {
  try {
    const res = await fetch('/api/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const data = await res.json();
    token = data.csrf || null;
  } catch (_) {
    token = null;
  }
  return token;
}

export async function request(method, url, body, retried = false) {
  if (!token) await fetchToken();

  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': token || '',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (_) {
    return { ok: false, status: 0, data: NETWORK_ERROR };
  }

  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    /* empty or non-JSON body */
  }

  if (res.status === 403 && data.error === 'csrf' && !retried) {
    token = null;
    return request(method, url, body, true);
  }
  if (data.csrf) token = data.csrf;
  return { ok: res.ok, status: res.status, data };
}

export const post = (url, body) => request('POST', url, body);
export const get = (url) => request('GET', url);
export const del = (url) => request('DELETE', url);
