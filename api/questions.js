export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const DATE_STR = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,  // ← safe, server-side only
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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
Mix categories across: Science, History, Geography, Art, Pop Culture.`
        }]
      })
    });

    const json = await response.json();
    const questions = JSON.parse(json.content[0].text);
    res.status(200).json({ questions });
  } catch (e) {
    console.error('Question generation error:', e);
    res.status(500).json({ error: e.message });
  }
}
