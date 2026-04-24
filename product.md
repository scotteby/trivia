# Trivia Night SaaS — Product References

A full record of all product decisions, UI descriptions, and feature plans from our planning session.

---

## What we're building

A multiplayer trivia SaaS targeting bars, restaurants, and venues — while keeping a free solo daily challenge as the acquisition channel.

**Existing app**: github.com/scotteby/trivia  
**Live URL**: trivia-two-steel.vercel.app  
**Stack**: Vanilla HTML/JS, Vercel, Supabase, Anthropic API

---

## Three modes

### 1. Solo mode (free, existing)
- Daily challenge, 5 questions, resets at midnight
- Speed bonus scoring (answer faster = more points)
- Global daily leaderboard
- 7-day streak tracking
- After game: upsell prompt to host a multiplayer game

### 2. Host mode (paid — Pro/Business)
- Venue host sets up a game room
- Gets a room code (e.g. PIZZA) to display on TV
- Controls game pace (next question button)
- Sees live leaderboard and response count on TV screen
- Connects laptop to TV via HDMI or Chromecast (no special hardware)

### 3. Join mode (always free for players)
- Players enter room code + name on their phone
- No app download, no account needed
- Answer questions, see their score update live
- See full leaderboard at end

---

## URLs

- `/` or `/solo` — solo daily challenge
- `/host` — game setup screen (requires Pro)
- `/join` — player join screen (enter room code)

---

## Home screen

Three cards visible immediately:

| Card | Color | Action |
|------|-------|--------|
| Play solo | Purple (featured) | Jump into daily challenge |
| Host a game | Green | Go to game setup |
| Join a game | Blue | Enter room code input |

- Global daily leaderboard shown below (top 3 solo scores today)
- Streak badge shown on solo card if player has an active streak
- After solo game: upsell banner "Host a game night free for 30 days"

---

## Game setup — three tiers

### Tier 1: Quick start (most prominent)
- One big button at top
- AI picks categories randomly for a balanced game
- Room code ready in ~5 seconds
- Most hosts will use this

### Tier 2: Pick a vibe (preset bundles)
Five presets in a grid:

| Preset | Categories | Notes |
|--------|-----------|-------|
| Mixed bag | General, History, 90s music, Sports, Pop culture | Default |
| Music night | 80s hits, 90s pop, Current hits | All music |
| Sports bar | Sports, General, Pop culture | |
| Brainiac | Science, History, Geography | Harder |
| Music + general mix | General, 90s music, Pop culture | Mark "Most popular" |

### Tier 3: Custom round builder
- Pick every round and category manually
- Each round = 5 questions
- Music rounds expand to show subcategory and question type options
- Phase 2 feature — "Coming soon" for MVP

### Global setup options (apply to all tiers)
- Rounds: 2 (~20 min), 3 (~30 min, default), 4 (~40 min)
- Timer: 10s, 15s (default), 20s, 30s per question
- Music questions automatically get +10s added
- Summary bar: "Mixed bag · 3 rounds · 15 questions · ~30 min"

---

## Categories

### General
- General knowledge
- History
- Science
- Sports
- Movies & TV
- Food & drink
- Geography
- Pop culture

### Music (subcategory — has audio clips)
- Music — all eras
- 60s & 70s classics
- 80s hits
- 90s pop
- 2000s bangers
- Current hits
- Classic rock
- Hip hop
- Country
- R&B & soul

### Music question types
- Name the artist
- Name the song
- Name the year
- Name the album

---

## Scoring

- 10 pts for correct answer
- Up to +5 speed bonus (proportional to how fast they answered)
- 0 pts for wrong answer or timeout
- Music questions: timer starts after clip finishes

---

## Host / TV screen layout

Designed to be readable from across a bar:

**Top bar**
- Venue/game name (left)
- Round and question number (center)
- Room code always visible (right) — so latecomers can join anytime

**Main area**
- Question text (large, 24px+)
- Four answer options in 2x2 grid
- Countdown timer (purple → amber at 8s → red at 4s)

**Right sidebar**
- Live leaderboard (top 5, updates in real time)
- Response counter "11 / 14 answered" + progress bar
- "Next question" button (host controls pace)

**After reveal**
- Correct answer: green
- Wrong answers: red
- "9 of 14 players got it right"
- 2s pause then next question

---

## Player phone screen layout

Minimal, large tap targets:

**In-game**
- Round / question number
- Timer badge (color changes)
- Current score
- Question text
- Four large answer buttons

**After answering**
- Selected answer highlighted purple
- "Locked in — waiting for others..."
- Can still see timer counting down

**After reveal**
- Correct: green highlight, "+13 pts"
- Wrong: red highlight, correct answer shown

**Music questions**
- Animated waveform shows while clip plays
- Answer buttons appear immediately (can answer while listening)
- Timer starts after clip ends

---

## Lobby screens

**Host lobby**
- Room code VERY large (readable across room)
- Join URL: yourdomain.com/join
- Live list of players joining
- Player count
- "Start game" button (enabled at 2+ players)
- Kick player option
- "Share room" copies join link

**Player lobby**
- "You're in! Room PIZZA"
- Live count and names of others joining
- "Waiting for host to start..."

---

## End of game

**Host screen**
- Full ranked leaderboard
- Podium for top 3 (dramatic)
- "Play again" → back to setup

**Player screen**
- Their rank and score
- Full leaderboard
- Share prompt

---

## Music questions — technical

Uses Spotify Preview API (free, no auth required for 30s clips):
- Search tracks by category/era
- Get `preview_url` (30-second clip)
- Host screen plays audio through laptop/TV speakers
- Player screen shows animated waveform
- Timer starts after clip plays

Question object:
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

## Pricing

| Plan | Price | Players | Rooms | Notes |
|------|-------|---------|-------|-------|
| Free | $0 | 15 | 1 | Solo + 1 multiplayer game |
| Pro | $49/mo | 75 | Unlimited | Custom branding, all categories |
| Business | $99/mo | 200 | Multiple simultaneous | White-label, email collection, CSV export |

**Path to $100/day**: ~60 Pro subscribers or ~30 Business subscribers = $3,000/month

**Upsell moment**: shown at end of every solo game

---

## Go-to-market

1. **Test at home with friends first** — use laptop as host, friends on phones
2. **Walk into local bars** — show it on your phone, offer free month
3. **Facebook Groups** — "Pub Quiz Hosts" and similar communities
4. **Demo video** — 60s TikTok/Reels of a real game night
5. **Partnerships** — trivia question suppliers, bar game companies

---

## Technical decisions

- Supabase Realtime for live updates (already connected)
- Room code synced timer: store `question_start_time`, all clients calculate countdown locally
- Room codes: 5-letter word from curated list, no ambiguous chars (O/I/0/1)
- Host is always separate device from players
- No app download ever — everything is a web URL
- Questions generated fresh by AI at game start — never repeated
- Solo mode stays free forever (top of funnel)

---

## Build order

1. Home screen
2. Supabase schema
3. Host setup screen (quick start + vibes)
4. Room creation + code generation
5. Player join flow
6. Lobby (both views, real-time)
7. In-game question display + synced timer
8. Player answer flow
9. Scoring + leaderboard
10. End of game screens
11. Music questions (Spotify)
12. Auth + Stripe payments

---

## Design tokens

```
Background:    #0f0f1a
Cards:         #16162a
Borders:       #2a2a48
Purple:        #7c3aed
Purple light:  #a78bfa
Text primary:  #e8e8f0
Text muted:    #888
Correct:       #22c55e
Wrong:         #ef4444
Timer warn:    #f59e0b
Music blue:    #378add
```
