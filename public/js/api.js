/* Shared API client + auth-state helpers */
const API = {
  base: '',
  token() { return localStorage.getItem('js_token'); },
  user() {
    try { return JSON.parse(localStorage.getItem('js_user') || 'null'); }
    catch (e) { return null; }
  },
  setSession(token, user) {
    localStorage.setItem('js_token', token);
    localStorage.setItem('js_user', JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem('js_token');
    localStorage.removeItem('js_user');
  },
  async request(method, pathname, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = this.token();
    if (t) headers['Authorization'] = 'Bearer ' + t;

    let res;
    try {
      res = await fetch(this.base + pathname, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (networkErr) {
      // fetch() itself throws for network failures (server unreachable,
      // CORS blocked, no internet) — give a clear message instead of a
      // raw "Failed to fetch" browser error.
      const err = new Error('Could not reach the server. Check your connection and try again.');
      err.status = 0;
      throw err;
    }

    let data = {};
    try { data = await res.json(); } catch (e) { /* empty/non-JSON response body */ }

    if (!res.ok) {
      const err = new Error(data.error || `Request failed (HTTP ${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(p) { return this.request('GET', p); },
  post(p, b) { return this.request('POST', p, b); },
  put(p, b) { return this.request('PUT', p, b); }
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function badgeClass(status) {
  return 'badge badge-' + status.replace(/\s+/g, '-');
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
  return Math.floor(diff / 86400) + ' days ago';
}
