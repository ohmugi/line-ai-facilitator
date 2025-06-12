const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { OpenAI } = require('openai');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const USER_A_ID = 'Ubd79514779529cc1e0d76eccad1a87ca';
const USER_B_ID = 'U59c1c2e7c9263ac5e3575eb3ffb6ccc7';
const client = new Client(config);
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  events.forEach(async (event) => {
    console.log('📦 Full event:', JSON.stringify(event, null, 2));

   if (event.type === 'message' && event.message.type === 'text') {
  const userMessage = event.message.text;
  const userId = event.source.userId;

  const translated = await generateReply(userMessage);

  let targetUserId;
  if (userId === USER_A_ID) {
    targetUserId = USER_B_ID;
  } else if (userId === USER_B_ID) {
    targetUserId = USER_A_ID;
  } else {
    console.log('❓ 未知のユーザー');
    return;
  }

  await client.pushMessage(targetUserId, [
    { type: 'text', text: `💬 パートナーからのメッセージ：\n${translated}` },
  ]);
}
  });

  res.sendStatus(200);
});


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
