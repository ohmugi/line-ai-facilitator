// 柔軟ステップ型 LINEカウンセリングBot（OpenAIで初回発言を分析）
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

const userContexts = {}; // userId: { step, data, translated }

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const message = event.message.text.trim();

      if (!userContexts[userId]) {
        const analysis = await analyzeMessage(message);
        userContexts[userId] = {
          step: 1,
          data: {
            moyamoya: analysis.kikkake ? message : '',
            feeling: analysis.feeling ? extractFeeling(message) : '',
            reason: analysis.reason ? extractReason(message) : '',
            wish: analysis.wish ? extractWish(message) : '',
          },
        };
        if (!analysis.kikkake) {
          await reply(event.replyToken, 'なにがあって、モヤモヤしたんですか？気軽に教えてください。');
          continue;
        }
      }

      const context = userContexts[userId];

      if (!context.data.feeling) {
        context.data.feeling = message;
        await reply(event.replyToken, 'そのときの気持ちはどれに近いですか？\n\n😠 イライラ\n😟 不安\n😢 悲しい\n😞 さみしい\n🤔 その他');
      } else if (!context.data.reason) {
        context.data.reason = message;
        await reply(event.replyToken, 'どうしてそう感じたと思いますか？\n\n例：「私ばっかり我慢してる」「あの一言が引っかかった」など');
      } else if (!context.data.wish) {
        context.data.wish = message;
        await reply(event.replyToken, '気持ちを整理しています...');

        const translated = await generateReply(context.data);
        context.translated = translated;

        await reply(event.replyToken, `📝 整理されたメッセージ：\n${translated}`);
        await reply(event.replyToken, 'このメッセージをパートナーに伝えてもいいですか？\n\n✅ はい\n❌ いいえ');
      } else if (!context.sent) {
        if (message.includes('はい')) {
          const targetUserId = userId === USER_A_ID ? USER_B_ID : USER_A_ID;
          const senderName = userId === USER_A_ID ? '夫' : '妻';

          await client.pushMessage(targetUserId, [
            {
              type: 'text',
              text: `💬 ${senderName}からのメッセージ：\n${context.translated}`,
            },
          ]);
          await reply(event.replyToken, 'メッセージをパートナーに送信しました。');
        } else {
          await reply(event.replyToken, '了解しました。メッセージは送信しません。');
        }
        context.sent = true;
        delete userContexts[userId];
      }
    }
  }
  res.sendStatus(200);
});

async function reply(replyToken, text) {
  return client.replyMessage(replyToken, [{ type: 'text', text }]);
}

async function generateReply(data) {
  const prompt = `以下の内容を、相手に伝わりやすく中立的で共感的な表現に翻訳してください。\n\nモヤモヤのきっかけ: ${data.moyamoya}\n感情: ${data.feeling}\n理由: ${data.reason}\n本当はどうしてほしかったか: ${data.wish}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'あなたは夫婦の対話を支援するAIファシリテーターです。相手に伝わるよう丁寧に言い換えてください。' },
      { role: 'user', content: prompt },
    ],
  });

  return response.choices[0].message.content;
}

async function analyzeMessage(message) {
  const prompt = `次のメッセージに含まれている情報を判定してください。各項目は true か false で答えてください。\n\nモヤモヤのきっかけ（kikkake）\n感情（feeling）\n理由（reason）\n願い（wish）\n\nメッセージ: "${message}"\n\n結果は以下のJSON形式で返してください:\n{ "kikkake": true/false, "feeling": true/false, "reason": true/false, "wish": true/false }`;

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: '指定フォーマットに従って、ユーザーの発言を構造化して返してください。' },
      { role: 'user', content: prompt },
    ],
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch {
    return { kikkake: false, feeling: false, reason: false, wish: false };
  }
}

// ダミーの感情・理由・願い抽出（実運用では精度向上余地あり）
function extractFeeling(text) {
  if (text.includes('イライラ')) return 'イライラ';
  if (text.includes('不安')) return '不安';
  return '';
}
function extractReason(text) {
  return '';
}
function extractWish(text) {
  return '';
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
