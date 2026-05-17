const Anthropic = require('@anthropic-ai/sdk');

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

async function query(message, systemPrompt = '', history = []) {
  const messages = [
    ...history,
    { role: 'user', content: message },
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: systemPrompt || 'Tu es DALEBA, assistant IA souverain et stratégique de Kadio Ulrich.',
    messages,
  });

  return {
    model: 'claude',
    content: response.content[0].text,
    usage: response.usage,
  };
}

module.exports = { query };
