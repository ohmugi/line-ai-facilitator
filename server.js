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
  const events = req.body.events;

  events.forEach(async (event) => {
    console.log('📦 Full event:', JSON.stringify(event, null, 2));

    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const userId = event.source.userId;

      console.log('🪪 userId:', userId);

      // 🔁 仮：オウム返しで返信
      await client.replyMessage(event.replyToken, [
        {
          type: 'text',
          text: `あなたの発言：「${userMessage}」を受け取りました。`, // ※テスト用
        },
      ]);
    }
  });

  res.sendStatus(200);
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
