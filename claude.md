# Quizzli — Developer Reference

Live at **quizzli.app** · Repo: github.com/scotteby/trivia

---

## Stack

- **Frontend**: Vanilla HTML/JS — `index.html`, `host.html`, `join.html`, `practice.html`
- **API**: Vercel serverless — `api/questions.js`, `api/rooms.js`
- **Database + Realtime**: Supabase (`postgres_changes` subscriptions on `game_rooms` and `players`)
- **AI**: Anthropic Claude API (`claude-sonnet-4-6`) for question generation
- **Music**: iTunes Preview API (30s clips, no auth)
- **Images**: Wikimedia Commons via Wikipedia API

---

## Supabase tables

### highscores
- `date` (text, unique), `score` (int), `set_at` (text), `questions` (jsonb)

### game_rooms
- `id` (uuid), `room_code` (text), `status` ("lobby"|"active"|"finished")
- `current_question_index` (int), `question_start_time` (timestamp)
- `config` (jsonb), `questions` (jsonb)

### players
- `id` (uuid), `room_id` (uuid FK), `name` (text), `score` (int)
- `answers` (jsonb) — `[{question_index, answer_index, pts, correct, time_taken}]`

### game_stats
- `id` (text PK) = "total_games", `count` (int)
- Incremented on multiplayer game over, practice session end, daily quiz completion

---

## Key patterns

### Realtime
All clients subscribe to `postgres_changes` on `game_rooms` (filtered by room id) and `players` (filtered by room_id). Use `.maybeSingle()` not `.single()` to avoid 406 errors.

### Synced timer
`question_start_time` is stored in `game_rooms`. All clients compute:
```js
timeLeft = timerDuration - Math.floor((Date.now() - new Date(question_start_time).getTime()) / 1000)
```
This keeps everyone in sync regardless of when they connect.

### Between-rounds countdown sync
For between-round transitions, host sets `question_start_time = new Date(Date.now() + 3000)` **before** the countdown starts. This way join screens receive the realtime event immediately and run their 3s countdown in parallel with the host. When all devices call `showIngame()`, `question_start_time` is at or just past now — reveal delay is fresh everywhere.

For round 1, host sets `question_start_time` **after** its countdown completes. Join screens go straight to `showIngame()` (no join-side countdown for round 1).

### iOS audio unlock
iOS Safari requires audio play from inside a user gesture. After async calls (e.g. Supabase), the gesture context expires. Fix:
1. Call `unlockAudio()` synchronously at the start of the gesture handler (before any await)
2. `unlockAudio()` creates `state.audio = new Audio(SILENT_WAV)` and calls `.play()`
3. `playClip(url)` reuses the same element: `state.audio.src = url; state.audio.play()`
4. `stopClip()` pauses but preserves `state.audio` (never nulls it)

```js
const SILENT_AUDIO = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAA...';
```

### Question reveal phase
After `showIngame()`, answer buttons are hidden for `QUESTION_REVEAL_SECS` (3s for general/image, clip duration for music). This gives players time to read the question before the timer starts.

```js
const elapsed = Math.floor((Date.now() - new Date(state.room.question_start_time).getTime()) / 1000);
const revealRemaining = QUESTION_REVEAL_SECS - elapsed;
if (revealRemaining > 0) {
  setTimeout(showOptions, revealRemaining * 1000);
} else {
  showOptions();
}
```

---

## Scoring

Escalating by round:
```js
const questionsPerRound = 5;
const roundNum = Math.floor(qi / questionsPerRound) + 1;
const basePoints = 100 * roundNum;
const maxBonus = 50 * roundNum;
const bonus = Math.round(maxBonus * Math.max(0, (timerDuration - elapsed) / timerDuration));
pts = basePoints + bonus;
```
Round 1 max = 150, Round 2 max = 300, Round 3 max = 450. 3-round game max = 4,500 pts.

---

## Image question pipeline

1. Claude generates `image_file` — exact Wikimedia Commons filename (e.g. `Flag_of_Japan.svg`)
2. Server calls Wikipedia API: `/w/api.php?action=query&titles=File:${filename}&prop=imageinfo&iiprop=url`
3. Extracts `imageinfo[0].url` → CDN URL stored as `image_url`
4. If URL resolution fails, question falls back to `type: "general"`
5. Client renders `<img src="${q.image_url}">` with error fallback

---

## Music question pipeline

1. Claude generates `artist` and `song` fields
2. Server queries iTunes: `/search?term=${artist}+${song}&media=music&entity=song&limit=10`
3. Scores results by artist/song name match, picks best `previewUrl`
4. Stored as `preview_url` on the question object
5. Music uniqueness: constraint (decade/tier/region), session seed, `avoidSongBlock` (previous songs), `getMusicConstraint()` randomisation

---

## Question format

```json
// General
{ "type": "general", "q": "...", "opts": ["A","B","C","D"], "ans": 2, "cat": "Science" }

// Music  
{ "type": "music", "artist": "...", "song": "...", "preview_url": "https://...", "q": "Who is this artist?", "opts": [...], "ans": 0, "cat": "80s hits" }

// Image
{ "type": "image", "image_file": "Flag_of_Japan.svg", "image_url": "https://upload.wikimedia.org/...", "q": "Which country's flag is this?", "opts": [...], "ans": 1, "cat": "Flags", "hint": "..." }
```

---

## Category sets

```js
const MUSIC_CATS = new Set(['music', '80s hits', '80s music', '90s pop', '90s music',
  'current hits', '60s & 70s classics', '2000s bangers', 'classic rock',
  'hip hop', 'r&b & soul', 'country', 'music — all eras']);

const IMAGE_CATS = new Set(['images', 'flags', 'landmarks', 'art & paintings',
  'famous people', 'animals']);

const KIDS_CATS = new Set(['kids', 'children', 'disney & pixar', 'animals & nature',
  'cartoons & animation', 'books & stories', 'sports for kids',
  'science & space', 'food & holidays']);
```

---

## Game presets (api/rooms.js)

```js
const PRESETS = {
  mixed:    { categories: ['General knowledge', 'History', 'Sports', 'Pop culture', 'Science'] },
  music:    { categories: ['80s hits', '90s pop', 'Current hits'] },
  sports:   { categories: ['Sports', 'General knowledge', 'Pop culture'] },
  brainiac: { categories: ['Science', 'History', 'Geography'] },
  musicmix: { categories: ['General knowledge', '90s music', 'Pop culture'] },
  kids:     { categories: ['Disney & Pixar', 'Animals & nature', 'Cartoons & animation', 'Books & stories', 'Science & space'] },
  pictures: { categories: ['Flags', 'Landmarks', 'Art & Paintings', 'Famous people', 'Images'] },
};
```

---

## Key decisions

- `question_start_time` is the single source of truth for all timing across all clients
- Room codes: 5-letter words from curated list, no ambiguous chars (O, I, 0, 1)
- Players never need accounts — name + room code only
- Host device is always separate from player devices (host.html vs join.html)
- Questions generated fresh by AI at game start via `api/rooms.js` → `api/questions.js`
- Daily questions cached in `highscores.questions` to avoid re-generating on reload
- Date uses local time (not UTC) to avoid midnight timezone issues
- `api/questions.js` uses native `https` module (no node-fetch)
- API keys in Vercel env vars: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`
- Host player ID persisted to localStorage (`HOST_PLAYER_ID_KEY`, `HOST_PLAYER_NAME_KEY`)
- Practice mode: `practiceGameCounted` flag prevents double-counting per session

---

## Git workflow

```bash
git add <files>
git commit -m "Brief description of what changed"
```
