const https = require('https');

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

    const explainField = explain
      ? ',"explanation":"One concise sentence explaining why this answer is correct."'
      : '';
    const maxTokens = Math.min(explain ? count * 260 + 500 : count * 140 + 300, 4000);

    try {
      const json = await callAnthropic({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: `Generate exactly ${count} trivia questions spread evenly across: ${cats.join(', ')}.
Format each as: {"q":"Question?","opts":["A","B","C","D"],"ans":0,"cat":"Category"${explainField}}
Rules: "ans" is the 0-based index of the correct answer. Mix easy and harder questions. Questions must be unique. Return ONLY a valid JSON array, no markdown, no extra text.`,
        }],
      });
      return res.status(200).json({ questions: parseQuestions(json) });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ─── Daily solo mode (existing) ─────────────────────────────────────────────
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
