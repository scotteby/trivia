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
      .split(',').map(c => c.trim()).filter(Boolean);
    const count = Math.min(Math.max(parseInt(req.query.count) || 10, 1), 20);
    const explain = req.query.explain === 'true';

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
          content: `Generate exactly ${count} trivia questions spread evenly across these categories: ${cats.join(', ')}.
Format: ${fmt}
Rules: "ans" is the 0-based index of the correct answer. Mix easy and harder questions. Questions must be unique and interesting. Return ONLY a valid JSON array, no markdown, no extra text.`,
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

  try {
    const json = await callAnthropic({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Generate 5 trivia questions for ${DATE_STR}. Return ONLY valid JSON array, no other text, no markdown backticks:
[
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 0, "cat": "Category" },
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 2, "cat": "Category" },
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 1, "cat": "Category" },
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 3, "cat": "Category" },
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 0, "cat": "Category" }
]
Mix categories: Science, History, Geography, Art, Pop Culture.`,
      }],
    });
    return res.status(200).json({ questions: parseQuestions(json) });
  } catch(e) {
    return res.status(500).json({ error: 'Handler failed', detail: e.message });
  }
};
