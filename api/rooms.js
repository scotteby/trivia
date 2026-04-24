const https = require('https');

const SUPABASE_URL = 'https://hfyanydnihumfcsgsxzf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmeWFueWRuaWh1bWZjc2dzeHpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDI5MTIsImV4cCI6MjA5MjExODkxMn0.LimVOp7XksHiCSxAA_Bil7ruw8Vm0YRdOvuOQy03Gdc';

const PRESETS = {
  mixed:    { categories: ['General knowledge', 'History', 'Sports', 'Pop culture', 'Science'] },
  music:    { categories: ['80s hits', '90s pop', 'Current hits'] },
  sports:   { categories: ['Sports', 'General knowledge', 'Pop culture'] },
  brainiac: { categories: ['Science', 'History', 'Geography'] },
  musicmix: { categories: ['General knowledge', '90s music', 'Pop culture'] },
};

const MUSIC_CATS = new Set([
  'music', '80s hits', '80s music', '90s pop', '90s music', 'current hits',
  '60s & 70s classics', '2000s bangers', 'classic rock', 'hip hop', 'r&b & soul', 'country',
]);
const isMusicCat = c => MUSIC_CATS.has(c.toLowerCase().trim());

// ─── HTTP helpers ─────────────────────────────────────────────
function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sbReq(path, method = 'GET', body = null) {
  const bodyStr = body ? JSON.stringify(body) : null;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method === 'POST' || method === 'PATCH') headers['Prefer'] = 'return=representation';
  if (bodyStr) headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
  return httpsReq(
    { hostname: SUPABASE_URL.replace('https://', ''), path: `/rest/v1${path}`, method, headers },
    bodyStr
  );
}

// Throws with the Supabase error message if the response is not 2xx
function assertSb({ status, data }, context) {
  if (status >= 200 && status < 300) return;
  const msg = data?.message || data?.error || JSON.stringify(data);
  throw new Error(`Supabase error (${status}) in ${context}: ${msg}`);
}

// ─── Room code ────────────────────────────────────────────────
async function getUniqueCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let t = 0; t < 20; t++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const res = await sbReq(`/game_rooms?room_code=eq.${code}&status=in.(lobby,active)&select=room_code`);
    // If table missing Supabase returns 404/error — still safe to use the code
    if (!Array.isArray(res.data) || res.data.length === 0) return code;
  }
  throw new Error('Could not generate unique room code');
}

// ─── iTunes preview lookup (free, no auth) ────────────────────
async function getItunesPreview(artist, song) {
  try {
    const query = encodeURIComponent(`${artist} ${song}`);
    const { data } = await httpsReq({
      hostname: 'itunes.apple.com',
      path: `/search?term=${query}&media=music&entity=song&limit=10`,
      method: 'GET',
      headers: { 'User-Agent': 'TriviaApp/1.0' },
    }, null);

    if (!Array.isArray(data?.results)) return null;
    const artistLower = artist.toLowerCase();
    const match =
      data.results.find(r => r.previewUrl && r.artistName.toLowerCase().includes(artistLower.split(' ')[0])) ||
      data.results.find(r => r.previewUrl);
    return match?.previewUrl || null;
  } catch {
    return null;
  }
}

// ─── Delay helper ────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

// ─── Fetch recently used question texts to avoid repeats ─────
async function getRecentQuestions() {
  try {
    const res = await sbReq('/game_rooms?select=questions&order=created_at.desc&limit=8');
    if (!Array.isArray(res.data)) return [];
    return res.data.flatMap(row => {
      const qs = Array.isArray(row.questions) ? row.questions : [];
      return qs.map(q => q.q).filter(Boolean);
    });
  } catch {
    return [];
  }
}

// ─── Question generation ─────────────────────────────────────
async function generateQuestions(categories, total, difficulty = 'mixed') {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY env var');

  const musicCats   = categories.filter(isMusicCat);
  const generalCats = categories.filter(c => !isMusicCat(c));

  let fmt = '';
  if (musicCats.length > 0 && generalCats.length > 0) {
    fmt = `
For MUSIC categories (${musicCats.join(', ')}), use this format — "artist" and "song" are required:
{"type":"music","artist":"Artist Name","song":"Song Title","year":1999,"q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}
Alternate "q" randomly between "Who is this artist?" and "What is this song?".

For all other categories (${generalCats.join(', ')}):
{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}`;
  } else if (musicCats.length > 0) {
    fmt = `
All questions are music questions:
{"type":"music","artist":"Artist Name","song":"Song Title","year":1999,"q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}
Alternate "q" randomly between "Who is this artist?" and "What is this song?".`;
  } else {
    fmt = `{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}`;
  }

  const difficultyInstructions = {
    easy:  'Difficulty: EASY — use well-known mainstream facts that most adults would recognise. Avoid niche or obscure details.',
    mixed: 'Difficulty: MIXED — balance roughly half straightforward questions with half that require a bit more knowledge.',
    hard:  'Difficulty: HARD — use specific, less-obvious facts. Avoid questions with obvious answers. Distractors should be plausible.',
  };
  const difficultyLine = difficultyInstructions[difficulty] || difficultyInstructions.mixed;

  const recentQs = await getRecentQuestions();
  const avoidBlock = recentQs.length > 0
    ? `\nDo NOT repeat any of these recently used questions:\n${recentQs.map(q => `- ${q}`).join('\n')}\n`
    : '';

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Generate exactly ${total} pub quiz questions spread evenly across: ${categories.join(', ')}.
${fmt}
${difficultyLine}${avoidBlock}
Rules: "ans" is the 0-based index of the correct answer. For music, use only widely-known popular songs. Every question must be unique — no duplicates within this set. Return ONLY a valid JSON array, no markdown, no extra text.`,
    }],
  });

  const anthropicOpts = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': String(Buffer.byteLength(body)),
    },
  };

  let result;
  for (let attempt = 1; attempt <= 4; attempt++) {
    result = await httpsReq(anthropicOpts, body);
    if (result.status !== 529) break;
    // 529 = API overloaded — wait and retry
    const wait = attempt * 3000;
    console.log(`[rooms] Anthropic overloaded, retrying in ${wait / 1000}s (attempt ${attempt}/4)`);
    await delay(wait);
  }

  if (result.status !== 200 || !result.data.content) {
    throw new Error(`Anthropic error (${result.status}): ${result.data.error?.message || JSON.stringify(result.data)}`);
  }

  const text = result.data.content[0].text.trim()
    .replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/```$/, '').trim();
  return JSON.parse(text);
}

// ─── iTunes enrichment — all lookups in parallel ──────────────
async function enrichWithPreviews(questions) {
  return Promise.all(questions.map(async q => {
    if (q.type !== 'music' || !q.artist || !q.song) return q;
    const preview_url = await getItunesPreview(q.artist, q.song);
    return { ...q, preview_url };
  }));
}

// ─── Handler ─────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'code required' });
    const result = await sbReq(`/game_rooms?room_code=eq.${code.toUpperCase()}&select=*`);
    if (!Array.isArray(result.data) || result.data.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    return res.status(200).json(result.data[0]);
  }

  if (req.method === 'POST') {
    let raw = '';
    req.on('data', c => raw += c);
    await new Promise(r => req.on('end', r));

    let cfg = {};
    try { cfg = JSON.parse(raw || '{}'); } catch { /* use defaults */ }

    const rounds     = cfg.rounds     || 3;
    const timer      = cfg.timer      || 15;
    const preset     = cfg.preset     || 'mixed';
    const difficulty = cfg.difficulty || 'mixed';
    const categories = Array.isArray(cfg.categories) && cfg.categories.length > 0
      ? cfg.categories
      : (PRESETS[preset] || PRESETS.mixed).categories;
    const total      = rounds * 5;

    try {
      const catLabel = cfg.categories ? cfg.categories.join(',') : preset;
      console.log(`[rooms] Creating room: categories=${catLabel} rounds=${rounds} timer=${timer} difficulty=${difficulty}`);

      const [roomCode, rawQuestions] = await Promise.all([
        getUniqueCode(),
        generateQuestions(categories, total, difficulty),
      ]);
      console.log(`[rooms] Generated ${rawQuestions.length} questions, code=${roomCode}`);

      const questions = await enrichWithPreviews(rawQuestions);
      const musicCount = questions.filter(q => q.preview_url).length;
      console.log(`[rooms] iTunes enrichment done — ${musicCount} clips found`);

      const insertRes = await sbReq('/game_rooms', 'POST', {
        room_code: roomCode,
        status: 'lobby',
        current_question_index: 0,
        config: { rounds, timer, preset, difficulty, categories },
        questions,
      });

      assertSb(insertRes, 'insert game_rooms');
      console.log(`[rooms] Room created: ${roomCode}`);
      return res.status(200).json(insertRes.data[0]);

    } catch (e) {
      console.error('[rooms] Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
