# Daily Trivia App

## Stack
- Frontend: vanilla JS, single index.html
- API: Vercel serverless function at api/questions.js
- Database: Supabase (highscores table)
- AI: Anthropic Claude API for daily question generation

## Supabase table: highscores
- date (text, unique) — local date YYYY-MM-DD
- score (integer) — today's high score
- set_at (text) — time string
- questions (jsonb) — AI generated questions array

## Key decisions
- Use .maybeSingle() not .single() to avoid 406 errors on missing rows
- Date uses local time not UTC to avoid timezone issues
- api/questions.js uses native https module, no node-fetch
- API key stored as ANTHROPIC_API_KEY in Vercel env vars

## Git Workflow
After making any code changes, always stage and commit with a descriptive commit message:
```bash
git add .
git commit -m "Brief description of what changed"
```
