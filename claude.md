# Trivia Night SaaS
Previously a solo daily trivia app, now evolving into a multiplayer trivia SaaS targeting bars and venues. Solo mode stays free as the acquisition channel. Multiplayer is the paid product.

---

## Stack
- **Frontend**: Vanilla JS, HTML files (index.html, host.html, join.html)
- **API**: Vercel serverless functions at /api
- **Database + Realtime**: Supabase
- **AI**: Anthropic Claude API for question generation
- **Music**: Spotify Preview API (free 30s clips, no auth required)
- **Payments**: Stripe (Phase 3 — not built yet)
- **Auth**: Supabase Auth (Phase 3 — not built yet)

---

## Supabase tables

### highscores (existing)
- date (text, unique) — local date YYYY-MM-DD
- score (integer) — today's high score
- set_at (text) — time string
- questions (jsonb) — AI generated questions array

### game_rooms (new)
- id (uuid, primary key)
- room_code (text, unique) — 5-letter code e.g. "PIZZA"
- status (text) — "lobby", "active", "finished"
- current_question_index (int, default 0)
- question_start_time (timestamp) — used by all clients to sync countdown timer
- config (jsonb) — rounds, categories, timer setting
- questions (jsonb) — array of generated question objects
- created_at (timestamp)

### players (new)
- id (uuid, primary key)
- room_id (uuid, foreign key → game_rooms)
- name (text)
- score (int, default 0)
- answers (jsonb) — array of {question_index, answer_index, pts, time_taken}
- joined_at (timestamp)

Enable Supabase Realtime on both game_rooms and players tables.

---

## Key decisions (existing)
- Use `.maybeSingle()` not `.single()` to avoid 406 errors on missing rows
- Date uses local time not UTC to avoid timezone issues
- api/questions.js uses native https module, no node-fetch
- API key stored as ANTHROPIC_API_KEY in Vercel env vars

## Key decisions (multiplayer)
- Synced timer: store `question_start_time` in Supabase when host starts a question. All clients calculate `timeLeft = timerDuration - (Date.now() - question_start_time)` so everyone counts down from the same moment
- Room codes: 5-letter words from a curated list, avoid ambiguous chars (O, I, 0, 1). Check uniqueness before creating
- Players never need an account — join with just a name and room code
- Host device is always separate from player devices
- Questions generated fresh by AI at game start — never pre-generated
- Music questions get +10s added to timer automatically
- Host controls pace — "next question" is always a manual button, timer auto-advances if host doesn't tap

---

## URLs
- `/` or `/solo` — solo daily challenge (existing)
- `/host` — game setup screen
- `/join` — player join screen (enter room code)

---

## Question object structure

### Standard question
```json
{
  "type": "standard",
  "q": "Which element has the chemical symbol Au?",
  "opts": ["Silver", "Copper", "Gold", "Aluminum"],
  "ans": 2,
  "cat": "Science"
}
```

### Music question
```json
{
  "type": "music",
  "preview_url": "https://p.scdn.co/...",
  "artist": "Billie Eilish",
  "song": "Birds of a Feather",
  "year": 2024,
  "q": "Who is this artist?",
  "opts": ["Taylor Swift", "Olivia Rodrigo", "Billie Eilish", "Dua Lipa"],
  "ans": 2,
  "cat": "Current hits"
}
```

---

## Scoring
- 10 pts for correct answer
- Up to +5 speed bonus (proportional to how fast they answered)
- 0 pts for wrong answer or timeout
- Formula: `bonus = Math.round(5 * Math.max(0, (timerDuration - elapsed) / timerDuration))`

---

## Design tokens
```
Background:     #0f0f1a
Cards:          #16162a
Borders:        #2a2a48
Primary purple: #7c3aed
Purple light:   #a78bfa
Text primary:   #e8e8f0
Text muted:     #888
Correct:        #22c55e
Wrong:          #ef4444
Timer warning:  #f59e0b
Music blue:     #378add
```

TV/host screens: questions 20px+, room code 48px+, readable from across a room.
Player screens: answer buttons minimum 44px height for easy tapping on mobile.

---

## Categories

### General
General knowledge, History, Science, Sports, Movies & TV, Food & drink, Geography, Pop culture

### Music (has audio clips via Spotify Preview API)
Music — all eras, 60s & 70s classics, 80s hits, 90s pop, 2000s bangers, Current hits, Classic rock, Hip hop, Country, R&B & soul

### Music question types
Name the artist, Name the song, Name the year, Name the album

---

## Game setup options

### Preset vibes
| Preset | Categories |
|--------|-----------|
| Mixed bag | General, History, 90s music, Sports, Pop culture |
| Music night | 80s hits, 90s pop, Current hits |
| Sports bar | Sports, General, Pop culture |
| Brainiac | Science, History, Geography |
| Music + general mix | General, 90s music, Pop culture — mark as "Most popular" |

### Rounds: 2 (~20 min), 3 (~30 min, default), 4 (~40 min)
### Timer: 10s, 15s (default), 20s, 30s — music questions auto get +10s

---

## Build order
1. Home screen (solo / host / join paths)
2. Supabase schema (game_rooms + players with Realtime)
3. Host setup screen (quick start + vibe presets)
4. Room creation + code generation
5. Player join flow
6. Lobby — host and player views with real-time player list
7. In-game question display + synced timer
8. Player answer flow (tap, lock in, reveal)
9. Scoring and leaderboard
10. End of game screens
11. Music questions (Spotify Preview API)
12. Auth + Stripe payments

---

## Git workflow
After any code changes, always stage and commit with a descriptive message:
```bash
git add .
git commit -m "Brief description of what changed"
```