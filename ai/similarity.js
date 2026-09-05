/**
 * Lightweight duplicate-detection helper.
 * This is plain bag-of-words cosine similarity — NOT a call to an AI model.
 * It's fast, free, and works offline, which makes it a good first filter:
 * catches near-identical re-phrasings of the same complaint without
 * needing an API key or costing anything per check.
 */

const STOPWORDS = new Set([
  'the','and','is','in','on','at','of','to','for','with','this','that','has',
  'have','been','was','were','are','from','near','our','their','there','since',
  'many','much','some','a','an','it','its','be','as','by','or','not','no',
  'we','i','you','he','she','they','them','his','her','but','so','if','then'
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function termFreqVector(tokens) {
  const freq = {};
  tokens.forEach((t) => { freq[t] = (freq[t] || 0) + 1; });
  return freq;
}

function cosineSimilarity(vecA, vecB) {
  const keys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
  let dot = 0, magA = 0, magB = 0;
  keys.forEach((k) => {
    const a = vecA[k] || 0, b = vecB[k] || 0;
    dot += a * b; magA += a * a; magB += b * b;
  });
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function similarityScore(textA, textB) {
  const vecA = termFreqVector(tokenize(textA));
  const vecB = termFreqVector(tokenize(textB));
  return cosineSimilarity(vecA, vecB);
}

module.exports = { similarityScore, tokenize };
