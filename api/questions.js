const https = require('https');

const MUSIC_CATS = new Set([
  'music', '80s hits', '80s music', '90s pop', '90s music', 'current hits',
  '60s & 70s classics', '2000s bangers', 'classic rock', 'hip hop', 'r&b & soul', 'country',
  'music — all eras',
]);
const isMusicCat = c => MUSIC_CATS.has(c.toLowerCase().trim());

// iTunes search terms per music category — shuffled and retried on low preview counts
const CAT_SEARCH_TERMS = {
  'music':              ['greatest hits', 'classic songs', 'pop hits', 'top songs ever'],
  'music — all eras':   ['greatest hits', 'classic songs', 'pop hits', 'top songs ever'],
  '80s hits':           ['80s pop hits', '80s rock', '80s dance music', '1980s top songs'],
  '80s music':          ['80s pop hits', '80s rock', '80s dance music', '1980s top songs'],
  '90s pop':            ['90s pop', '90s hits', '1990s pop music', '90s dance pop'],
  '90s music':          ['90s pop', '90s hits', '1990s pop music', '90s dance pop'],
  'current hits':       ['2023 pop hits', '2024 top songs', 'current pop', 'recent hits'],
  '60s & 70s classics': ['60s pop classics', '70s rock hits', '1960s music', '1970s hits'],
  '2000s bangers':      ['2000s pop', '2000s hits', 'early 2000s music', 'y2k pop'],
  'classic rock':       ['classic rock hits', '70s rock', '80s rock anthems', 'rock classics'],
  'hip hop':            ['90s hip hop', '2000s rap hits', 'classic hip hop', 'rap hits'],
  'r&b & soul':         ['soul music', 'classic r&b', '90s r&b', 'modern r&b hits'],
  'country':            ['country hits', 'country pop', 'classic country', 'modern country'],
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

// ─── iTunes: fetch raw results for one search term ───────────────────────────
function fetchItunesTracks(term, offset, attribute = null) {
  const query = encodeURIComponent(term);
  const attrParam = attribute ? `&attribute=${attribute}` : '';
  return new Promise(resolve => {
    try {
      const req = https.request({
        hostname: 'itunes.apple.com',
        path: `/search?term=${query}&media=music&entity=song&limit=50&offset=${offset}${attrParam}`,
        method: 'GET',
        headers: { 'User-Agent': 'TriviaApp/1.0' },
      }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            resolve((JSON.parse(raw)?.results || []).filter(
              r => r.previewUrl && r.artistName && r.trackName
            ));
          } catch { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.end();
    } catch { resolve([]); }
  });
}

// ─── iTunes: search by category, retry on low results, filter used tracks ────
// musicType: 'genre' | 'artist' | 'soundtrack'
async function searchItunesTracks(category, usedTracks = new Set(), musicType = 'genre') {
  let terms, attribute = null;

  if (musicType === 'artist') {
    terms = [category];        // search for the artist by name
    attribute = 'artistTerm';
  } else if (musicType === 'soundtrack') {
    terms = [category];        // search for the album/soundtrack by name
    attribute = 'albumTerm';
  } else {
    terms = CAT_SEARCH_TERMS[category.toLowerCase().trim()] || CAT_SEARCH_TERMS['music'];
  }

  // Shuffle genre terms for variety; artist/soundtrack have only one term
  const ordered = musicType === 'genre' ? [...terms].sort(() => Math.random() - 0.5) : terms;

  for (const term of ordered) {
    // Use a smaller offset for artist/soundtrack so we don't skip past all tracks
    const offset = musicType === 'genre'
      ? Math.floor(Math.random() * 151)
      : Math.floor(Math.random() * 10);
    const results = await fetchItunesTracks(term, offset, attribute);
    const fresh = results.filter(r => !usedTracks.has(`${r.artistName}|${r.trackName}`));
    if (musicType === 'genre') {
      if (fresh.length >= 5) return fresh;
    } else {
      if (fresh.length > 0) return fresh; // accept any results for artist/soundtrack
    }
  }
  return [];
}

// ─── Generate one music question around a specific iTunes track ───────────────
// musicType: 'genre' | 'artist' | 'soundtrack'
async function generateMusicQuestion(track, category, explain, musicType = 'genre') {
  const artist = track.artistName;
  const song = track.trackName;
  const year = track.releaseDate ? new Date(track.releaseDate).getFullYear() : null;
  const album = track.collectionName || null;

  // Artist categories: asking "Who is this artist?" gives away the answer since
  // the category name IS the artist. Prefer song/year/album instead.
  let questionTypes;
  if (musicType === 'artist') {
    questionTypes = ['song'];
    if (year) questionTypes.push('year');
    if (album) questionTypes.push('album');
  } else {
    questionTypes = ['artist', 'song'];
    if (year) questionTypes.push('year');
  }
  const qType = questionTypes[Math.floor(Math.random() * questionTypes.length)];

  let qText, correctAnswer;
  if (qType === 'artist') {
    qText = 'Who is this artist?';
    correctAnswer = artist;
  } else if (qType === 'song') {
    qText = 'What is this song called?';
    correctAnswer = song;
  } else if (qType === 'year') {
    qText = 'What year was this released?';
    correctAnswer = String(year);
  } else {
    qText = 'What album is this song from?';
    correctAnswer = album;
  }

  const explainInstruction = explain
    ? ' Include an "explanation" field: one concise sentence explaining why the answer is correct.'
    : '';

  // Type-specific context and distractor instructions
  let contextLine = '';
  let distractorGuide = '';

  if (musicType === 'artist') {
    contextLine = `This is a question about a song by ${artist}.`;
    distractorGuide = `Write 3 plausible but wrong distractors drawn specifically from ${artist}'s catalog:
- "What is this song called?" → other real ${artist} song titles from their discography
- "What year was this released?" → other years when ${artist} released music (within ~5 years)
- "What album is this song from?" → other real ${artist} album names`;
  } else if (musicType === 'soundtrack') {
    contextLine = `This track is from the "${category}" soundtrack.`;
    distractorGuide = `Write 3 plausible but wrong distractors relevant to "${category}":
- "What is this song called?" → other plausible song names from the ${category} soundtrack or similar musicals/films
- "What year was this released?" → nearby years within 4 years
- "Who is this artist?" → other artists associated with soundtracks`;
  } else {
    distractorGuide = `Write 3 plausible but wrong distractors:
- "Who is this artist?" → other real artists from a similar era/genre
- "What is this song called?" → other plausible song titles (real or believable)
- "What year was this released?" → nearby years within 4 years of ${year}`;
  }

  const albumLine = qType === 'album' ? `\nAlbum: "${album}"` : '';
  const prompt = `You are writing one music trivia question for a pub quiz.
${contextLine}
Track: "${song}" by ${artist}${year ? ` (${year})` : ''}${albumLine}
Question: "${qText}"
Correct answer: "${correctAnswer}"

${distractorGuide}

Return ONLY a JSON object, no markdown, no extra text.${explainInstruction}
Randomise the correct answer's position among the 4 opts and set "ans" to its 0-based index.
Format: {"type":"music","artist":"${artist}","song":"${song}","year":${year ?? null},"q":"${qText}","opts":["...","...","...","..."],"ans":N,"cat":"${category}"${explain ? ',"explanation":"..."' : ''}}`;

  const json = await callAnthropic({
    model: 'claude-sonnet-4-6',
    max_tokens: 350,
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
// customCatsMeta: { [catName]: { musicType: 'genre'|'artist'|'soundtrack' } }
async function generateMusicQuestions(musicCats, perCat, explain, customCatsMeta = {}) {
  const usedTracks = new Set();
  const trackAssignments = [];

  // Pick tracks sequentially so usedTracks stays consistent
  for (const cat of musicCats) {
    try {
      const musicType = customCatsMeta[cat]?.musicType || 'genre';
      const results = await searchItunesTracks(cat, usedTracks, musicType);
      const chosen = results.slice(0, perCat);
      for (const track of chosen) {
        usedTracks.add(`${track.artistName}|${track.trackName}`);
        trackAssignments.push({ track, cat, musicType });
      }
    } catch { /* skip this cat */ }
  }

  // Generate all questions in parallel now that tracks are locked in
  const questions = await Promise.all(
    trackAssignments.map(({ track, cat, musicType }) =>
      generateMusicQuestion(track, cat, explain, musicType).catch(() => null)
    )
  );
  return questions.filter(Boolean);
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
        musicQuestions = await generateMusicQuestions(musicCats, perCat, explain, customCatsMeta);
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
        const tracks = await searchItunesTracks('music', new Set());
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
