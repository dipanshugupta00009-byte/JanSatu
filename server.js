/**
 * Jharkhand Citizen–HEI–Industry JanSatu
 * Vanilla Node.js backend (no external dependencies).
 * Serves the static frontend AND a JSON REST API backed by a local db.json file.
 *
 * Run:  node server.js
 * Then open http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const ai = require('./ai/features');
const sec = require('./security');

const loginLimiter = new sec.RateLimiter(5, 15 * 60 * 1000);    // 5 attempts / 15 min
const registerLimiter = new sec.RateLimiter(10, 60 * 60 * 1000); // 10 accounts / hour per IP

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- tiny JSON "database" ----------
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const seed = {
      users: [],
      problems: [],
      institutions: [
        { id: 'inst-1', name: 'Birla Institute of Technology, Mesra', type: 'HEI', district: 'Ranchi', focus: ['Water', 'Environment', 'Urban Infrastructure'] },
        { id: 'inst-2', name: 'National Institute of Technology, Jamshedpur', type: 'HEI', district: 'East Singhbhum', focus: ['Agriculture', 'Rural Livelihoods', 'Accessibility'] },
        { id: 'inst-3', name: 'Central University of Jharkhand', type: 'HEI', district: 'Ranchi', focus: ['Education', 'Public Service Delivery'] },
        { id: 'inst-4', name: 'Jharkhand Startup Hub', type: 'Industry', district: 'Ranchi', focus: ['Sanitation', 'Healthcare', 'Urban Infrastructure'] }
      ],
      counters: { problem: 0 },
      tokens: {}
    };
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDB();

// ---------- helpers ----------
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(8).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt] = stored.split(':');
  return hashPassword(password, salt) === stored;
}
function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}
function nextProblemId(district) {
  db.counters.problem += 1;
  const year = new Date().getFullYear();
  const seq = String(db.counters.problem).padStart(6, '0');
  return `JS-${year}-${seq}`;
}
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': sec.corsOrigin(),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { // 25MB cap for base64 media
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function getAuthUser(req) {
  const header = req.headers['authorization'];
  if (!header) return null;
  const token = header.replace('Bearer ', '').trim();
  const userId = db.tokens[token];
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
}
function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}
function publicProblem(p) {
  return p;
}

const CATEGORIES = [
  'Education', 'Healthcare', 'Agriculture', 'Water Management',
  'Sanitation', 'Environment', 'Rural Livelihoods', 'Accessibility',
  'Urban Infrastructure', 'Public Service Delivery'
];

// ---------- route handlers ----------
const routes = {
  'GET /api/categories': async (req, res) => sendJSON(res, 200, { categories: CATEGORIES }),

  'GET /api/institutions': async (req, res) => sendJSON(res, 200, { institutions: db.institutions }),

  'GET /api/stats': async (req, res) => {
    const total = db.problems.length;
    const byStatus = {};
    const byCategory = {};
    db.problems.forEach((p) => {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    });
    sendJSON(res, 200, { total, byStatus, byCategory, institutions: db.institutions.length });
  },

  'POST /api/auth/register': async (req, res, body) => {
    const ip = sec.clientIp(req);
    const limit = registerLimiter.check(ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return sendJSON(res, 429, { error: `Too many accounts created from this network. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).` });
    }

    const name = sec.sanitizeText(body.name, 150);
    const email = sec.sanitizeText(body.email, 255);
    const phone = sec.sanitizeText(body.phone, 20);
    const organization = sec.sanitizeText(body.organization, 200);
    const district = sec.sanitizeText(body.district, 100);
    const { password, role } = body;

    if (!name || !email || !password || !role) {
      return sendJSON(res, 400, { error: 'name, email, password and role are required.' });
    }
    if (!sec.isValidEmail(email)) {
      return sendJSON(res, 400, { error: 'Please enter a valid email address.' });
    }
    if (!sec.isStrongPassword(password)) {
      return sendJSON(res, 400, { error: 'Password must be at least 8 characters and include a letter and a number.' });
    }
    if (db.users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return sendJSON(res, 409, { error: 'An account with this email already exists.' });
    }
    // Admin is deliberately excluded here — public self-registration can't
    // create an admin account. Admins are created via db/create-admin.js
    // (or create-admin.js for the JSON version) run directly on the server.
    if (!['citizen', 'institution', 'industry'].includes(role)) {
      return sendJSON(res, 400, { error: 'Invalid role.' });
    }
    const user = {
      id: 'u-' + crypto.randomBytes(6).toString('hex'),
      name, email, phone, role,
      organization, district,
      password: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    saveDB(db);
    const token = makeToken();
    db.tokens[token] = user.id;
    saveDB(db);
    sendJSON(res, 201, { token, user: publicUser(user) });
  },

  'POST /api/auth/login': async (req, res, body) => {
    const ip = sec.clientIp(req);
    const email = sec.sanitizeText(body.email, 255);
    const limitKey = `${ip}:${email.toLowerCase()}`;
    const limit = loginLimiter.check(limitKey);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return sendJSON(res, 429, { error: `Too many failed sign-in attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).` });
    }

    const { password } = body;
    const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !verifyPassword(password || '', user.password)) {
      return sendJSON(res, 401, { error: 'Incorrect email or password.' });
    }
    loginLimiter.reset(limitKey); // successful login — don't punish future mistakes for this stale window
    const token = makeToken();
    db.tokens[token] = user.id;
    saveDB(db);
    sendJSON(res, 200, { token, user: publicUser(user) });
  },

  'GET /api/auth/me': async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated.' });
    sendJSON(res, 200, { user: publicUser(user) });
  },

  'POST /api/problems': async (req, res, body) => {
    const user = getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Please sign in to submit a challenge.' });
    const title = sec.sanitizeText(body.title, 200);
    const description = sec.sanitizeText(body.description, 5000);
    const district = sec.sanitizeText(body.district, 100);
    const block = sec.sanitizeText(body.block, 100);
    const village = sec.sanitizeText(body.village, 150);
    const { category, latitude, longitude, priority, media } = body;
    if (!title || !description || !category || !district) {
      return sendJSON(res, 400, { error: 'title, description, category and district are required.' });
    }
    if (!CATEGORIES.includes(category)) {
      return sendJSON(res, 400, { error: 'Unknown category.' });
    }
    if (priority && !['Low', 'Medium', 'High', 'Critical'].includes(priority)) {
      return sendJSON(res, 400, { error: 'Invalid priority.' });
    }
    const problem = {
      id: nextProblemId(district),
      title, description, category,
      district, block, village,
      latitude: latitude || null, longitude: longitude || null,
      priority: priority || 'Medium',
      media: Array.isArray(media) ? media.slice(0, 5).map((m) => ({ name: sec.sanitizeText(m.name, 255), type: m.type, dataBase64: m.dataBase64 })) : [],
      status: 'Submitted',
      submittedBy: { id: user.id, name: user.name, role: user.role },
      assignedInstitutionId: null,
      history: [{ status: 'Submitted', note: 'Challenge submitted by citizen.', at: new Date().toISOString() }],
      createdAt: new Date().toISOString()
    };
    db.problems.unshift(problem);
    saveDB(db);
    sendJSON(res, 201, { problem: publicProblem(problem) });
  },

  'GET /api/problems': async (req, res, body, query) => {
    let results = db.problems.slice();
    if (query.category) results = results.filter((p) => p.category === query.category);
    if (query.district) results = results.filter((p) => p.district.toLowerCase() === query.district.toLowerCase());
    if (query.status) results = results.filter((p) => p.status === query.status);
    if (query.mine === 'true') {
      const user = getAuthUser(req);
      if (!user) return sendJSON(res, 401, { error: 'Please sign in.' });
      results = results.filter((p) => p.submittedBy.id === user.id);
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      results = results.filter((p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    const stripped = results.map((p) => ({ ...p, media: p.media.map((m) => ({ name: m.name, type: m.type })) }));
    sendJSON(res, 200, { problems: stripped, count: stripped.length });
  },

  'GET /api/problems/:id': async (req, res, body, query, params) => {
    const problem = db.problems.find((p) => p.id === params.id);
    if (!problem) return sendJSON(res, 404, { error: 'Challenge not found.' });
    sendJSON(res, 200, { problem: publicProblem(problem) });
  },

  'PUT /api/problems/:id/status': async (req, res, body, query, params) => {
    const user = getAuthUser(req);
    if (!user || !['admin', 'institution', 'industry'].includes(user.role)) {
      return sendJSON(res, 403, { error: 'Only reviewers can update status.' });
    }
    const problem = db.problems.find((p) => p.id === params.id);
    if (!problem) return sendJSON(res, 404, { error: 'Challenge not found.' });
    const { status, note } = body;
    const allowed = ['Submitted', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Rejected'];
    if (!allowed.includes(status)) return sendJSON(res, 400, { error: 'Invalid status value.' });
    problem.status = status;
    problem.history.push({ status, note: note || '', at: new Date().toISOString(), by: user.name });
    saveDB(db);
    sendJSON(res, 200, { problem: publicProblem(problem) });
  },

  'PUT /api/problems/:id/assign': async (req, res, body, query, params) => {
    const user = getAuthUser(req);
    if (!user || user.role !== 'admin') return sendJSON(res, 403, { error: 'Only administrators can assign challenges.' });
    const problem = db.problems.find((p) => p.id === params.id);
    if (!problem) return sendJSON(res, 404, { error: 'Challenge not found.' });
    const inst = db.institutions.find((i) => i.id === body.institutionId);
    if (!inst) return sendJSON(res, 400, { error: 'Unknown institution.' });
    problem.assignedInstitutionId = inst.id;
    problem.status = 'Assigned';
    problem.history.push({ status: 'Assigned', note: `Assigned to ${inst.name}`, at: new Date().toISOString(), by: user.name });
    saveDB(db);
    sendJSON(res, 200, { problem: publicProblem(problem) });
  },

  // ---------- AI features ----------
  'POST /api/ai/suggest-category': async (req, res, body) => {
    const user = getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Please sign in.' });
    if (!body.title || !body.description) return sendJSON(res, 400, { error: 'title and description are required.' });
    const suggestion = await ai.suggestCategory(body.title, body.description, CATEGORIES);
    sendJSON(res, 200, suggestion);
  },

  'POST /api/ai/check-duplicates': async (req, res, body) => {
    const user = getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Please sign in.' });
    if (!body.title || !body.description) return sendJSON(res, 400, { error: 'title and description are required.' });
    const pool = body.category ? db.problems.filter((p) => p.category === body.category) : db.problems;
    const candidates = pool.slice(0, 200).map((p) => ({ id: p.id, title: p.title, description: p.description, status: p.status }));
    const matches = ai.findPossibleDuplicates(body.title, body.description, candidates);
    sendJSON(res, 200, { matches });
  },

  'POST /api/problems/:id/ai-summary': async (req, res, body, query, params) => {
    const user = getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Please sign in.' });
    const problem = db.problems.find((p) => p.id === params.id);
    if (!problem) return sendJSON(res, 404, { error: 'Challenge not found.' });
    const summary = await ai.summarizeCase(problem);
    problem.aiSummary = summary;
    problem.aiSummaryAt = new Date().toISOString();
    saveDB(db);
    sendJSON(res, 200, { summary });
  }
};

// ---------- routing engine (supports :id params) ----------
function matchRoute(method, pathname) {
  for (const key of Object.keys(routes)) {
    const [rMethod, rPath] = key.split(' ');
    if (rMethod !== method) continue;
    const rParts = rPath.split('/').filter(Boolean);
    const pParts = pathname.split('/').filter(Boolean);
    if (rParts.length !== pParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rParts.length; i++) {
      if (rParts[i].startsWith(':')) params[rParts[i].slice(1)] = decodeURIComponent(pParts[i]);
      else if (rParts[i] !== pParts[i]) { ok = false; break; }
    }
    if (ok) return { handler: routes[key], params };
  }
  return null;
}

// ---------- static file serving ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon'
};
function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-ish fallback: try adding .html
      fs.readFile(filePath + '.html', (err2, data2) => {
        if (err2) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 Not Found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  sec.applySecurityHeaders(res);
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    return sendJSON(res, 204, {});
  }

  if (pathname.startsWith('/api/')) {
    const match = matchRoute(req.method, pathname);
    if (!match) return sendJSON(res, 404, { error: 'No such API route.' });
    try {
      const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
      await match.handler(req, res, body, parsed.query, match.params);
    } catch (e) {
      console.error('API error on', pathname, '→', e.message || e, e.code ? `(code: ${e.code})` : '');
      sendJSON(res, e.status || 500, { error: e.message || 'Server error.' });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`JanSatu running at http://localhost:${PORT}`);
});
