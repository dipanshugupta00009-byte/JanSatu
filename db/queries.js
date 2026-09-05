/**
 * All SQL lives here, one function per operation the API needs.
 * server.sql.js calls these — it never writes raw SQL itself.
 * Every shape returned matches exactly what the frontend already expects,
 * so public/js/*.js and every .html page need ZERO changes.
 */
const crypto = require('crypto');
const { query, getClient } = require('./pool');

// ---------- password hashing ----------
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

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, email: row.email, phone: row.phone || '',
    role: row.role, organization: row.organization || '', district: row.district || '',
    createdAt: row.created_at
  };
}

// ---------- auth ----------
async function registerUser({ name, email, phone, password, role, organization, district }) {
  const existing = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rows.length) {
    const err = new Error('An account with this email already exists.');
    err.status = 409;
    throw err;
  }
  const password_hash = hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (name, email, phone, password_hash, role, organization, district)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, email, phone || null, password_hash, role, organization || null, district || null]
  );
  const user = rows[0];
  const token = makeToken();
  await query('INSERT INTO auth_tokens (token, user_id) VALUES ($1,$2)', [token, user.id]);
  return { token, user: publicUser(user) };
}

async function loginUser({ email, password }) {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    const err = new Error('Incorrect email or password.');
    err.status = 401;
    throw err;
  }
  const token = makeToken();
  await query('INSERT INTO auth_tokens (token, user_id) VALUES ($1,$2)', [token, user.id]);
  return { token, user: publicUser(user) };
}

async function getUserByToken(token) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.* FROM auth_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token = $1 AND t.expires_at > now()`,
    [token]
  );
  return rows[0] || null;
}

// ---------- categories / institutions ----------
async function listCategories() {
  const { rows } = await query('SELECT name FROM categories ORDER BY id');
  return rows.map((r) => r.name);
}

async function listInstitutions() {
  const { rows } = await query(`
    SELECT i.id, i.name, i.type, i.district,
           COALESCE(array_agg(c.name) FILTER (WHERE c.name IS NOT NULL), '{}') AS focus
    FROM institutions i
    LEFT JOIN institution_focus_areas fa ON fa.institution_id = i.id
    LEFT JOIN categories c ON c.id = fa.category_id
    GROUP BY i.id ORDER BY i.name
  `);
  return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, district: r.district, focus: r.focus }));
}

async function getStats() {
  const total = await query('SELECT COUNT(*)::int AS n FROM problems');
  const byStatus = await query('SELECT status, COUNT(*)::int AS n FROM problems GROUP BY status');
  const byCategory = await query(`
    SELECT c.name, COUNT(*)::int AS n FROM problems p
    JOIN categories c ON c.id = p.category_id GROUP BY c.name
  `);
  const institutions = await query('SELECT COUNT(*)::int AS n FROM institutions');
  return {
    total: total.rows[0].n,
    byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
    byCategory: Object.fromEntries(byCategory.rows.map((r) => [r.name, r.n])),
    institutions: institutions.rows[0].n
  };
}

// ---------- problems ----------
function rowToProblem(p, media, history) {
  return {
    id: p.display_id,
    title: p.title,
    description: p.description,
    category: p.category_name,
    district: p.district, block: p.block || '', village: p.village || '',
    latitude: p.latitude !== null && p.latitude !== undefined ? Number(p.latitude) : null,
    longitude: p.longitude !== null && p.longitude !== undefined ? Number(p.longitude) : null,
    priority: p.priority,
    status: p.status,
    media: media || [],
    submittedBy: { id: p.submitted_by_id, name: p.submitted_by_name, role: p.submitted_by_role },
    assignedInstitutionId: p.institution_id || null,
    history: history || [],
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    aiSummary: p.ai_summary || null,
    aiSummaryAt: p.ai_summary_at || null
  };
}

async function createProblem(user, body) {
  const { title, description, category, district, block, village, latitude, longitude, priority, media } = body;
  if (!title || !description || !category || !district) {
    const err = new Error('title, description, category and district are required.');
    err.status = 400;
    throw err;
  }
  const catRes = await query('SELECT id FROM categories WHERE name = $1', [category]);
  if (!catRes.rows.length) {
    const err = new Error('Unknown category.');
    err.status = 400;
    throw err;
  }
  const categoryId = catRes.rows[0].id;

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const insert = await client.query(
      `INSERT INTO problems (title, description, category_id, district, block, village,
                              latitude, longitude, priority, submitted_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, display_id, created_at`,
      [title, description, categoryId, district, block || null, village || null,
       latitude || null, longitude || null, priority || 'Medium', user.id]
    );
    const problemId = insert.rows[0].id;

    for (const m of (Array.isArray(media) ? media.slice(0, 5) : [])) {
      const kind = (m.type || '').startsWith('image') ? 'image' : (m.type || '').startsWith('video') ? 'video' : 'document';
      await client.query(
        `INSERT INTO problem_media (problem_id, file_name, media_type, mime_type, storage_url)
         VALUES ($1,$2,$3,$4,$5)`,
        [problemId, m.name, kind, m.type || null, m.dataBase64]
      );
    }

    await client.query(
      `INSERT INTO problem_status_history (problem_id, status, note, changed_by_user_id)
       VALUES ($1,'Submitted','Challenge submitted by citizen.',$2)`,
      [problemId, user.id]
    );

    await client.query('COMMIT');
    return getProblemByDisplayId(insert.rows[0].display_id);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getProblemByDisplayId(displayId) {
  const { rows } = await query(`
    SELECT p.*, c.name AS category_name,
           u.id AS submitted_by_id, u.name AS submitted_by_name, u.role AS submitted_by_role,
           i.id AS institution_id
    FROM problems p
    JOIN categories c ON c.id = p.category_id
    JOIN users u ON u.id = p.submitted_by_user_id
    LEFT JOIN institutions i ON i.id = p.assigned_institution_id
    WHERE p.display_id = $1
  `, [displayId]);
  const p = rows[0];
  if (!p) return null;

  const mediaRes = await query(
    'SELECT file_name AS name, mime_type AS type, storage_url AS "dataBase64" FROM problem_media WHERE problem_id = $1',
    [p.id]
  );
  const historyRes = await query(
    `SELECT h.status, h.note, h.changed_at AS at, u.name AS by
     FROM problem_status_history h
     LEFT JOIN users u ON u.id = h.changed_by_user_id
     WHERE h.problem_id = $1 ORDER BY h.changed_at ASC`,
    [p.id]
  );
  return rowToProblem(p, mediaRes.rows, historyRes.rows);
}

async function listProblems({ category, district, status, search, mine, user }) {
  const clauses = [];
  const params = [];
  let i = 1;

  if (category) { clauses.push(`c.name = $${i++}`); params.push(category); }
  if (district) { clauses.push(`lower(p.district) = lower($${i++})`); params.push(district); }
  if (status)   { clauses.push(`p.status = $${i++}`); params.push(status); }
  if (search)   { clauses.push(`(p.title ILIKE $${i} OR p.description ILIKE $${i})`); params.push(`%${search}%`); i++; }
  if (mine) {
    if (!user) { const err = new Error('Please sign in.'); err.status = 401; throw err; }
    clauses.push(`p.submitted_by_user_id = $${i++}`); params.push(user.id);
  }

  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const { rows } = await query(`
    SELECT p.*, c.name AS category_name,
           u.id AS submitted_by_id, u.name AS submitted_by_name, u.role AS submitted_by_role,
           i.id AS institution_id
    FROM problems p
    JOIN categories c ON c.id = p.category_id
    JOIN users u ON u.id = p.submitted_by_user_id
    LEFT JOIN institutions i ON i.id = p.assigned_institution_id
    ${where}
    ORDER BY p.created_at DESC
  `, params);

  // list view strips base64 payloads (only name/type) to keep the response light
  return rows.map((p) => rowToProblem(p, [], []));
}

async function updateStatus(displayId, user, status, note) {
  const allowed = ['Submitted', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Rejected'];
  if (!allowed.includes(status)) {
    const err = new Error('Invalid status value.');
    err.status = 400;
    throw err;
  }
  const { rows } = await query('SELECT id FROM problems WHERE display_id = $1', [displayId]);
  if (!rows.length) {
    const err = new Error('Challenge not found.');
    err.status = 404;
    throw err;
  }
  const problemId = rows[0].id;
  await query('UPDATE problems SET status = $1 WHERE id = $2', [status, problemId]);
  await query(
    `INSERT INTO problem_status_history (problem_id, status, note, changed_by_user_id)
     VALUES ($1,$2,$3,$4)`,
    [problemId, status, note || '', user.id]
  );
  return getProblemByDisplayId(displayId);
}

async function assignInstitution(displayId, user, institutionId) {
  const probRes = await query('SELECT id FROM problems WHERE display_id = $1', [displayId]);
  if (!probRes.rows.length) {
    const err = new Error('Challenge not found.');
    err.status = 404;
    throw err;
  }
  const instRes = await query('SELECT id, name FROM institutions WHERE id = $1', [institutionId]);
  if (!instRes.rows.length) {
    const err = new Error('Unknown institution.');
    err.status = 400;
    throw err;
  }
  const problemId = probRes.rows[0].id;
  const institution = instRes.rows[0];

  await query(
    `UPDATE problems SET assigned_institution_id = $1, status = 'Assigned' WHERE id = $2`,
    [institution.id, problemId]
  );
  await query(
    `INSERT INTO problem_status_history (problem_id, status, note, changed_by_user_id)
     VALUES ($1,'Assigned',$2,$3)`,
    [problemId, `Assigned to ${institution.name}`, user.id]
  );
  return getProblemByDisplayId(displayId);
}

// ---------- AI-feature support ----------
async function listForDuplicateCheck({ category }) {
  if (category) {
    const { rows } = await query(
      `SELECT p.display_id AS id, p.title, p.description, p.status
       FROM problems p JOIN categories c ON c.id = p.category_id
       WHERE c.name = $1 ORDER BY p.created_at DESC LIMIT 200`,
      [category]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT display_id AS id, title, description, status FROM problems
     ORDER BY created_at DESC LIMIT 200`
  );
  return rows;
}

async function saveAISummary(displayId, summary) {
  await query('UPDATE problems SET ai_summary = $1, ai_summary_at = now() WHERE display_id = $2', [summary, displayId]);
}

module.exports = {
  registerUser, loginUser, getUserByToken,
  listCategories, listInstitutions, getStats,
  createProblem, getProblemByDisplayId, listProblems, updateStatus, assignInstitution,
  listForDuplicateCheck, saveAISummary
};
