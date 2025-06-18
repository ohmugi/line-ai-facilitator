// LINE Bot × OpenAI自然対話型ファシリテーター
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

// ユーザーごとの履歴を保持（セッション型）
const userHistories = {}; // { userId: [ { role, content }, ... ] }

const systemPrompt = `あなたは夫婦の対話を支援するAIファシリテーターです。
ユーザーの気持ちを整理しやすくするために、親しみやすく、あたたかいトーンで相づちや共感を交えながら会話を進めてください。
会話は以下の目的のいずれかに導けると理想的です：
- モヤモヤの背景や感情を明確にする
- ユーザーが「本当はどうしてほしかったのか」に気づける
- 相手に伝えるならどんな言い方がよさそうかを一緒に考える
ただし、会話が自然であることを最優先し、ステップを固定せず、ユーザーのペースに合わせてください。
問い詰めず、あくまで“話し相手”として寄り添うようにしてください。
ユーザーの入力には、まず共感・受容を示し、その後さりげなく質問をしてください。`;

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const message = event.message.text.trim();

      // 履歴初期化（最大10ターン）
      if (!userHistories[userId]) {
        userHistories[userId] = [
          { role: 'system', content: systemPrompt }
        ];
      }

      userHistories[userId].push({ role: 'user', content: message });

      // OpenAIで自然対話生成
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: userHistories[userId],
        temperature: 0.8,
      });

      const aiReply = response.choices[0].message.content;

      userHistories[userId].push({ role: 'assistant', content: aiReply });

      await client.replyMessage(event.replyToken, [
        { type: 'text', text: aiReply }
      ]);

      // 履歴が多くなりすぎたら古い分をカット
      if (userHistories[userId].length > 20) {
        userHistories[userId].splice(1, 2); // system以外を削る
      }
    }
  }
  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
