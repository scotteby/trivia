const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const DATE_STR = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });
  }

  const body = JSON.stringify({
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
Mix categories: Science, History, Geography, Art, Pop Culture.`
    }]
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  try {
    const responseText = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(data));
      });
      request.on('error', reject);
      request.write(body);
      request.end();
    });

    const json = JSON.parse(responseText);

    if (json.error || !json.content) {
      return res.status(500).json({
        error: 'Anthropic API error',
        detail: json.error?.message || JSON.stringify(json)
      });
    }

    const text = json.content[0].text.trim()
      .replace(/^```json\n?/, '')
      .replace(/^```\n?/, '')
      .replace(/```$/, '')
      .trim();

    const questions = JSON.parse(text);
    return res.status(200).json({ questions });

  } catch (e) {
    return res.status(500).json({ error: 'Handler failed', detail: e.message });
  }
};
