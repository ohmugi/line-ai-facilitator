// server.js（1対1にも対応した修正版）

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import { middleware, Client } from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { startDiagnosis } from './services/diagnosisService.js';

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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function ensureKemiiStyle(text) {
  const hasNya = text.includes("にゃ");
  if (!hasNya) {
    return text.replace(/([。！？])/g, "にゃ$1");
  }
  return text;
}

function getPromptHelper(message) {
  if (message.includes("疲れ") || message.includes("しんど")) {
    return `ユーザーは育児・家事・生活の中で疲れや負担を感じています。
けみーは、「どんな瞬間が特にしんどいのか」「逆にどんなときはうれしかったか」などを聞きながら、ユーザーが自分の感情を言葉にできるようにサポートしてください。
問いは1つに絞り、答えにくそうなら選択肢を添えてください。`;
  }
  if (message.includes("ちょっと") || message.includes("モヤモヤ")) {
    return `ユーザーは「小さなつかれ」や「ちょっとした不満」を話しています。
けみーは、相手の感情の背景に興味を持って、「どうしてそう感じたのか」「どんな時に似たことがあったか」などを自然に聞いてください。
アドバイスはせず、答えやすいように選択肢も提示してみてください。`;
  }
  return `このやりとりは「雑談フェーズ」です。
けみーは、答えを出そうとするのではなく、「どんな気持ちだったのか」「なぜそう感じたのか」を知りたがってください。
難しい言葉や正論を並べず、感情に興味がある猫として、やさしく問いかけてください。`;
}

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

async function getUserName(userId) {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('custom_name, display_name')
    .eq('user_id', userId)
    .single();

  if (profile?.custom_name) return profile.custom_name;
  if (profile?.display_name) return profile.display_name;

  const lineProfile = await client.getProfile(userId);
  await supabase.from('user_profiles').upsert({
    user_id: userId,
    display_name: lineProfile.displayName
  });
  return lineProfile.displayName;
}

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    try {
      if (event.type === 'message' && (event.source.type === 'group' || event.source.type === 'user')) {
        const userId = event.source.userId;
        const sessionId = event.source.type === 'group' ? event.source.groupId : userId;
        const message = event.message.text.trim();

        // ✅ ここが診断スタートの処理！
        if (message.includes('診断')) {
          const question = await startDiagnosis(userId);

          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `にゃん性格診断を始めるにゃ！\n\n${question.text}`,
            quickReply: {
              items: question.choices.map(choice => ({
                type: 'action',
                action: {
                  type: 'postback',
                  label: choice.label,
                  data: `q=${question.id}&a=${choice.value}`,
                },
              })),
            },
          });

          return; // ← 他の処理はスキップ
        }

        if (event.type === 'postback') {
  const userId = event.source.userId;
  const data = event.postback.data; // 例: "q=1&a=2"
  const [qPart, aPart] = data.split('&');
  const questionId = parseInt(qPart.split('=')[1]);
  const answerValue = aPart.split('=')[1];

  try {
    const nextQuestion = await processAnswer(userId, questionId, answerValue);

    if (!nextQuestion) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '診断が完了したにゃ！結果はあとでお知らせするにゃ〜',
      });
    } else {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: `${nextQuestion.text}`,
        quickReply: {
          items: nextQuestion.choices.map(choice => ({
            type: 'action',
            action: {
              type: 'postback',
              label: choice.label,
              data: `q=${nextQuestion.id}&a=${choice.value}`,
            },
          })),
        },
      });
    }
  } catch (err) {
    console.error('❌ Postback処理エラー:', err.message || err);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '回答の保存中にエラーが起きたにゃ…ごめんにゃ',
    });
  }

  return;
}


        // 📮 相談フォームリンク
        if (message === 'フォーム') {
          await client.pushMessage(sessionId, [{
            type: 'text',
            text: '📮 相談フォームはこちらです：\nhttps://forms.gle/xxxxxxxx'
          }]);
          return;
        }

        // 💬 通常のけみーの対話処理（履歴・GPT呼び出しなど）
        await insertMessage(userId, 'user', message, sessionId);
        const history = await fetchHistory(sessionId);
        const helper = getPromptHelper(message);

        const { data: character, error } = await supabase
          .from('characters')
          .select('prompt_template')
          .eq('name', 'けみー')
          .single();

        if (error || !character) {
          throw new Error(`キャラクター設定の取得に失敗しました: ${error?.message}`);
        }

        const systemPrompt = character.prompt_template;

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

        const reformulated = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `あなたは「けみー」というAIキャラの表現アドバイザーです。
以下の文章を、「けみーらしく」やわらかく、問いを1つに絞って再構成してください。
語尾に「にゃ」が自然に混ざり、選択肢があってもOKです。
説明っぽさは控え、問い＋つぶやきで返してください。`
            },
            { role: 'user', content: rawReply }
          ],
          temperature: 0.7
        });

        const reply = ensureKemiiStyle(reformulated.choices[0].message.content);

        await insertMessage(userId, 'assistant', reply, sessionId);
        await client.replyMessage(event.replyToken, [{ type: 'text', text: reply }]);
      }
    } catch (err) {
      console.error('❌ Error in event handling:', err.response?.data || err.message || err);
    }
  }

  res.status(200).end();
});







const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
