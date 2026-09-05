/**
 * All SQL lives here, one function per operation the API needs.
 * server.sql.js calls these — it never writes raw SQL itself.
 * Every shape returned matches exactly what the frontend already expects,
 * so public/js/*.js and every .html page need ZERO changes.
 */
const crypto = require('crypto');
const db = require('./pool');

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
  const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
  if (existing.length) {
    const err = new Error('An account with this email already exists.');
    err.status = 409;
    throw err;
  }
  const id = crypto.randomUUID();
  const password_hash = hashPassword(password);
  await db.query(
    `INSERT INTO users (id, name, email, phone, password_hash, role, organization, district)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, name, email, phone || null, password_hash, role, organization || null, district || null]
  );
  const rows = await db.query('SELECT * FROM users WHERE id = ?', [id]);
  const user = rows[0];
  const token = makeToken();
  await db.query(
    'INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
    [token, user.id]
  );
  return { token, user: publicUser(user) };
}

async function loginUser({ email, password }) {
  const rows = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
  const user = rows[0];
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    const err = new Error('Incorrect email or password.');
    err.status = 401;
    throw err;
  }
  const token = makeToken();
  await db.query(
    'INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
    [token, user.id]
  );
  return { token, user: publicUser(user) };
}

async function getUserByToken(token) {
  if (!token) return null;
  const rows = await db.query(
    `SELECT u.* FROM auth_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token = ? AND t.expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

// ---------- categories / institutions ----------
async function listCategories() {
  const rows = await db.query('SELECT name FROM categories ORDER BY id');
  return rows.map((r) => r.name);
}

async function listInstitutions() {
  const rows = await db.query(`
    SELECT i.id, i.name, i.type, i.district,
           GROUP_CONCAT(c.name SEPARATOR '||') AS focus
    FROM institutions i
    LEFT JOIN institution_focus_areas fa ON fa.institution_id = i.id
    LEFT JOIN categories c ON c.id = fa.category_id
    GROUP BY i.id, i.name, i.type, i.district
    ORDER BY i.name
  `);
  return rows.map((r) => ({
    id: r.id, name: r.name, type: r.type, district: r.district,
    focus: r.focus ? r.focus.split('||') : []
  }));
}

async function getStats() {
  const [{ n: total }] = await db.query('SELECT COUNT(*) AS n FROM problems');
  const byStatusRows = await db.query('SELECT status, COUNT(*) AS n FROM problems GROUP BY status');
  const byCategoryRows = await db.query(`
    SELECT c.name, COUNT(*) AS n FROM problems p
    JOIN categories c ON c.id = p.category_id GROUP BY c.name
  `);
  const [{ n: institutions }] = await db.query('SELECT COUNT(*) AS n FROM institutions');
  return {
    total,
    byStatus: Object.fromEntries(byStatusRows.map((r) => [r.status, r.n])),
    byCategory: Object.fromEntries(byCategoryRows.map((r) => [r.name, r.n])),
    institutions
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
  const catRows = await db.query('SELECT id FROM categories WHERE name = ?', [category]);
  if (!catRows.length) {
    const err = new Error('Unknown category.');
    err.status = 400;
    throw err;
  }
  const categoryId = catRows[0].id;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const id = crypto.randomUUID();
    const [insertResult] = await conn.query(
      `INSERT INTO problems (id, title, description, category_id, district, block, village,
                              latitude, longitude, priority, submitted_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, title, description, categoryId, district, block || null, village || null,
       latitude || null, longitude || null, priority || 'Medium', user.id]
    );
    // seq_no is AUTO_INCREMENT even though it isn't the primary key — mysql2
    // still reports the generated value on insertId.
    const displayId = `JS-${new Date().getFullYear()}-${String(insertResult.insertId).padStart(6, '0')}`;
    await conn.query('UPDATE problems SET display_id = ? WHERE id = ?', [displayId, id]);

    for (const m of (Array.isArray(media) ? media.slice(0, 5) : [])) {
      const kind = (m.type || '').startsWith('image') ? 'image' : (m.type || '').startsWith('video') ? 'video' : 'document';
      await conn.query(
        `INSERT INTO problem_media (id, problem_id, file_name, media_type, mime_type, storage_url)
         VALUES (?,?,?,?,?,?)`,
        [crypto.randomUUID(), id, m.name, kind, m.type || null, m.dataBase64]
      );
    }

    await conn.query(
      `INSERT INTO problem_status_history (id, problem_id, status, note, changed_by_user_id)
       VALUES (?, ?, 'Submitted', 'Challenge submitted by citizen.', ?)`,
      [crypto.randomUUID(), id, user.id]
    );

    await conn.commit();
    return getProblemByDisplayId(displayId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function getProblemByDisplayId(displayId) {
  const rows = await db.query(`
    SELECT p.*, c.name AS category_name,
           u.id AS submitted_by_id, u.name AS submitted_by_name, u.role AS submitted_by_role,
           i.id AS institution_id
    FROM problems p
    JOIN categories c ON c.id = p.category_id
    JOIN users u ON u.id = p.submitted_by_user_id
    LEFT JOIN institutions i ON i.id = p.assigned_institution_id
    WHERE p.display_id = ?
  `, [displayId]);
  const p = rows[0];
  if (!p) return null;

  const media = await db.query(
    'SELECT file_name AS name, mime_type AS `type`, storage_url AS dataBase64 FROM problem_media WHERE problem_id = ?',
    [p.id]
  );
  const history = await db.query(
    `SELECT h.status, h.note, h.changed_at AS \`at\`, u.name AS \`by\`
     FROM problem_status_history h
     LEFT JOIN users u ON u.id = h.changed_by_user_id
     WHERE h.problem_id = ? ORDER BY h.changed_at ASC`,
    [p.id]
  );
  return rowToProblem(p, media, history);
}

async function listProblems({ category, district, status, search, mine, user }) {
  const clauses = [];
  const params = [];

  if (category) { clauses.push('c.name = ?'); params.push(category); }
  if (district) { clauses.push('LOWER(p.district) = LOWER(?)'); params.push(district); }
  if (status)   { clauses.push('p.status = ?'); params.push(status); }
  if (search)   { clauses.push('(p.title LIKE ? OR p.description LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (mine) {
    if (!user) { const err = new Error('Please sign in.'); err.status = 401; throw err; }
    clauses.push('p.submitted_by_user_id = ?'); params.push(user.id);
  }

  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = await db.query(`
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

  // list view strips base64 payloads (matches the original prototype's lighter list response)
  return rows.map((p) => rowToProblem(p, [], []));
}

async function updateStatus(displayId, user, status, note) {
  const allowed = ['Submitted', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Rejected'];
  if (!allowed.includes(status)) {
    const err = new Error('Invalid status value.');
    err.status = 400;
    throw err;
  }
  const rows = await db.query('SELECT id FROM problems WHERE display_id = ?', [displayId]);
  if (!rows.length) {
    const err = new Error('Challenge not found.');
    err.status = 404;
    throw err;
  }
  const problemId = rows[0].id;
  await db.query('UPDATE problems SET status = ? WHERE id = ?', [status, problemId]);
  await db.query(
    `INSERT INTO problem_status_history (id, problem_id, status, note, changed_by_user_id)
     VALUES (?,?,?,?,?)`,
    [crypto.randomUUID(), problemId, status, note || '', user.id]
  );
  return getProblemByDisplayId(displayId);
}

async function assignInstitution(displayId, user, institutionId) {
  const probRows = await db.query('SELECT id FROM problems WHERE display_id = ?', [displayId]);
  if (!probRows.length) {
    const err = new Error('Challenge not found.');
    err.status = 404;
    throw err;
  }
  const instRows = await db.query('SELECT id, name FROM institutions WHERE id = ?', [institutionId]);
  if (!instRows.length) {
    const err = new Error('Unknown institution.');
    err.status = 400;
    throw err;
  }
  const problemId = probRows[0].id;
  const institution = instRows[0];

  await db.query(
    `UPDATE problems SET assigned_institution_id = ?, status = 'Assigned' WHERE id = ?`,
    [institution.id, problemId]
  );
  await db.query(
    `INSERT INTO problem_status_history (id, problem_id, status, note, changed_by_user_id)
     VALUES (?, ?, 'Assigned', ?, ?)`,
    [crypto.randomUUID(), problemId, `Assigned to ${institution.name}`, user.id]
  );
  return getProblemByDisplayId(displayId);
}

// ---------- AI-feature support ----------

// Candidate pool for local duplicate-similarity checking (see ai/similarity.js).
// Optionally narrowed to one category to keep the comparison relevant and fast.
async function listForDuplicateCheck({ category }) {
  if (category) {
    return db.query(
      `SELECT p.display_id AS id, p.title, p.description, p.status
       FROM problems p JOIN categories c ON c.id = p.category_id
       WHERE c.name = ? ORDER BY p.created_at DESC LIMIT 200`,
      [category]
    );
  }
  return db.query(
    `SELECT display_id AS id, title, description, status FROM problems
     ORDER BY created_at DESC LIMIT 200`
  );
}

// Cache the AI-generated case summary so we don't pay for a fresh API call
// on every page view — only when someone explicitly requests a refresh.
async function saveAISummary(displayId, summary) {
  await db.query('UPDATE problems SET ai_summary = ?, ai_summary_at = NOW() WHERE display_id = ?', [summary, displayId]);
}

module.exports = {
  registerUser, loginUser, getUserByToken,
  listCategories, listInstitutions, getStats,
  createProblem, getProblemByDisplayId, listProblems, updateStatus, assignInstitution,
  listForDuplicateCheck, saveAISummary
};
