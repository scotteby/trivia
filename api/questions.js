const https = require('https');

const MUSIC_CATS = new Set([
  'music', '80s hits', '80s music', '90s pop', '90s music', 'current hits',
  '60s & 70s classics', '2000s bangers', 'classic rock', 'hip hop', 'r&b & soul', 'country',
]);
const isMusicCat = c => MUSIC_CATS.has(c.toLowerCase().trim());

// iTunes search terms per music category — multiple options picked at random
const CAT_SEARCH_TERMS = {
  'music':              ['pop hits', 'top 40 hits', 'greatest hits', 'classic pop'],
  '80s hits':           ['80s pop', '1980s hits', 'eighties pop', '80s greatest hits'],
  '80s music':          ['80s pop', '1980s hits', 'eighties hits'],
  '90s pop':            ['90s pop', '1990s pop hits', 'nineties pop'],
  '90s music':          ['90s music', '1990s hits', 'nineties songs'],
  'current hits':       ['pop 2023', 'pop 2024', 'top hits 2023', 'top hits 2024'],
  '60s & 70s classics': ['1960s hits', '1970s hits', 'classic oldies', 'sixties pop'],
  '2000s bangers':      ['2000s pop', 'early 2000s hits', 'noughties pop'],
  'classic rock':       ['classic rock', 'rock classics', 'hard rock classics'],
  'hip hop':            ['hip hop', 'rap classics', 'hip hop hits'],
  'r&b & soul':         ['r&b soul', 'soul music', 'rhythm and blues'],
  'country':            ['country hits', 'country music', 'country songs'],
};

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

// ─── iTunes: fetch preview URL for a known artist+song ───────────────────────
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
            const artistLower = artist.toLowerCase();
            const match =
              data.results.find(r => r.previewUrl && r.artistName.toLowerCase().includes(artistLower.split(' ')[0])) ||
              data.results.find(r => r.previewUrl);
            resolve(match?.previewUrl || null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    } catch { resolve(null); }
  });
}

// ─── iTunes: search for tracks by category with randomised offset ─────────────
async function searchItunesTracks(category) {
  const terms = CAT_SEARCH_TERMS[category.toLowerCase().trim()] || CAT_SEARCH_TERMS['music'];
  const term = terms[Math.floor(Math.random() * terms.length)];
  const offset = Math.floor(Math.random() * 100);
  const query = encodeURIComponent(term);
  return new Promise(resolve => {
    try {
      const req = https.request({
        hostname: 'itunes.apple.com',
        path: `/search?term=${query}&media=music&entity=song&limit=25&offset=${offset}`,
        method: 'GET',
        headers: { 'User-Agent': 'TriviaApp/1.0' },
      }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            const results = (data?.results || []).filter(
              r => r.previewUrl && r.artistName && r.trackName
            );
            resolve(results);
          } catch { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.end();
    } catch { resolve([]); }
  });
}

// ─── Generate one music question around a specific iTunes track ───────────────
async function generateMusicQuestion(track, category, explain) {
  const artist = track.artistName;
  const song = track.trackName;
  const year = track.releaseDate ? new Date(track.releaseDate).getFullYear() : null;

  const questionTypes = ['artist', 'song'];
  if (year) questionTypes.push('year');
  const qType = questionTypes[Math.floor(Math.random() * questionTypes.length)];

  let qText, correctAnswer;
  if (qType === 'artist') {
    qText = 'Who is this artist?';
    correctAnswer = artist;
  } else if (qType === 'song') {
    qText = 'What is this song called?';
    correctAnswer = song;
  } else {
    qText = 'What year was this released?';
    correctAnswer = String(year);
  }

  const explainInstruction = explain
    ? ' Include an "explanation" field: one concise sentence explaining why the answer is correct.'
    : '';

  const prompt = `You are writing one music trivia question for a pub quiz.
Track: "${song}" by ${artist}${year ? ` (${year})` : ''}
Category: ${category}
Question: "${qText}"
Correct answer: "${correctAnswer}"

Write 3 plausible but wrong distractors:
- "Who is this artist?" → other real artists from a similar era/genre
- "What is this song called?" → other plausible song titles (real or believable)
- "What year was this released?" → nearby years within 4 years of ${year}

Return ONLY a JSON object, no markdown, no extra text.${explainInstruction}
Randomise the correct answer's position among the 4 opts and set "ans" to its 0-based index.
Format: {"type":"music","artist":"${artist}","song":"${song}","year":${year ?? null},"q":"${qText}","opts":["...","...","...","..."],"ans":N,"cat":"${category}"${explain ? ',"explanation":"..."' : ''}}`;

  const json = await callAnthropic({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  if (json.error || !json.content) throw new Error(json.error?.message || 'Anthropic error');
  const text = json.content[0].text.trim()
    .replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/```$/, '').trim();
  const q = JSON.parse(text);
  q.preview_url = track.previewUrl;
  return q;
}

// ─── Generate music questions for multiple categories ─────────────────────────
async function generateMusicQuestions(musicCats, perCat, explain) {
  const results = await Promise.all(musicCats.map(async cat => {
    try {
      const tracks = await searchItunesTracks(cat);
      if (tracks.length === 0) return [];
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      const chosen = shuffled.slice(0, perCat);
      return Promise.all(chosen.map(track =>
        generateMusicQuestion(track, cat, explain).catch(() => null)
      ));
    } catch { return []; }
  }));
  return results.flat().filter(Boolean);
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

    const musicCats   = cats.filter(isMusicCat);
    const generalCats = cats.filter(c => !isMusicCat(c));
    const hasMusicCats = musicCats.length > 0;

    const explainField = explain
      ? ',"explanation":"One concise sentence explaining why this answer is correct."'
      : '';

    const perCat = Math.max(1, Math.round(count / cats.length));

    try {
      // General questions via a single Claude call
      let generalQuestions = [];
      if (generalCats.length > 0) {
        const generalCount = generalCats.length * perCat;
        const json = await callAnthropic({
          model: 'claude-sonnet-4-6',
          max_tokens: Math.min(generalCount * 180 + 400, 4000),
          messages: [{
            role: 'user',
            content: `Generate exactly ${generalCount} practice trivia questions spread evenly across these categories: ${generalCats.join(', ')}.
{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField}}${avoidBlock}
${difficultyLine}
Rules: "ans" is the 0-based index of the correct answer. Every question must be completely unique. Return ONLY a valid JSON array, no markdown, no extra text.`,
          }],
        });
        generalQuestions = parseQuestions(json);
      }

      // Music questions: search iTunes first, then have Claude write around the track
      let musicQuestions = [];
      if (hasMusicCats) {
        musicQuestions = await generateMusicQuestions(musicCats, perCat, explain);
      }

      // Interleave general and music questions for variety
      const questions = [];
      let gi = 0, mi = 0;
      while (gi < generalQuestions.length || mi < musicQuestions.length) {
        if (gi < generalQuestions.length) questions.push(generalQuestions[gi++]);
        if (mi < musicQuestions.length) questions.push(musicQuestions[mi++]);
      }

      return res.status(200).json({ questions });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ─── Daily solo mode ─────────────────────────────────────────────────────────
  const DATE_STR = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Random position for the music question: not first (0) or last (4)
  const musicPos = 1 + Math.floor(Math.random() * 3);

  try {
    // Generate 4 general questions and 1 music question in parallel
    const [generalJson, musicQuestion] = await Promise.all([
      callAnthropic({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `Generate exactly 4 trivia questions for ${DATE_STR}.
{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}
Mix categories: Science, History, Geography, Pop Culture, Sports.
Rules: "ans" is the 0-based index of the correct answer. Return ONLY a valid JSON array, no markdown, no extra text.`,
        }],
      }),
      (async () => {
        const tracks = await searchItunesTracks('music');
        if (tracks.length === 0) return null;
        const track = tracks[Math.floor(Math.random() * tracks.length)];
        return generateMusicQuestion(track, 'Music', false).catch(() => null);
      })(),
    ]);

    const generalQuestions = parseQuestions(generalJson);

    // Splice music question into generalQuestions at musicPos
    const questions = [...generalQuestions];
    if (musicQuestion) questions.splice(musicPos, 0, musicQuestion);

    return res.status(200).json({ questions });
  } catch(e) {
    return res.status(500).json({ error: 'Handler failed', detail: e.message });
  }
};
