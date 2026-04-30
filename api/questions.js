const https = require('https');

const MUSIC_CATS = new Set([
  'music', '80s hits', '80s music', '90s pop', '90s music', '90s rock', 'current hits',
  '60s & 70s classics', '2000s bangers', 'classic rock', 'hip hop', 'r&b & soul', 'country',
  'music — all eras',
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

function getWikimediaImageUrl(filename) {
  return new Promise(resolve => {
    try {
      const encoded = encodeURIComponent(filename.trim());
      const req = https.request({
        hostname: 'en.wikipedia.org',
        path: `/w/api.php?action=query&titles=File:${encoded}&prop=imageinfo&iiprop=url&format=json`,
        method: 'GET',
        headers: { 'User-Agent': 'QuizzliApp/1.0 (quizzli.app)' },
      }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            const pages = data?.query?.pages;
            if (!pages) return resolve(null);
            const page = Object.values(pages)[0];
            const url = page?.imageinfo?.[0]?.url;
            resolve(url || null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    } catch { resolve(null); }
  });
}

async function enrichWithImages(questions) {
  return Promise.all(questions.map(async q => {
    if (q.type !== 'image' || !q.image_file) return q;
    const image_url = await getWikimediaImageUrl(q.image_file);
    if (!image_url) return { ...q, type: 'general', image_url: null };
    return { ...q, image_url };
  }));
}

const SUPABASE_URL = 'https://hfyanydnihumfcsgsxzf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmeWFueWRuaWh1bWZjc2dzeHpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDI5MTIsImV4cCI6MjA5MjExODkxMn0.LimVOp7XksHiCSxAA_Bil7ruw8Vm0YRdOvuOQy03Gdc';

function sbGet(path) {
  return new Promise(resolve => {
    try {
      const req = https.request({
        hostname: SUPABASE_URL.replace('https://', ''),
        path: `/rest/v1${path}`,
        method: 'GET',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.end();
    } catch { resolve([]); }
  });
}

function sbPost(path, body) {
  return new Promise(resolve => {
    try {
      const bodyStr = JSON.stringify(body);
      const req = https.request({
        hostname: SUPABASE_URL.replace('https://', ''),
        path: `/rest/v1${path}`,
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(bodyStr)),
          'Prefer': 'return=minimal',
        },
      }, res => {
        res.on('data', () => {});
        res.on('end', () => resolve(true));
      });
      req.on('error', () => resolve(false));
      req.write(bodyStr);
      req.end();
    } catch { resolve(false); }
  });
}

async function getPlayedSongs() {
  try {
    const data = await sbGet('/played_songs?select=artist,song&order=played_at.desc&limit=2000&played_at=gte.' + new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
    if (!Array.isArray(data)) return [];
    return data.map(r => `${r.artist} - ${r.song}`);
  } catch {
    return [];
  }
}

async function savePlayedSongs(questions) {
  try {
    const musicQs = questions.filter(q => q.type === 'music' && q.artist && q.song);
    if (!musicQs.length) return;
    const rows = musicQs.map(q => ({ artist: q.artist, song: q.song }));
    await sbPost('/played_songs', rows);
  } catch(e) {}
}

async function getPlayedQuestions() {
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const data = await sbGet(`/played_questions?select=question&order=played_at.desc&limit=500&played_at=gte.${cutoff}`);
    if (!Array.isArray(data)) return [];
    return data.map(r => r.question);
  } catch {
    return [];
  }
}

async function savePlayedQuestions(questions) {
  try {
    const qs = questions.filter(q => q.q && (q.type === 'general' || q.type === 'image'));
    if (!qs.length) return;
    const rows = qs.map(q => ({ question: q.q, type: q.type }));
    await sbPost('/played_questions', rows);
  } catch(e) {}
}

function getMusicConstraint(category) {
  const cat = category.toLowerCase();

  // Categories that already imply a specific era — don't add a decade constraint
  const eraSpecific = [
    '60s', '70s', '80s', '90s', '2000s', '2010s',
    'current', 'classic rock', 'hip hop', 'r&b', 'country',
  ];
  const hasEra = eraSpecific.some(e => cat.includes(e));

  const decades = ['1965-1972','1973-1979','1980-1985','1986-1989','1990-1994','1995-1999','2000-2004','2005-2009','2010-2015','2016-2021'];
  const tiers = [
    'Avoid the 20 most famous songs. Pick album tracks or deep cuts true fans would know.',
    'Pick songs that reached #1 on the charts but are now slightly forgotten.',
    'Focus on one-hit wonders or artists who peaked quickly.',
    'Pick songs from the middle of the artist\'s career, not their most famous hits.',
    'Focus on songs that were massive hits in their era but rarely appear in trivia today.',
  ];
  const regions = [
    'Focus on UK artists.',
    'Focus on Australian or Canadian artists.',
    'Focus on American artists outside New York or LA.',
    'Focus on Motown artists.',
    'Focus on artists who got their start in the 80s but peaked in the 90s.',
  ];

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  if (hasEra) {
    // Era already defined by category — only add variety via tier or region
    return pick([pick(tiers), pick(regions)]);
  }

  // Broad category — all constraint types are fair game
  const constraints = [
    `Focus on songs from ${pick(decades)}.`,
    pick(tiers),
    pick(regions),
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
    const avoidSongs = avoidList.filter(s => s.includes(' - '));
    const avoidQuestions = avoidList.filter(s => !s.includes(' - '));
    const playedSongs = await getPlayedSongs();
    const playedQuestions = await getPlayedQuestions();
    const allAvoidSongs = [...new Set([...playedSongs, ...avoidSongs])];
    const avoidSongBlock = allAvoidSongs.length > 0
      ? `Do NOT use any of these artist-song combinations:\n${allAvoidSongs.map(s => `- ${s}`).join('\n')}`
      : '';
    const avoidQBlock = playedQuestions.length > 0
      ? `\nDo NOT repeat or closely resemble any of these recently used questions:\n${playedQuestions.map(q => `- ${q}`).join('\n')}\n`
      : avoidQuestions.length > 0
        ? `\nDo NOT repeat or closely resemble any of these already-asked questions:\n${avoidQuestions.map(q => `- ${q}`).join('\n')}\n`
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
    const imageCats   = cats.filter(c => !isMusicCatEx(c) && isImageCat(c));
    const generalCats = cats.filter(c => !isMusicCatEx(c) && !isImageCat(c));

    const kidsCats = cats.filter(isKidsCat);
    const kidsLine = kidsCats.length > 0
      ? `\nFor KIDS categories (${kidsCats.join(', ')}): questions must be appropriate for children aged 6-12. Use simple language, fun topics, and well-known characters or facts. Avoid anything scary, violent, or adult. Wrong answer options should also be child-friendly and recognisable. Keep questions short and clear.`
      : '';
    const effectiveDifficultyLine = kidsCats.length > 0
      ? 'Difficulty: EASY — use well-known mainstream facts that children aged 6-12 would know.'
      : difficultyLine;
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
{"type":"music","artist":"Artist Name","song":"Song Title","q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField}}
Alternate "q" randomly between: "Who is this artist?" and "What is this song called?"
Music constraint (follow strictly): ${getMusicConstraint(genreMusicCats[0] || 'music')}
Session seed (ignore): ${Date.now()}-${Math.random()}${avoidSongBlock ? '\n' + avoidSongBlock : ''}`);
    }
    if (artistTypeCats.length > 0) {
      fmtParts.push(`For artist categories (${artistTypeCats.join(', ')}): the category IS the artist — NEVER ask "Who is this artist?". Only use: "What is this song called?". Wrong answer options must be other songs by the same artist.
{"type":"music","artist":"[exact artist name]","song":"Song Title","q":"What is this song called?","opts":["Song A","Song B","Song C","Song D"],"ans":0,"cat":"[artist name]"${explainField}}`);
    }
    if (imageCats.length > 0) {
      fmtParts.push(`For image categories (${imageCats.join(', ')}):
{"type":"image","image_file":"Exact_Wikimedia_Commons_filename.jpg","q":"What is this?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField ? explainField : ''},"hint":"Brief description"}

IMAGE CATEGORY RULES — follow strictly:
- "image_file" must be the EXACT filename as it appears on Wikimedia Commons (case-sensitive, include extension)
- For FLAGS: use format "Flag_of_[Country].svg" e.g. "Flag_of_Japan.svg", "Flag_of_Brazil.svg"
- For LANDMARKS: use well-known Wikipedia image filenames e.g. "Eiffel_Tower_7_Floors_Below.jpg"
- For ART & PAINTINGS: use exact Wikimedia filenames e.g. "Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg"
- For FAMOUS PEOPLE: use Wikipedia portrait filenames e.g. "Albert_Einstein_Head.jpg", "Barack_Obama.jpg". Question format: "Who is this person?" or "What is this person famous for?" with 4 plausible name options.
- For ANIMALS: use Wikimedia nature photography filenames e.g. "Proboscis_Monkey_in_Borneo.jpg". Question format: "What animal is this?" or "What species is this?" with 4 plausible animal options.
- Only use images you are CERTAIN exist on Wikimedia Commons
- Wrong answer options must be plausible alternatives in the same category`);
    }

    try {
      const json = await callAnthropic({
        model: 'claude-sonnet-4-6',
        max_tokens: Math.min(totalCount * 220 + 500, 4000),
        messages: [{
          role: 'user',
          content: `Generate exactly ${totalCount} practice trivia questions: ${perCat} per category, in this order: ${cats.map(c => `"${c}"`).join(', ')}.
${fmtParts.join('\n\n')}
${effectiveDifficultyLine}${kidsLine}${avoidQBlock}
For general questions: avoid obvious textbook questions, capitals of countries, and questions that appear on every trivia app. Pick interesting, specific, and unexpected angles on each topic. Seed: ${Math.random().toString(36).slice(2)}
Rules: "ans" is the 0-based index of the correct answer. Every question must be completely unique. Return ONLY a valid JSON array, no markdown, no extra text.`,
        }],
      });

      let questions = parseQuestions(json);
      questions = await enrichWithPreviews(questions);
      questions = await enrichWithImages(questions);
      await savePlayedSongs(questions);
      await savePlayedQuestions(questions);
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
        content: `Generate exactly 5 trivia questions for ${DATE_STR}: 3 general, 1 music, and 1 image question, mixed in any order.

For general questions:
{"type":"general","q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"}
Mix categories: Science, History, Geography, Pop Culture, Sports.

For the music question:
{"type":"music","artist":"Artist Name","song":"Song Title","q":"Who is this artist?","opts":["A","B","C","D"],"ans":0,"cat":"Music"}
Alternate "q" randomly between: "Who is this artist?" and "What is this song called?"
Music constraint (follow strictly): ${getMusicConstraint('music')}
Session seed (ignore): ${Date.now()}-${Math.random()}

For the image question — pick one of: Flags, Landmarks, Art & Paintings, Famous people, or Animals:
{"type":"image","image_file":"Exact_Wikimedia_Commons_filename.jpg","q":"Which country's flag is this?","opts":["A","B","C","D"],"ans":0,"cat":"Images"}
Use EXACT Wikimedia Commons filenames. For flags: "Flag_of_[Country].svg". For landmarks: exact Wikipedia image filenames. For art: exact Wikimedia filenames.
Only use images you are CERTAIN exist on Wikimedia Commons.

For general questions: avoid obvious textbook questions, capitals of countries, and questions that appear on every trivia app. Pick interesting, specific, and unexpected angles on each topic. Seed: ${Math.random().toString(36).slice(2)}
Rules: "ans" is the 0-based index of the correct answer. Return ONLY a valid JSON array of exactly 5 questions, no markdown, no extra text.`,
      }],
    });

    let questions = parseQuestions(json);
    questions = await enrichWithPreviews(questions);
    questions = await enrichWithImages(questions);
    await savePlayedSongs(questions);
    await savePlayedQuestions(questions);
    return res.status(200).json({ questions });
  } catch(e) {
    return res.status(500).json({ error: 'Handler failed', detail: e.message });
  }
};
