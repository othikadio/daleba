const OpenAI = require('openai');

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

async function query(message, systemPrompt = '', history = []) {
  const messages = [
    { role: 'system', content: systemPrompt || 'Tu es DALEBA, assistant créatif et stratégique.' },
    ...history,
    { role: 'user', content: message },
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 4096,
  });

  return {
    model: 'gpt4o',
    content: response.choices[0].message.content,
    usage: response.usage,
  };
}

module.exports = { query };
