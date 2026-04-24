const https = require('https');

const MUSIC_CATS = new Set([
  'music', '80s hits', '80s music', '90s pop', '90s music', 'current hits',
  '60s & 70s classics', '2000s bangers', 'classic rock', 'hip hop', 'r&b & soul', 'country',
  'music — all eras',
]);
const isMusicCat = c => MUSIC_CATS.has(c.toLowerCase().trim());

function callAnthropic(body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function parseQuestions(json) {
  if (json.error || !json.content) throw new Error(json.error?.message || 'Anthropic error');
  const text = json.content[0].text.trim()
    .replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/```$/, '').trim();
  return JSON.parse(text);
}

// iTunes lookup: search artist+song, return previewUrl of closest match
async function getItunesPreview(artist, song) {
  return new Promise(resolve => {
    try {
      const query = encodeURIComponent(`${artist} ${song}`);
      const req = https.request({
        hostname: 'itunes.apple.com',
        path: `/search?term=${query}&media=music&entity=song&limit=10`,
        method: 'GET',
        headers: { 'User-Agent': 'TriviaApp/1.0' },
      }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (!Array.isArray(data?.results)) return resolve(null);
            const withPreviews = data.results.filter(r => r.previewUrl);
            if (!withPreviews.length) return resolve(null);
            const artistFirst = artist.toLowerCase().split(' ')[0];
            const songFirst = song.toLowerCase().split(' ')[0];
            const scored = withPreviews.map(r => {
              let score = 0;
              if (r.artistName?.toLowerCase().includes(artistFirst)) score += 2;
              if (r.trackName?.toLowerCase().includes(songFirst)) score += 2;
              return { url: r.previewUrl, score };
            });
            scored.sort((a, b) => b.score - a.score);
            resolve(scored[0].url);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    } catch { resolve(null); }
  });
}

// Enrich music questions with iTunes preview URLs in parallel
async function enrichWithPreviews(questions) {
  return Promise.all(questions.map(async q => {
    if (q.type !== 'music' || !q.artist || !q.song) return q;
    const preview_url = await getItunesPreview(q.artist, q.song);
    return { ...q, preview_url: preview_url || null };
  }));
}

function getMusicConstraint(category) {
  const decades = ['1965-1972','1973-1979','1980-1985','1986-1989','1990-1994','1995-1999','2000-2004','2005-2009','2010-2015','2016-2021'];
  const tiers = [
    'Avoid the 20 most famous songs. Pick album tracks or deep cuts true fans would know.',
    'Pick songs that reached #1 on the charts but are now slightly forgotten.',
    'Focus on one-hit wonders or artists who peaked quickly.',
    'Pick songs from the middle of artists careers, not their most famous hits.',
    'Focus on songs that were massive hits in their era but rarely appear in trivia today.',
  ];
  const regions = ['UK artists','Australian or Canadian artists','American artists outside New York or LA','Motown artists','artists who got their start in the 80s but peaked in the 90s'];
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const constraints = [
    `Focus on songs from ${pick(decades)}.`,
    pick(tiers),
    `Focus on ${pick(regions)}.`,
  ];
  return pick(constraints);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });
  }

  // ─── Practice mode ──────────────────────────────────────────────────────────
  if (req.query?.practice === 'true') {
    const cats = (req.query.categories || 'General Knowledge')
      .split(',').map(c => c.trim().replace(/\+/g, ' ')).filter(Boolean);
    const count = Math.min(Math.max(parseInt(req.query.count) || 10, 1), 20);
    const explain = req.query.explain === 'true';
    const avoidRaw = (req.query.avoid || '').replace(/\+/g, ' ');
    const avoidList = avoidRaw ? avoidRaw.split('||').map(s => s.trim()).filter(Boolean) : [];
    const avoidBlock = avoidList.length > 0
      ? `\nDo NOT repeat or closely resemble any of these already-asked questions:\n${avoidList.map(q => `- ${q}`).join('\n')}\n`
      : '';

    const difficultyInstructions = {
      easy:  'Difficulty: EASY — use well-known mainstream facts that most adults would recognise. Avoid niche or obscure details.',
      mixed: 'Difficulty: MIXED — balance roughly half straightforward questions with half that require a bit more knowledge.',
      hard:  'Difficulty: HARD — use specific, less-obvious facts. Avoid questions with obvious answers. Distractors should be plausible.',
    };
    const difficulty = ['easy', 'mixed', 'hard'].includes(req.query.difficulty) ? req.query.difficulty : 'mixed';
    const difficultyLine = difficultyInstructions[difficulty];

    const customMusicRaw = (req.query.customMusicCats || '').replace(/\+/g, ' ');
    const customMusicSet = new Set(customMusicRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    const isMusicCatEx = c => isMusicCat(c) || customMusicSet.has(c.toLowerCase().trim());

    let customCatsMeta = {};
    try { if (req.query.customCatsMeta) customCatsMeta = JSON.parse(req.query.customCatsMeta); } catch {}

    const musicCats   = cats.filter(isMusicCatEx);
    const generalCats = cats.filter(c => !isMusicCatEx(c));
    const artistTypeCats = musicCats.filter(c => customCatsMeta[c]?.musicType === 'artist');
    const genreMusicCats = musicCats.filter(c => customCatsMeta[c]?.musicType !== 'artist');

    const explainField = explain
      ? ',"explanation":"One concise sentence explaining why this answer is correct."'
      : '';

    const perCat = Math.max(1, Math.round(count / cats.length));
    const totalCount = cats.length * perCat;

    // Build format block per category type
    const fmtParts = [];
    if (generalCats.length > 0) {
      fmtParts.push(`For general categories (${generalCats.join(', ')}):
{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField}}`);
    }
    if (genreMusicCats.length > 0) {
      fmtParts.push(`For music categories (${genreMusicCats.join(', ')}):
{"type":"music","artist":"Artist Name","song":"Song Title","year":1999,"q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField}}
Alternate "q" randomly among: "Who is this artist?", "What is this song called?", "What year was this released?"
Music constraint (follow strictly): ${getMusicConstraint(genreMusicCats[0] || 'music')}
Session seed (ignore): ${Date.now()}-${Math.random()}`);
    }
    if (artistTypeCats.length > 0) {
      fmtParts.push(`For artist categories (${artistTypeCats.join(', ')}): the category IS the artist — NEVER ask "Who is this artist?". Only use: "What is this song called?", "What year was this released?". Wrong answer options must be other songs or years by the same artist.
{"type":"music","artist":"[exact artist name]","song":"Song Title","year":1999,"q":"What is this song called?","opts":["Song A","Song B","Song C","Song D"],"ans":0,"cat":"[artist name]"${explainField}}`);
    }

    try {
      const json = await callAnthropic({
        model: 'claude-sonnet-4-6',
        max_tokens: Math.min(totalCount * 220 + 500, 4000),
        messages: [{
          role: 'user',
          content: `Generate exactly ${totalCount} practice trivia questions: ${perCat} per category, in this order: ${cats.map(c => `"${c}"`).join(', ')}.
${fmtParts.join('\n\n')}
${difficultyLine}${avoidBlock}
Rules: "ans" is the 0-based index of the correct answer. Every question must be completely unique. Return ONLY a valid JSON array, no markdown, no extra text.`,
        }],
      });

      let questions = parseQuestions(json);
      questions = await enrichWithPreviews(questions);
      return res.status(200).json({ questions });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ─── Daily solo mode ─────────────────────────────────────────────────────────
  const DATE_STR = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  try {
    const json = await callAnthropic({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Generate exactly 5 trivia questions for ${DATE_STR}: 4 general and 1 music, mixed in any order.

For general questions:
{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}
Mix categories: Science, History, Geography, Pop Culture, Sports.

For the music question:
{"type":"music","artist":"Artist Name","song":"Song Title","year":1999,"q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Music"}
Alternate "q" randomly among: "Who is this artist?", "What is this song called?", "What year was this released?"
Music constraint (follow strictly): ${getMusicConstraint('music')}
Session seed (ignore): ${Date.now()}-${Math.random()}

Rules: "ans" is the 0-based index of the correct answer. Return ONLY a valid JSON array of exactly 5 questions, no markdown, no extra text.`,
      }],
    });

    let questions = parseQuestions(json);
    questions = await enrichWithPreviews(questions);
    return res.status(200).json({ questions });
  } catch(e) {
    return res.status(500).json({ error: 'Handler failed', detail: e.message });
  }
};
