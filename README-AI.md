# AI Features — Setup & What's Actually AI

## The 3 features you asked for

| Feature | How it works | Real AI (Claude)? | Costs money per use? |
|---|---|---|---|
| **Categorization** | Reads the title/description, suggests one of the 10 fixed categories + a priority level | ✅ Yes — calls Claude | Yes, small — 1 API call per click |
| **Duplicate detection** | Compares word-overlap ("cosine similarity") between the new report and existing ones in the same category | ❌ No — plain JavaScript, no API call | No — free, instant, works offline |
| **Tracking** | Two things: (1) a Claude-written plain-language summary of a case's timeline, (2) a rule-based "⚠ Stalled" flag on the dashboard for cases untouched 7+ days | Summary: ✅ Yes. Stalled flag: ❌ No — just a date comparison | Summary: yes, per generation (cached after). Stalled flag: free |

**Why duplicate detection isn't an LLM call:** checking a new submission against hundreds of existing ones would mean hundreds of API calls (slow and expensive) every time someone types a report. Local text-similarity does the same practical job — catching re-phrased versions of the same complaint — for free and instantly. Worth knowing this distinction if a judge asks "what algorithm are you using" in your SIH demo — you can answer precisely instead of just saying "AI."

## Setup

1. Get an API key at **console.anthropic.com** (pay-as-you-go; a few hundred categorization/summary calls costs well under $1 with Claude Sonnet).
2. In `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-sonnet-5
   ```
3. Restart the server (`npm start` or `node server.js`). No key set → those two features return a clear "not configured" message instead of crashing; the rest of the site works normally either way.

Works with **both** backends — the JSON-file prototype (`server.js`) and the SQL-backed server (`server.sql.js`) now have identical `/api/ai/...` routes.

⚠️ **If you're using `server.js` (the JSON-file version) without ever running `npm install`:** it won't have the `dotenv` package, so it can't auto-read `.env`. Either run `npm install` once (installs `dotenv` + `mysql2`, harmless even if you don't use MySQL), or set the variable directly before starting the server:
- **Windows PowerShell:** `$env:ANTHROPIC_API_KEY="sk-ant-..."; node server.js`
- **Mac/Linux:** `ANTHROPIC_API_KEY=sk-ant-... node server.js`

## Where each feature shows up

- **`submit.html`** — two buttons under the description field:
  - "✨ AI: Suggest category & priority" — fills the form, but the citizen still confirms/edits before submitting (keeps a human in the loop on purpose)
  - "🔍 Check for similar reports" — shows a warning with links if something similar already exists
- **`problem.html`** — an "✨ AI status summary" panel at the top of the case detail; generates on request, cached in the database afterward
- **`dashboard.html`** — new "Tracking" column flagging cases with no status update in 7+ days

## New files

```
ai/
  anthropic.js   — Claude API wrapper (native fetch, no extra npm package)
  similarity.js  — local text-similarity for duplicate detection
  features.js    — the 3 feature functions, calling the above two
```

## Cost control built in

- Duplicate checks never call the paid API.
- Case summaries are cached (`ai_summary` column) — viewing a case again doesn't re-generate it, only clicking "Regenerate" does.
- Category suggestions only fire when the citizen clicks the button, not automatically on every keystroke.
