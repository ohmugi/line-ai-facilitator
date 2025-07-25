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

        const systemPrompt =
          `あなたは、夫婦関係や子育てに関する相談を受けるAIファシリテーターです。\n` +
          `ユーザーの気持ちを丁寧に整理しながら、状況に応じて専門的な視点（夫婦心理学、発達心理学、育児方針の違いなど）を適切に補足してください。\n\n` +
          `会話の目的は以下です：\n- ユーザーの感情を明確にする\n- その背景にある期待や価値観を引き出す\n- 相手に伝えるべきことがある場合は、一緒に翻訳して提案する\n\n` +
          `出力はLINEチャットで読みやすいよう、句読点の後や2〜3文ごとに適度な改行を入れてください。\n` +
          `共感・安心・信頼を感じられるよう、あたたかく、ていねいな文体で返答してください。\n\n` +
          history;

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
    recent.map(msg => `${msg.role === 'user' ? 'ユーザー' : 'AI'}：${msg.message_text}`).join('\n')
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
