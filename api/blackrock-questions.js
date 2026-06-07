const path = require('path');
const fs = require('fs');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const filePath = path.join(process.cwd(), 'data', 'blackrock-questions.json');
    const questions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return res.status(200).json({ questions });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load questions', detail: e.message });
  }
};
