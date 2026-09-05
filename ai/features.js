/**
 * The three AI-related features, one function each:
 *   1. suggestCategory   — real AI (Claude): reads title+description, picks
 *                          a category + priority from the fixed list.
 *   2. findPossibleDuplicates — NOT an AI call. Local text-similarity
 *                          (see similarity.js) against existing cases.
 *   3. summarizeCase     — real AI (Claude): turns the raw status timeline
 *                          into a short plain-language update for citizens.
 */
const { callClaude } = require('./anthropic');
const { similarityScore } = require('./similarity');

async function suggestCategory(title, description, categories) {
  const system = `You are a triage assistant for a citizen problem-reporting registry in Jharkhand, India. ` +
    `Given a citizen's problem title and description, pick exactly ONE category from this fixed list: ` +
    `${categories.join(', ')}. Also suggest a priority — one of Low, Medium, High, or Critical — based on ` +
    `urgency and safety risk implied by the text. Respond with ONLY strict JSON, no other text, no markdown ` +
    `fences, in exactly this shape: {"category":"<one item from the list, verbatim>","priority":"<Low|Medium|High|Critical>","reason":"<one short sentence explaining the choice>"}`;
  const user = `Title: ${title}\nDescription: ${description}`;

  const raw = await callClaude(system, user, 200);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) { const err = new Error('Could not parse the AI response.'); err.status = 502; throw err; }
    parsed = JSON.parse(match[0]);
  }
  if (!categories.includes(parsed.category)) {
    parsed.category = categories[0]; // guard against the model inventing a category name
  }
  if (!['Low', 'Medium', 'High', 'Critical'].includes(parsed.priority)) {
    parsed.priority = 'Medium';
  }
  return parsed;
}

function findPossibleDuplicates(title, description, candidates, threshold = 0.35, limit = 5) {
  const text = `${title} ${description}`;
  return candidates
    .map((c) => ({ ...c, score: similarityScore(text, `${c.title} ${c.description}`) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => ({ id: c.id, title: c.title, status: c.status, score: Math.round(c.score * 100) }));
}

async function summarizeCase(problem) {
  const system = `You write short, plain-language status updates for citizens tracking a civic issue they ` +
    `reported in Jharkhand, India. Given the case details and its status timeline (as JSON), write ONE short ` +
    `paragraph (2-3 sentences, no headers, no markdown, no bullet points) telling the citizen what has ` +
    `happened so far and what it means for them. Be factual, warm, and simple — avoid jargon.`;
  const user = `Case: ${problem.title}\nCategory: ${problem.category}\nCurrent status: ${problem.status}\n` +
    `Timeline: ${JSON.stringify(problem.history)}`;
  return callClaude(system, user, 220);
}

module.exports = { suggestCategory, findPossibleDuplicates, summarizeCase };
