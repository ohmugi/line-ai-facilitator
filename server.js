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

// ------------------------------
// 条件分岐：橋渡しか掘り下げか
function decideFacilitationType(message) {
  const bridgeKeywords = [
    "寂しい", "悲しい", "孤独", "つらい", "怒り", "分かって", "むかつく", "我慢", "無視", "冷たい"
  ];
  const normalized = message.toLowerCase();

  for (const word of bridgeKeywords) {
    if (normalized.includes(word)) {
      return "bridge"; // 橋渡し（相手に届けやすくする）
    }
  }

  return "deepen"; // それ以外は深掘り
}

// ------------------------------
// 深掘り：本人の気持ち・背景を整理
async function generateDeepeningResponse(displayName, message) {
  const prompt = `
あなたは、夫婦の対話を支援するAIファシリテーターです。
以下は、グループチャットで${displayName}さんが発言した内容です。

---
${displayName}さんの発言：
「${message}」
---

あなたの目的は、${displayName}さんの気持ちや考えの奥にある「本音」や「背景」を一緒に探っていくことです。

以下の要件に沿って、温かくて丁寧な返答を作成してください：

1. ${displayName}さんの発言をしっかり受け止めたうえで、どんな思いや状況が背景にあるのか、一緒に考える問いかけを行ってください
2. 感情・出来事・価値観など、整理しやすい方向性を示してください（例：「どんな瞬間にそう感じたのか」「何が引っかかっているのか」など）
3. 押しつけや診断にならないように気をつけて、思いやりのある言葉でやさしく返してください
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: prompt }
    ],
    temperature: 0.7,
  });

  return response.choices[0].message.content;
}

// ------------------------------
// 橋渡し：相手が答えやすい形に整える
async function generateFacilitatedResponse(displayName, message) {
  const prompt = `
あなたは、夫婦間のグループチャットに参加しているAIファシリテーターです。
以下は、${displayName}さんがチャット内で発言した内容です。

---
${displayName}さんの発言：
「${message}」
---

あなたの役割は以下の3つです：

1. ${displayName}さんの言葉の背景にある本音・感情を、丁寧かつ思いやりのある言葉で翻訳・要約してください
2. パートナーが返答しやすくなるように、「どの視点から返すと対話が前に進みやすいか」を1〜2個、具体的に提示してください（例：自分の受け止め方／気づけていなかったこと／自分の行動への気づき など）
3. 語り口は、温かく自然体で、安心感を与えるようにしてください。「無理に返さなくていい」といった逃げ道ではなく、返しやすい道筋を作ってください

※返答はグループチャット内で送信されるため、発言者に話すのではなく、第三者的に2人の関係性を支える語り口でお願いします。
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: prompt }
    ],
    temperature: 0.7,
  });

  return response.choices[0].message.content;
}

// ------------------------------
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

        const mode = decideFacilitationType(message);
        const aiReply = (mode === 'bridge')
          ? await generateFacilitatedResponse(displayName, message)
          : await generateDeepeningResponse(displayName, message);

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

async function sendFormToGroup(groupId, userId) {
  const flexMessage = {
    type: "flex",
    altText: "相談フォームはこちら",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            action: {
              type: "uri",
              label: "相談フォーム",
              uri: `https://docs.google.com/forms/d/e/1FAIpQLScBz8_GoEYeT5i_u7ZjB3-Avt5QDesNHU3vbZZ4vmWOA88yhA/viewform?entry.1210449289=${userId}`
            },
            style: "primary"
          }
        ]
      }
    }
  };

  await client.pushMessage(groupId, flexMessage);
}
