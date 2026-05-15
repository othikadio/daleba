const axios = require('axios');

async function query(message, systemPrompt = '', history = []) {
  const messages = [
    { role: 'system', content: systemPrompt || 'Tu es DALEBA, expert en analyse de données.' },
    ...history,
    { role: 'user', content: message },
  ];

  const response = await axios.post(
    'https://api.deepseek.com/chat/completions',
    {
      model: 'deepseek-chat',
      messages,
      max_tokens: 4096,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    model: 'deepseek',
    content: response.data.choices[0].message.content,
    usage: response.data.usage,
  };
}

module.exports = { query };
