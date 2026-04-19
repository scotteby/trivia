import fetch from 'node-fetch';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const DATE_STR = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY environment variable' });
  }

  let anthropicResponse;
  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Generate 5 trivia questions for ${DATE_STR}. Return ONLY valid JSON, no other text, no markdown backticks:
[
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 0, "cat": "Category" },
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 2, "cat": "Category" },
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 1, "cat": "Category" },
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 3, "cat": "Category" },
  { "q": "question text", "opts": ["A", "B", "C", "D"], "ans": 0, "cat": "Category" }
]
Mix categories: Science, History, Geography, Art, Pop Culture.`
        }]
      })
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to reach Anthropic API', detail: e.message });
  }

  const json = await anthropicResponse.json();

  if (!anthropicResponse.ok || json.error || !json.content) {
    return res.status(500).json({
      error: 'Anthropic API returned an error',
      detail: json.error?.message || JSON.stringify(json)
    });
  }

  let questions;
  try {
    const text = json.content[0].text.trim();
    const cleaned = text
      .replace(/^```json\n?/, '')
      .replace(/^```\n?/, '')
      .replace(/```$/, '')
      .trim();
    questions = JSON.parse(cleaned);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to parse questions JSON', detail: e.message });
  }

  return res.status(200).json({ questions });
}
