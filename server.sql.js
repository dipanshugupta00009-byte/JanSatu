/**
 * Jharkhand Citizen–HEI–Industry JanSatu
 * SQL-backed backend. Same HTTP routes and JSON response shapes as the
 * original JSON-file prototype (server.js), so the frontend in /public
 * needs NO changes — only this file's storage layer changed.
 *
 * Setup (see README-DATABASE.md for details):
 *   1. createdb jansatu
 *   2. cp .env.example .env   (edit credentials if needed)
 *   3. npm install
 *   4. node db/migrate.js
 *   5. node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const db = require('./db/queries');
const ai = require('./ai/features');
const sec = require('./security');

const loginLimiter = new sec.RateLimiter(5, 15 * 60 * 1000);
const registerLimiter = new sec.RateLimiter(10, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

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
      if (size > 25 * 1024 * 1024) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function getAuthUser(req) {
  const header = req.headers['authorization'];
  if (!header) return null;
  const token = header.replace('Bearer ', '').trim();
  return db.getUserByToken(token);
}

// ---------- route handlers (thin — all logic lives in db/queries.js) ----------
const routes = {
  'GET /api/categories': async (req, res) => {
    sendJSON(res, 200, { categories: await db.listCategories() });
  },

  'GET /api/institutions': async (req, res) => {
    sendJSON(res, 200, { institutions: await db.listInstitutions() });
  },

  'GET /api/stats': async (req, res) => {
    sendJSON(res, 200, await db.getStats());
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
    // Admin is deliberately excluded here — public self-registration can't
    // create an admin account. Admins are created via db/create-admin.js
    // run directly on the server.
    if (!['citizen', 'institution', 'industry'].includes(role)) {
      return sendJSON(res, 400, { error: 'Invalid role.' });
    }
    const result = await db.registerUser({ ...body, name, email });
    sendJSON(res, 201, result);
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
    try {
      const result = await db.loginUser({ ...body, email });
      loginLimiter.reset(limitKey);
      sendJSON(res, 200, result);
    } catch (e) {
      throw e; // let the outer handler send the right status/message (still counted against the rate limit above)
    }
  },

  'GET /api/auth/me': async (req, res) => {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated.' });
    sendJSON(res, 200, { user });
  },

  'POST /api/problems': async (req, res, body) => {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Please sign in to submit a challenge.' });
    const problem = await db.createProblem(user, body);
    sendJSON(res, 201, { problem });
  },

  'GET /api/problems': async (req, res, body, query) => {
    const user = await getAuthUser(req);
    const problems = await db.listProblems({
      category: query.category, district: query.district, status: query.status,
      search: query.search, mine: query.mine === 'true', user
    });
    sendJSON(res, 200, { problems, count: problems.length });
  },

  'GET /api/problems/:id': async (req, res, body, query, params) => {
    const problem = await db.getProblemByDisplayId(params.id);
    if (!problem) return sendJSON(res, 404, { error: 'Challenge not found.' });
    sendJSON(res, 200, { problem });
  },

  'PUT /api/problems/:id/status': async (req, res, body, query, params) => {
    const user = await getAuthUser(req);
    if (!user || !['admin', 'institution', 'industry'].includes(user.role)) {
      return sendJSON(res, 403, { error: 'Only reviewers can update status.' });
    }
    const problem = await db.updateStatus(params.id, user, body.status, body.note);
    sendJSON(res, 200, { problem });
  },

  'PUT /api/problems/:id/assign': async (req, res, body, query, params) => {
    const user = await getAuthUser(req);
    if (!user || user.role !== 'admin') {
      return sendJSON(res, 403, { error: 'Only administrators can assign challenges.' });
    }
    const problem = await db.assignInstitution(params.id, user, body.institutionId);
    sendJSON(res, 200, { problem });
  },

  // ---------- AI features ----------
  // Real AI (Claude): reads a draft title/description and suggests a
  // category + priority. The person still has to confirm it — nothing
  // here saves anything on its own.
  'POST /api/ai/suggest-category': async (req, res, body) => {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Please sign in.' });
    if (!body.title || !body.description) {
      return sendJSON(res, 400, { error: 'title and description are required.' });
    }
    const categories = await db.listCategories();
    const suggestion = await ai.suggestCategory(body.title, body.description, categories);
    sendJSON(res, 200, suggestion);
  },

  // NOT an AI call — local text-similarity against existing cases (see
  // ai/similarity.js). Free, instant, works without any API key.
  'POST /api/ai/check-duplicates': async (req, res, body) => {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Please sign in.' });
    if (!body.title || !body.description) {
      return sendJSON(res, 400, { error: 'title and description are required.' });
    }
    const candidates = await db.listForDuplicateCheck({ category: body.category });
    const matches = ai.findPossibleDuplicates(body.title, body.description, candidates);
    sendJSON(res, 200, { matches });
  },

  // Real AI (Claude): turns a case's raw status timeline into one
  // plain-language paragraph. Cached in the database so repeat views
  // don't cost another API call — only an explicit "regenerate" does.
  'POST /api/problems/:id/ai-summary': async (req, res, body, query, params) => {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Please sign in.' });
    const problem = await db.getProblemByDisplayId(params.id);
    if (!problem) return sendJSON(res, 404, { error: 'Challenge not found.' });
    const summary = await ai.summarizeCase(problem);
    await db.saveAISummary(params.id, summary);
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

// ---------- static file serving (unchanged from the prototype) ----------
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

  if (req.method === 'OPTIONS') return sendJSON(res, 204, {});

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
  console.log(`JanSatu (SQL-backed) running at http://localhost:${PORT}`);
});

// Test the database connection right at boot, so Render's logs show
// immediately whether the problem is the connection itself — no need to
// wait for someone to hit an API route first.
(async () => {
  try {
    await require('./db/pool').query('SELECT 1');
    console.log('✔ Database connection OK.');
  } catch (e) {
    console.error('✘ DATABASE CONNECTION FAILED at boot:', e.message, e.code ? `(code: ${e.code})` : '');
    console.error('  Check DATABASE_URL in your environment variables, and that the Supabase project is active (not paused).');
  }
})();
