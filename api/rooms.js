const https = require('https');

const SUPABASE_URL = 'https://hfyanydnihumfcsgsxzf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmeWFueWRuaWh1bWZjc2dzeHpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDI5MTIsImV4cCI6MjA5MjExODkxMn0.LimVOp7XksHiCSxAA_Bil7ruw8Vm0YRdOvuOQy03Gdc';

const PRESETS = {
  mixed:    { categories: ['General knowledge', 'History', 'Sports', 'Pop culture', 'Science'] },
  music:    { categories: ['80s hits', '90s pop', 'Current hits'] },
  sports:   { categories: ['Sports', 'General knowledge', 'Pop culture'] },
  brainiac: { categories: ['Science', 'History', 'Geography'] },
  musicmix: { categories: ['General knowledge', '90s music', 'Pop culture'] },
  kids:     { categories: ['Disney & Pixar', 'Animals & nature', 'Cartoons & animation', 'Books & stories', 'Science & space'] },
  pictures: { categories: ['Flags', 'Landmarks', 'Art & Paintings', 'Famous people', 'Images'] },
};

const MUSIC_CATS = new Set([
  'music', '80s hits', '80s music', '90s pop', '90s music', 'current hits',
  '60s & 70s classics', '2000s bangers', 'classic rock', 'hip hop', 'r&b & soul', 'country',
]);
const isMusicCat = c => MUSIC_CATS.has(c.toLowerCase().trim());

const IMAGE_CATS = new Set(['images', 'flags', 'landmarks', 'art & paintings', 'famous people', 'animals']);
const isImageCat = c => IMAGE_CATS.has(c.toLowerCase().trim());

const KIDS_CATS = new Set([
  'kids', 'children', 'disney & pixar', 'animals & nature',
  'cartoons & animation', 'books & stories', 'sports for kids',
  'science & space', 'food & holidays',
]);
const isKidsCat = c => KIDS_CATS.has(c.toLowerCase().trim());

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
async function getUniqueCode(preferred = null) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  if (preferred && /^[A-Z]{4,6}$/.test(preferred)) {
    const res = await sbReq(`/game_rooms?room_code=eq.${preferred}&status=in.(lobby,active)&select=room_code`);
    if (!Array.isArray(res.data) || res.data.length === 0) return preferred;
    console.log(`[rooms] Preferred code ${preferred} is currently active, generating new code`);
  }

  for (let t = 0; t < 20; t++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const res = await sbReq(`/game_rooms?room_code=eq.${code}&status=in.(lobby,active)&select=room_code`);
    if (!Array.isArray(res.data) || res.data.length === 0) return code;
  }
  throw new Error('Could not generate unique room code');
}

// ─── Wikimedia Commons image URL resolver ────────────────────
async function getWikimediaImageUrl(filename) {
  try {
    const encoded = encodeURIComponent(filename.trim());
    const { data } = await httpsReq({
      hostname: 'en.wikipedia.org',
      path: `/w/api.php?action=query&titles=File:${encoded}&prop=imageinfo&iiprop=url&format=json`,
      method: 'GET',
      headers: { 'User-Agent': 'QuizzliApp/1.0 (quizzli.app)' },
    }, null);
    const pages = data?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    const url = page?.imageinfo?.[0]?.url;
    return url || null;
  } catch {
    return null;
  }
}

async function enrichWithImages(questions) {
  return Promise.all(questions.map(async q => {
    if (q.type !== 'image' || !q.image_file) return q;
    const image_url = await getWikimediaImageUrl(q.image_file);
    if (!image_url) return { ...q, type: 'general', image_url: null };
    return { ...q, image_url };
  }));
}

// ─── iTunes preview lookup (free, no auth) ────────────────────
async function getItunesPreview(artist, song) {
  try {
    const query = encodeURIComponent(`${artist} ${song}`);
    const { data } = await httpsReq({
      hostname: 'itunes.apple.com',
      path: `/search?term=${query}&media=music&entity=song&limit=10`,
      method: 'GET',
      headers: { 'User-Agent': 'QuizzliApp/1.0' },
    }, null);

    if (!Array.isArray(data?.results)) return null;
    const withPreviews = data.results.filter(r => r.previewUrl);
    if (!withPreviews.length) return null;
    const artistFirst = artist.toLowerCase().split(' ')[0];
    const songFirst = song.toLowerCase().split(' ')[0];
    const scored = withPreviews.map(r => {
      let score = 0;
      if (r.artistName?.toLowerCase().includes(artistFirst)) score += 2;
      if (r.trackName?.toLowerCase().includes(songFirst)) score += 2;
      return { url: r.previewUrl, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].score > 0 ? scored[0].url : null;
  } catch {
    return null;
  }
}

// ─── Delay helper ────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));

// ─── Persistent song deduplication via played_songs table ────
async function getPlayedSongs() {
  try {
    const res = await sbReq('/played_songs?select=artist,song&order=played_at.desc&limit=1000');
    if (!Array.isArray(res.data)) return [];
    return res.data.map(r => `${r.artist} - ${r.song}`);
  } catch {
    return [];
  }
}

async function savePlayedSongs(questions) {
  try {
    const musicQs = questions.filter(q => q.type === 'music' && q.artist && q.song);
    if (!musicQs.length) return;
    const rows = musicQs.map(q => ({ artist: q.artist, song: q.song }));
    await sbReq('/played_songs', 'POST', rows);
    // Trim to keep only the most recent 1000 rows
    const countRes = await sbReq('/played_songs?select=id&order=played_at.desc&limit=1000');
    if (Array.isArray(countRes.data) && countRes.data.length >= 1000) {
      const oldestKept = countRes.data[countRes.data.length - 1].id;
      await sbReq(`/played_songs?played_at=lt.(select played_at from played_songs where id=eq.${oldestKept})`, 'DELETE');
    }
  } catch(e) {
    console.warn('[rooms] savePlayedSongs failed:', e.message);
  }
}

// ─── Music randomization constraint ──────────────────────────
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

// ─── Question generation ─────────────────────────────────────
async function generateQuestions(categories, total, difficulty = 'mixed', customMusicCats = [], customCatsMeta = {}, avoidSongsExtra = []) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY env var');

  const customMusicSet = new Set(customMusicCats.map(s => s.toLowerCase()));
  const isMusicCatEx = c => isMusicCat(c) || customMusicSet.has(c.toLowerCase().trim());

  const musicCats   = categories.filter(isMusicCatEx);
  const imageCats   = categories.filter(c => !isMusicCatEx(c) && isImageCat(c));
  const generalCats = categories.filter(c => !isMusicCatEx(c) && !isImageCat(c));

  const artistTypeCats = musicCats.filter(c => customCatsMeta[c]?.musicType === 'artist');
  const genreMusicCats = musicCats.filter(c => customCatsMeta[c]?.musicType !== 'artist');

  let fmt = '';
  const musicFmt = `{"type":"music","artist":"Artist Name","song":"Song Title","q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}`;
  const artistCatRules = artistTypeCats.length > 0
    ? `\nFor ARTIST categories (${artistTypeCats.join(', ')}): the category IS the artist — never ask "Who is this artist?". Only use question type: "What is this song?". Wrong answer options must be other songs by the SAME artist.`
    : '';

  const imageFmt = `{"type":"image","image_file":"Exact_Wikimedia_Commons_filename.jpg","q":"What is this?","opts":["A","B","C","D"],"ans":0,"cat":"Category","hint":"Brief description of what makes this image identifiable"}`;
  const imageRules = imageCats.length > 0 ? `\n\nFor IMAGE categories (${imageCats.join(', ')}), use this format:
${imageFmt}

IMAGE CATEGORY RULES — follow strictly:
- "image_file" must be the EXACT filename as it appears on Wikimedia Commons (case-sensitive, include extension)
- For FLAGS: use format "Flag_of_[Country].svg" e.g. "Flag_of_Japan.svg", "Flag_of_Brazil.svg"
- For LANDMARKS: use well-known Wikipedia image filenames e.g. "Eiffel_Tower_7_Floors_Below.jpg", "Colosseum_in_Rome-April_2007-1-_copie_2B.jpg"
- For ART & PAINTINGS: use exact Wikimedia filenames e.g. "Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg", "The_Starry_Night_-_Vincent_van_Gogh.jpg"
- For FAMOUS PEOPLE: use Wikipedia portrait filenames e.g. "Albert_Einstein_Head.jpg", "Barack_Obama.jpg". Question format: "Who is this person?" or "What is this person famous for?" with 4 plausible name options.
- For ANIMALS: use Wikimedia nature photography filenames e.g. "Proboscis_Monkey_in_Borneo.jpg". Question format: "What animal is this?" or "What species is this?" with 4 plausible animal options.
- Only use images you are CERTAIN exist on Wikimedia Commons
- Wrong answer options must be plausible alternatives in the same category (other countries, other landmarks, other artists)
- Questions should be "Which country's flag is this?", "What is this famous landmark?", "Who painted this?", "What is this painting called?"` : '';

  const allGeneralCats = [...generalCats, ...imageCats];

  if (musicCats.length > 0 && allGeneralCats.length > 0) {
    fmt = `
For MUSIC categories (${musicCats.join(', ')}), use this format — "artist" and "song" are required:
${musicFmt}
For genre/era music categories, alternate "q" randomly between "Who is this artist?" and "What is this song?".${artistCatRules}

For all other categories (${generalCats.join(', ')}):
{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}${imageRules}`;
  } else if (musicCats.length > 0) {
    fmt = `
All questions are music questions:
${musicFmt}
For genre/era music categories, alternate "q" randomly between "Who is this artist?" and "What is this song?".${artistCatRules}`;
  } else {
    fmt = `{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}${imageRules}`;
  }

  const difficultyInstructions = {
    easy:  'Difficulty: EASY — use well-known mainstream facts that most adults would recognise. Avoid niche or obscure details.',
    mixed: 'Difficulty: MIXED — balance roughly half straightforward questions with half that require a bit more knowledge.',
    hard:  'Difficulty: HARD — use specific, less-obvious facts. Avoid questions with obvious answers. Distractors should be plausible.',
  };
  const difficultyLine = difficultyInstructions[difficulty] || difficultyInstructions.mixed;

  const kidsCats = categories.filter(isKidsCat);
  const kidsLine = kidsCats.length > 0
    ? `\nFor KIDS categories (${kidsCats.join(', ')}): questions must be appropriate for children aged 6-12. Use simple language, fun topics, and well-known characters or facts. Avoid anything scary, violent, or adult. Wrong answer options should also be child-friendly and recognisable. Keep questions short and clear.`
    : '';
  const effectiveDifficultyLine = kidsCats.length > 0
    ? 'Difficulty: EASY — use well-known mainstream facts that children aged 6-12 would know.'
    : difficultyLine;

  const playedSongs = await getPlayedSongs();
  const allAvoidSongs = [...new Set([...playedSongs, ...avoidSongsExtra])];
  const avoidQBlock = '';
  const avoidSongBlock = allAvoidSongs.length > 0
    ? `\nDo NOT use any of these artist-song combinations — these have all been used recently:\n${allAvoidSongs.map(s => `- ${s}`).join('\n')}\n`
    : '';

  // Inject song avoid block and constraint into music format section
  if (musicCats.length > 0) {
    fmt += `\nMusic constraint (follow strictly): ${getMusicConstraint(musicCats[0] || 'music')}`;
    fmt += `\nSession seed (ignore): ${Date.now()}-${Math.random()}`;
    if (avoidSongBlock) fmt += avoidSongBlock;
  }

  const basePerCat = Math.floor(total / categories.length);
  const remainder = total % categories.length;
  const perCatCounts = categories.map((_, i) => i < remainder ? basePerCat + 1 : basePerCat);

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Generate exactly ${total} pub quiz questions: ${categories.map((c, i) => `${perCatCounts[i]} questions for "${c}"`).join(', then ')}, in this exact order: ${categories.map((c, i) => `[${perCatCounts[i]} questions for "${c}"]`).join(', then ')}.
IMPORTANT: Output ALL questions for the first category first, then ALL questions for the second category, and so on. Do NOT interleave categories.
${fmt}
${effectiveDifficultyLine}${kidsLine}${avoidQBlock}
For general questions: avoid obvious textbook questions, capitals of countries, and questions that appear on every trivia app. Pick interesting, specific, and unexpected angles on each topic. Seed: ${Math.random().toString(36).slice(2)}
Rules: "ans" is the 0-based index of the correct answer. Every question must be unique. Return ONLY a valid JSON array, no markdown, no extra text.`,
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

    const rounds          = cfg.rounds     || 3;
    const timer           = cfg.timer      || 15;
    const preset          = cfg.preset     || 'mixed';
    const difficulty      = cfg.difficulty || 'mixed';
    const categories      = Array.isArray(cfg.categories) && cfg.categories.length > 0
      ? cfg.categories
      : (PRESETS[preset] || PRESETS.mixed).categories;
    const customMusicCats    = Array.isArray(cfg.customMusicCats) ? cfg.customMusicCats : [];
    const customCatsMeta     = (cfg.customCatsMeta && typeof cfg.customCatsMeta === 'object') ? cfg.customCatsMeta : {};
    const avoidSongsFromClient = cfg.avoidSongs ? cfg.avoidSongs.split('||').filter(Boolean) : [];
    const total              = rounds * 5;

    try {
      const catLabel = cfg.categories ? cfg.categories.join(',') : preset;
      console.log(`[rooms] ${req.query?.questionsOnly ? 'Regenerating questions' : 'Creating room'}: categories=${catLabel} rounds=${rounds} timer=${timer} difficulty=${difficulty}`);

      // questionsOnly mode: generate fresh questions without creating a room
      // (used by "Play again" to keep the same room code)
      if (req.query?.questionsOnly === 'true') {
        const rawQuestions = await generateQuestions(categories, total, difficulty, customMusicCats, customCatsMeta, avoidSongsFromClient);
        let questions = await enrichWithPreviews(rawQuestions);
        questions = await enrichWithImages(questions);
        await savePlayedSongs(questions);
        console.log(`[rooms] Regenerated ${questions.length} questions`);
        return res.status(200).json({ questions });
      }

      const preferredCode = cfg.preferredCode ? cfg.preferredCode.toUpperCase().trim() : null;

      const [roomCode, rawQuestions] = await Promise.all([
        getUniqueCode(preferredCode),
        generateQuestions(categories, total, difficulty, customMusicCats, customCatsMeta, avoidSongsFromClient),
      ]);
      console.log(`[rooms] Generated ${rawQuestions.length} questions, code=${roomCode}`);

      let questions = await enrichWithPreviews(rawQuestions);
      questions = await enrichWithImages(questions);
      await savePlayedSongs(questions);
      const musicCount = questions.filter(q => q.preview_url).length;
      const imageCount = questions.filter(q => q.image_url).length;
      console.log(`[rooms] Enrichment done — ${musicCount} music clips, ${imageCount} images`);

      const existingRes = await sbReq(`/game_rooms?room_code=eq.${roomCode}&select=id,status`);
      const existing = Array.isArray(existingRes.data) && existingRes.data.length > 0 ? existingRes.data[0] : null;

      let roomRes;
      if (existing) {
        await sbReq(`/players?room_id=eq.${existing.id}`, 'DELETE');
        roomRes = await sbReq(
          `/game_rooms?id=eq.${existing.id}`,
          'PATCH',
          {
            status: 'lobby',
            current_question_index: 0,
            question_start_time: null,
            config: { rounds, timer, preset, difficulty, categories },
            questions,
          }
        );
        assertSb(roomRes, 'update game_rooms');
        console.log(`[rooms] Room reused: ${roomCode}`);
      } else {
        roomRes = await sbReq('/game_rooms', 'POST', {
          room_code: roomCode,
          status: 'lobby',
          current_question_index: 0,
          config: { rounds, timer, preset, difficulty, categories },
          questions,
        });
        assertSb(roomRes, 'insert game_rooms');
        console.log(`[rooms] Room created: ${roomCode}`);
      }

      return res.status(200).json(roomRes.data[0]);

    } catch (e) {
      console.error('[rooms] Error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
