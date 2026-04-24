const https = require('https');

const MUSIC_CATS = new Set([
  'music', '80s hits', '80s music', '90s pop', '90s music', 'current hits',
  '60s & 70s classics', '2000s bangers', 'classic rock', 'hip hop', 'r&b & soul', 'country',
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

async function enrichWithPreviews(questions) {
  await Promise.all(questions.map(async q => {
    if (q.type === 'music' && q.artist && q.song) {
      q.preview_url = await getItunesPreview(q.artist, q.song);
    }
  }));
  return questions;
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

    let fmt;
    if (hasMusicCats && generalCats.length > 0) {
      fmt = `
For MUSIC categories (${musicCats.join(', ')}), use this format:
{"type":"music","artist":"Artist Name","song":"Song Title","year":1999,"q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField}}
Alternate "q" randomly between "Who is this artist?" and "What is this song?".

For all other categories (${generalCats.join(', ')}):
{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField}}`;
    } else if (hasMusicCats) {
      fmt = `All questions are music questions:
{"type":"music","artist":"Artist Name","song":"Song Title","year":1999,"q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField}}
Alternate "q" randomly between "Who is this artist?" and "What is this song?".`;
    } else {
      fmt = `{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField}}`;
    }

    const maxTokens = Math.min(explain ? count * 300 + 600 : count * 180 + 400, 4000);

    try {
      const json = await callAnthropic({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: `Generate exactly ${count} practice trivia questions spread evenly across these categories: ${cats.join(', ')}.
${fmt}${avoidBlock}
${difficultyLine}
Rules: "ans" is the 0-based index of the correct answer. Every question must be completely unique — no repeats, no rephrasing of prior questions. For music questions, use only widely-known popular songs. Return ONLY a valid JSON array, no markdown, no extra text.`,
        }],
      });
      let questions = parseQuestions(json);
      if (hasMusicCats) questions = await enrichWithPreviews(questions);
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
    const json = await callAnthropic({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Generate exactly 5 trivia questions for ${DATE_STR}.
Position ${musicPos} (0-indexed) must be a music question. All other positions are standard trivia.

Standard format: {"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}
Music format (position ${musicPos} only): {"type":"music","artist":"Artist Name","song":"Song Title","year":YEAR,"q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Music"}
For the music question, randomly use "Who is this artist?" or "What is this song?" as the question. Use a widely-known popular song.

For standard questions, mix: Science, History, Geography, Pop Culture, Sports.
Rules: "ans" is the 0-based index of the correct answer. Return ONLY a valid JSON array, no markdown, no extra text.`,
      }],
    });
    let questions = parseQuestions(json);
    questions = await enrichWithPreviews(questions);
    return res.status(200).json({ questions });
  } catch(e) {
    return res.status(500).json({ error: 'Handler failed', detail: e.message });
  }
};
