const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { OpenAI } = require('openai');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new Client(config);
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/webhook', middleware(config), async (req, res) => {
  const results = await Promise.all(req.body.events.map(handleEvent));
  res.json(results);
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userText = event.message.text;
  const reply = await generateReply(userText);

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: reply,
  });
}

async function generateReply(userText) {
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'あなたは夫婦の対話をサポートするAIファシリテーターです。' },
      { role: 'user', content: userText },
    ],
  });
  return response.choices[0].message.content;
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
