const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { OpenAI } = require('openai');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const USER_A_ID = 'Ubd79514779529cc1e0d76eccad1a87ca'; // あなた
const USER_B_ID = 'U59c1c2e7c9263ac5e3575eb3ffb6ccc7'; // 奥様

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
      let senderName;
      if (userId === USER_A_ID) {
        targetUserId = USER_B_ID;
        senderName = '夫';
      } else if (userId === USER_B_ID) {
        targetUserId = USER_A_ID;
        senderName = '妻';
      } else {
        console.log('❓ 未知のユーザー');
        return;
      }

      // 相手に翻訳メッセージをPush送信
      await client.pushMessage(targetUserId, [
        {
          type: 'text',
          text: `💬 ${senderName}からのメッセージ：\n${translated}`,
        },
      ]);

      // 送信者には返信（確認メッセージ）
      await client.replyMessage(event.replyToken, [
        {
          type: 'text',
          text: 'メッセージを翻訳し、パートナーに送信しました。',
        },
      ]);
    }
  });

  res.sendStatus(200);
});

async function generateReply(userText) {
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content:
          'あなたは夫婦の対話を支援するAIファシリテーターです。送信者の感情や背景を整理し、相手に伝わりやすく中立的で共感的な表現に翻訳してください。相手を責める言い方は避け、願いや感情の意図に焦点を当ててください。',
      },
      { role: 'user', content: userText },
    ],
  });

  return response.choices[0].message.content;
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
