# Quizzli — Product Reference

Live at **quizzli.app**

---

## What it is

Quizzli is a live multiplayer trivia app for bars and venues. A host runs the game from their phone or laptop; players join instantly on their phones with a room code — no app download, no account needed. A free daily solo challenge (5 questions) serves as the acquisition channel.

---

## Stack

- **Frontend**: Vanilla HTML/JS — `index.html`, `host.html`, `join.html`, `practice.html`
- **API**: Vercel serverless functions at `/api` (`questions.js`, `rooms.js`)
- **Database + Realtime**: Supabase (postgres_changes subscriptions)
- **AI**: Anthropic Claude API (question generation)
- **Music**: iTunes Preview API (free 30s clips, no auth required)
- **Payments/Auth**: Not built

---

## URLs

| Path | Screen |
|------|--------|
| `/` | Home screen — daily quiz, practice, host, join |
| `/host` | Game setup + host controls |
| `/join` | Player join screen (enter room code) |
| `/practice` | Solo practice mode with category picker |

---

## Supabase tables

### highscores
- `date` (text, unique) — YYYY-MM-DD local date
- `score` (int) — today's high score
- `set_at` (text) — time string
- `questions` (jsonb) — cached daily question array

### game_rooms
- `id` (uuid, PK)
- `room_code` (text, unique) — 5-letter code e.g. "PIZZA"
- `status` (text) — "lobby" | "active" | "finished"
- `current_question_index` (int, default 0)
- `question_start_time` (timestamp) — synced timer anchor for all clients
- `config` (jsonb) — rounds, categories, timer, difficulty
- `questions` (jsonb) — generated question array

### players
- `id` (uuid, PK)
- `room_id` (uuid, FK → game_rooms)
- `name` (text)
- `score` (int, default 0)
- `answers` (jsonb) — `[{question_index, answer_index, pts, correct, time_taken}]`
- `joined_at` (timestamp)

### game_stats
- `id` (text, PK) — "total_games"
- `count` (int) — total games played across all modes

---

## Design tokens (light theme throughout)

```
Background:    #f5f5fa
Cards:         #ffffff
Borders:       #e4e4f0
Purple:        #7c3aed
Purple light:  #a78bfa
Text primary:  #1a1a2e
Text muted:    #9090b8
Correct:       #22c55e
Wrong:         #ef4444
Timer warn:    #f59e0b
Music blue:    #378add
```

TV mode is an optional dark overlay (`body.tv-mode`) for casting to a screen across the room. Toggle button visible during game.

---

## Scoring

Escalating by round:
- **Round N** = 100×N base points + up to 50×N speed bonus
- Round 1 max: 150 pts · Round 2 max: 300 pts · Round 3 max: 450 pts
- **3-round game max: 4,500 pts** (5 questions × 150 + 5 × 300 + 5 × 450)
- Speed bonus: `Math.round(maxBonus * Math.max(0, (timerDuration - elapsed) / timerDuration))`

---

## Categories

### General
General Knowledge, History, Science, Sports, Movies & TV, Food & Drink, Geography, Pop Culture

### Music (has audio clips via iTunes Preview API)
Music — all eras, 60s & 70s classics, 80s hits, 90s pop, 2000s bangers, Current hits, Classic rock, Hip hop, Country, R&B & soul

### Kids
Disney & Pixar, Animals & nature, Cartoons & animation, Books & stories, Science & space, Food & holidays, Sports for kids

### Images
Flags, Landmarks, Art & Paintings, Famous people, Animals

---

## Game setup

### Presets
| Preset | Icon | Notes |
|--------|------|-------|
| Mixed bag | 🎲 | Default |
| Music night | 🎵 | All music rounds |
| Sports bar | 🏆 | Heavy on sports |
| Brainiac | 🔬 | Hard mode |
| Kids night | ⭐ | Family friendly |
| Picture round | 🖼️ | Flags, landmarks, art |
| Music + general mix | 🎶 | Most popular, full-width card |

### Options
- **Rounds**: 2, 3 (default), 4
- **Timer**: 5s, 10s (default), 20s, 30s per question
- **Difficulty**: Easy, Mixed (default), Hard
- Custom category picker: per-round, supports custom-named categories and artist-specific music rounds

---

## Question types

### General
```json
{ "type": "general", "q": "...", "opts": ["A","B","C","D"], "ans": 2, "cat": "Science" }
```

### Music
```json
{
  "type": "music",
  "preview_url": "https://audio-ssl.itunes.apple.com/...",
  "artist": "Billie Eilish",
  "song": "Birds of a Feather",
  "q": "Who is this artist?",
  "opts": ["Taylor Swift", "Olivia Rodrigo", "Billie Eilish", "Dua Lipa"],
  "ans": 2,
  "cat": "Current hits"
}
```

### Image
```json
{
  "type": "image",
  "image_file": "Flag_of_Japan.svg",
  "image_url": "https://upload.wikimedia.org/...",
  "q": "Which country's flag is this?",
  "opts": ["China", "Japan", "South Korea", "Taiwan"],
  "ans": 1,
  "cat": "Flags",
  "hint": "Rising sun flag"
}
```

---

## Game flow

1. **Lobby** — host shares room code; players join with name + code; real-time player list
2. **Host starts** — host counts down 3s, sets `question_start_time`, all devices sync
3. **Reveal phase** — question shown, answer buttons hidden for 3s (QUESTION_REVEAL_SECS); music clips play first
4. **Answer phase** — timer counts down from `question_start_time`; players tap to lock in
5. **Auto-reveal** — when timer expires OR all players answer, answers reveal
6. **Between questions** — host taps "Next question" or timer auto-advances
7. **Round leaderboard** — shown after every 5 questions; displays escalating point badge for next round
8. **Between rounds** — host sets `question_start_time` 3s in future; all devices show 3s countdown simultaneously
9. **Final results** — ranked leaderboard, host sees "Play again" option

---

## Modes

### Daily quiz (index.html)
5 questions (3 general + 1 music + 1 image), resets midnight, high score saved to `highscores` table.

### Practice mode (practice.html)
Solo, no time pressure option, category picker, difficulty setting, optional explanations, custom categories, endless sessions.

### Multiplayer (host.html + join.html)
Host plays along option — host can join as a player on the host device. TV mode for casting.

---

## Home screen
- Quizzli title + tagline
- Daily quiz card (today's best score inline)
- Practice mode card
- Host a game card
- Join a game card (room code input)
- Games played counter (fetched live from `game_stats`)
