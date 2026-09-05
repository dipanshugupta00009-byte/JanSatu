/**
 * Thin wrapper around the Anthropic Messages API.
 * Uses Node's built-in fetch (Node 18+) — no extra npm package needed.
 *
 * Requires ANTHROPIC_API_KEY in .env. Get one at https://console.anthropic.com
 * If it's not set, every function here throws a clear 503 error instead of
 * failing mysteriously — the rest of the site keeps working either way.
 */
// dotenv is optional here — the SQL-backed server already depends on it
// (see package.json), but server.js (JSON-file version) intentionally has
// zero npm dependencies. If dotenv isn't installed, just skip auto-loading
// .env — process.env vars set any other way (hosting platform, shell) still work.
try { require('dotenv').config(); } catch (e) { /* not installed — fine */ }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

async function callClaude(systemPrompt, userPrompt, maxTokens = 300) {
  if (!ANTHROPIC_API_KEY) {
    const err = new Error('AI features are not configured for this deployment — set ANTHROPIC_API_KEY in .env to enable them.');
    err.status = 503;
    throw err;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`AI request failed (${res.status}): ${text.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  return block ? block.text.trim() : '';
}

module.exports = { callClaude };
