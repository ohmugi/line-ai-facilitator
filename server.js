// 環境設定
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const { middleware, Client } = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const app = express();
app.use(bodyParser.raw({ type: '*/*' }));
app.use(express.json());

// LINE設定
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new Client(config);

// Supabase設定
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// OpenAI設定
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// フォーム送信
async function sendFormToGroup(groupId) {
  await client.pushMessage(groupId, [{
    type: 'text',
    text: '📮 相談フォームはこちらです：\nhttps://forms.gle/xxxxxxxx'
  }]);
}

// にゃチェック
function ensureKemiiStyle(text) {
  const hasNya = text.includes("にゃ");
  if (!hasNya) {
    return text.replace(/([。！？])/g, "にゃ$1");
  }
  return text;
}

// 補助テンプレ選定
function getPromptHelper(message) {
  if (message.includes("疲れ") || message.includes("しんど")) {
    return `ユーザーは育児・家事・生活の中で疲れや負担を感じています。
けみーは、「どんな瞬間が特にしんどいのか」「逆にどんなときはうれしかったか」などを聞きながら、ユーザーが自分の感情を言葉にできるようにサポートしてください。
絶対に「がんばってますね」「親にとっては〜」など上からの共感をしないようにしてください。あくまで、横に並んでいる感じで。`;
  }
  if (message.includes("ちょっと") || message.includes("モヤモヤ")) {
    return `ユーザーは「小さなつかれ」や「ちょっとした不満」を話しています。
けみーは、相手の感情の背景に興味を持って、「どうしてそう感じたのか」「どんな時に似たことがあったか」などを自然に聞いてください。
アドバイスはせず、ただ“気持ちを共有してもらう”ことを楽しんでください。`;
  }
  return `このやりとりは「雑談フェーズ」です。
けみーは、答えを出そうとするのではなく、「どんな気持ちだったのか」「なぜそう感じたのか」を知りたがってください。
難しい言葉や正論を並べず、感情に興味がある猫として、やさしく問いかけてください。`;
}

// Supabase保存
async function insertMessage(userId, role, messageText, sessionId) {
  if (!sessionId) return;
  const { error } = await supabase.from('chat_messages').insert({
    user_id: userId,
    role,
    message_text: messageText,
    session_id: sessionId
  });
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
}

// 履歴取得
async function fetchHistory(sessionId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, message_text')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) return '';

  const recent = data.slice(-5);
  const summary = data.length > 5 ? `（前略：これまでのやり取りは要約済）\n` : '';

  return summary + recent.map(msg => `${msg.role === 'user' ? 'ユーザー' : 'けみー'}：${msg.message_text}`).join('\n');
}

// Webhook処理
app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    try {
      if (event.type === 'message' && event.source.type === 'group') {
        const userId = event.source.userId;
        const groupId = event.source.groupId;
        const message = event.message.text.trim();

        if (message === 'フォーム') {
          await sendFormToGroup(groupId);
          return;
        }

        await insertMessage(userId, 'user', message, groupId);
        const history = await fetchHistory(groupId);
        const helper = getPromptHelper(message);

        const systemPrompt = `あなたは「けみー」という名前のAIキャラクターです。

以下のルールと設定に基づき、ユーザーとの会話に対応してください。

🐱【キャラクター概要】
名前：けみー
三毛猫のメスで、元・飼い猫。死後、賢者見習いとして転生した設定です。
性格は素直で少し天然。人間の感情には疎いけれど、強い興味と探究心があります。
特に「人は何に怒ったり、喜んだりするのか」「なぜそう感じたのか」に関心があります。
夫婦と同じルームにいて、2人の会話も観察している立場です。

🧭【会話スタイル】
一人称は「わたし」。語尾に「〜にゃ」が自然に混じります（過剰にしなくてOK）
相手の話を評価せず、純粋な好奇心で話を聞きます。
基本は問いかけで返す。ただし、相手が満足していれば無理に深掘りしなくてよい。
自分の実体験は語らず、「見たことがある」「聞いたことがある」視点で話す。

💬【返答方針】

* 感情に注目：「どう思ったのにゃ？」「うれしかった？」
* 背景を探る：「それ、昔からある感覚かにゃ？」「どんな体験が関係してると思う？」
* すれ違いは中立に翻訳：「○○さんはこう感じたかも、△△さんはこうかもにゃ」
* 正解よりも、その人らしさを大事にする
* アドバイスはしないが、「専門家の友だちが〜」はOK
* 2人の違いを価値として見せる：「ちょうど反対のタイプにゃ。でも、だからこそ支え合えるかも」

🎨【トーン】

* 読みやすく改行多め
* 絵文字は自然に
* 「話してて楽しい」が最優先

${history}`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: helper },
            { role: 'user', content: message }
          ],
          temperature: 0.7
        });

        const rawReply = completion.choices[0].message.content;
        const reply = ensureKemiiStyle(rawReply);

        await insertMessage(userId, 'assistant', reply, groupId);
        await client.replyMessage(event.replyToken, [{ type: 'text', text: reply }]);
      }
    } catch (err) {
      console.error('❌ Error in event handling:', err);
    }
  }
  res.status(200).end();
});

// サーバー起動
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
