// 夫婦ファシリテーターBot（専門家モード＋改行調整付き）
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

const userHistories = {}; // userIdごとの会話履歴

const systemPrompt = `
あなたは、夫婦関係や子育てに関する相談を受けるAIファシリテーターです。
ユーザーの気持ちを丁寧に整理しながら、状況に応じて専門的な視点（夫婦心理学、発達心理学、育児方針の違いなど）を適切に補足してください。

会話の目的は以下です：
- ユーザーの感情を明確にする
- その背景にある期待や価値観を引き出す
- 相手に伝えるべきことがある場合は、一緒に翻訳して提案する

出力はLINEチャットで読みやすいよう、句読点の後や2〜3文ごとに適度な改行を入れてください。
共感・安心・信頼を感じられるよう、あたたかく、ていねいな文体で返答してください。
`;

// 改行整形（句点の後に改行）
function formatLineBreaks(text) {
  return text
    .replace(/([。！？])(?=[^\n])/g, '$1\n')
    .replace(/\n{2,}/g, '\n');
}

// グループチャット用：OpenAI応答生成（displayNameベース）
async function generateFacilitatedResponse(displayName, message) {
  const prompt = `${displayName}さんが「${message}」と言いました。\n夫婦間の対話を支援するAIファシリテーターとして、相手に配慮した返答を自然な語り口で行ってください。`;
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'あなたは夫婦の対話を支援するAIファシリテーターです。安心感と温かみをもって対話を進めてください。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
  });
  return response.choices[0].message.content;
}

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    // 🔸 グループチャット対応ブロック
    if (event.type === 'message' && event.source.type === 'group') {
      const groupId = event.source.groupId;
      const userId = event.source.userId;
      const message = event.message.text.trim();

      try {
        const profile = await client.getGroupMemberProfile(groupId, userId);
        const displayName = profile.displayName;

        const aiReply = await generateFacilitatedResponse(displayName, message);
        const formatted = formatLineBreaks(aiReply);

        await client.replyMessage(event.replyToken, [
          { type: 'text', text: formatted }
        ]);
      } catch (err) {
        console.error('Group message error:', err);
      }
    }

    // 🔸 1:1 チャット対応（従来処理）
    else if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const message = event.message.text.trim();

      if (!userHistories[userId]) {
        userHistories[userId] = [
          { role: 'system', content: systemPrompt }
        ];
      }

      userHistories[userId].push({ role: 'user', content: message });

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: userHistories[userId],
        temperature: 0.8,
      });

      const aiReply = response.choices[0].message.content;
      userHistories[userId].push({ role: 'assistant', content: aiReply });

      const formatted = formatLineBreaks(aiReply);
      await client.replyMessage(event.replyToken, [
        { type: 'text', text: formatted }
      ]);

      if (userHistories[userId].length > 20) {
        userHistories[userId].splice(1, 2);
      }
    }
  }

  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
