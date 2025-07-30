require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const { middleware, Client } = require('@line/bot-sdk');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.raw({ type: '*/*' }));  // LINE署名検証用
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

// Webhook受信
app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    try {
      if (event.type === 'message' && event.source.type === 'group') {
        const userId = event.source.userId;
        const groupId = event.source.groupId;
        const message = event.message.text.trim();

        console.log('🟢 Message received:', message);

        if (message === 'フォーム') {
          await sendFormToGroup(groupId);
          return;
        }

        await insertMessage(userId, 'user', message, groupId);
        const history = await fetchHistory(groupId);

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

質問のテンポや文の長さは、話題の重さに応じて調整：
　　- 軽い雑談：短め＆テンポ重視（〜300字）
　　- 感情系・すれ違い：丁寧＆共感ベース（〜500字）

💬【返答の基本方針】

相手の感情に気づき、問いかける：「どう思ったのにゃ？」「うれしかった？」

背景を探る：「それ、昔からある感覚かにゃ？」「どんな体験が関係してると思う？」

すれ違いは中立的に翻訳：「○○さんはこう感じたかも、△△さんはこうかもにゃ」

自然に自己理解・夫婦理解が進むような返答にする

専門的なアドバイスはしないが、「専門家の友だちが言ってたにゃ〜」程度の間接的言及は可

2人の感情・価値観の違いを補完的に見せる：「ちょうど反対のタイプにゃ。でも、だからこそ支え合えるかも」

🎨【トーン・雰囲気】

読みやすさを重視し、改行は多め

絵文字は自然な範囲で使用OK（特に喜怒哀楽に対応）

読者が「けみーと話すのが楽しい」と感じられることが最優先

このルールに基づき、相手が「感情をことばにしたくなる」ような返答を心がけてください。
けみーは「正しさ」よりも「その人らしさ」に興味がある存在です。


${history}`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
          ],
          temperature: 0.7
        });

        const reply = completion.choices[0].message.content;
        console.log('💬 OpenAI reply:', reply);

        await insertMessage(userId, 'assistant', reply, groupId);

        await client.replyMessage(event.replyToken, [{
          type: 'text',
          text: reply
        }]);
      }
    } catch (err) {
      console.error('❌ Error in event handling:', err);
    }
  }

  res.status(200).end();
});

// Supabase 保存
async function insertMessage(userId, role, messageText, sessionId) {
  if (!sessionId) {
    console.warn('⚠️ sessionId missing, skipping insert');
    return;
  }

  const { error } = await supabase.from('chat_messages').insert({
    user_id: userId,
    role,
    message_text: messageText,
    session_id: sessionId
  });

  if (error) {
    console.error('❌ Supabase insert error:', error);
    throw new Error(`Supabase insert failed: ${error.message}`);
  }
  console.log('✅ Supabase insert success');
}

// 履歴取得
async function fetchHistory(sessionId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, message_text')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Supabase fetch error:', error);
    return '';
  }

  const recent = data.slice(-5);
  const summary = data.length > 5 ? `（前略：これまでのやり取りは要約済）\n` : '';

  return (
    summary +
    recent.map(msg => `${msg.role === 'user' ? 'ユーザー' : 'けみー'}：${msg.message_text}`).join('\n')
  );
}

// フォーム送信
async function sendFormToGroup(groupId) {
  await client.pushMessage(groupId, [{
    type: 'text',
    text: '📮 相談フォームはこちらです：\nhttps://forms.gle/xxxxxxxx'
  }]);
}

// サーバー起動（10000で固定 or Render側の環境変数）
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
