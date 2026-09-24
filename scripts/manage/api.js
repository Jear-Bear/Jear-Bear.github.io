// api.js — talks to the sponsor CRM Worker. The session token lives in
// sessionStorage (gone when the tab closes) and is sent as a Bearer token.

const TOKEN_KEY = 'crm.session';
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export const API_BASE = LOCAL
  ? `http://${location.hostname}:8787`
  : (document.querySelector('meta[name="crm-api"]') || {}).content || '';

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

let memorySession = null;   // used when sessionStorage is blocked
function readSession() {
  let s = memorySession;
  try { s = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null') || memorySession; } catch { /* storage blocked */ }
  return s && s.token && s.expiresAt > Date.now() ? s : null;
}
export const hasSession = () => Boolean(readSession());
export function clearSession() {
  memorySession = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

let onSignedOut = () => {};
export function whenSignedOut(fn) { onSignedOut = fn; }

export async function request(method, path, body) {
  const session = readSession();
  const headers = {};
  if (session) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API_BASE}/api/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the CRM server. Check your connection.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && path !== 'login') { clearSession(); onSignedOut(); }
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`, data && data.details);
  }
  return data;
}

export async function login(password) {
  const s = await request('POST', 'login', { password });
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(s)); } catch { /* storage blocked: session lasts this page only */ }
  memorySession = s;
  return s;
}

export const api = {
  state: () => request('GET', 'state'),
  activities: (q) => request('GET', `activities?${new URLSearchParams(q)}`),
  create: (type, data) => request('POST', type, data),
  update: (type, id, data) => request('PATCH', `${type}/${id}`, data),
  archive: (type, id, archived) => request('POST', `${type}/${id}/archive`, { archived }),
  setting: (key, value) => request('PUT', `settings/${key}`, { value }),
  import: (payload) => request('POST', 'import', payload),
  export: () => request('GET', 'export'),
  logoutAll: () => request('POST', 'logout-all'),
  plan: (data) => request('POST', 'plan', data),
};
