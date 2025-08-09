// server.js（重複解消・Postback分離版）

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import { middleware, Client } from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { startDiagnosis, processAnswer, calculateDiagnosisResult } from './services/diagnosisService.js';

const app = express();

// LINEの署名検証に備えて raw を先に
app.use(bodyParser.raw({ type: '*/*' }));

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

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ------- ユーティリティ -------

function ensureKemiiStyle(text) {
  const hasNya = text.includes('にゃ');
  if (!hasNya) {
    return text.replace(/([。！？])/g, 'にゃ$1');
  }
  return text;
}

function getPromptHelper(message) {
  if (message.includes('疲れ') || message.includes('しんど')) {
    return `ユーザーは育児・家事・生活の中で疲れや負担を感じています。
けみーは、「どんな瞬間が特にしんどいのか」「逆にどんなときはうれしかったか」などを聞きながら、ユーザーが自分の感情を言葉にできるようにサポートしてください。
問いは1つに絞り、答えにくそうなら選択肢を添えてください。`;
  }
  if (message.includes('ちょっと') || message.includes('モヤモヤ')) {
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
    session_id: sessionId,
  });
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
}

async function fetchHistory(sessionId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, message_text')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error || !data) return '';

  const recent = data.slice(-5);
  const summary = data.length > 5 ? `（前略：これまでのやり取りは要約済）\n` : '';
  return (
    summary +
    recent
      .map((msg) => `${msg.role === 'user' ? 'ユーザー' : 'けみー'}：${msg.message_text}`)
      .join('\n')
  );
}

// ------- Webhook -------

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events || [];
  try {
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error('❌ Webhook error:', e?.response?.data || e.message || e);
    res.status(200).end(); // LINE側には200を返す
  }
});

async function handleEvent(event) {
  if (event.type === 'message' && event.message?.type === 'text') {
    return onText(event);
  }
  if (event.type === 'postback') {
    return onPostback(event);
  }
  // それ以外（join/leave等）は無視
  return;
}

// ------- Message（通常メッセージ）-------

async function onText(event) {
  const isGroup = event.source.type === 'group';
  const userId = event.source.userId;
  const sessionId = isGroup ? event.source.groupId : userId;

  // 入力の正規化＆ログ（全角/半角スペース除去）
  const raw = (event.message.text || '').trim();
  const text = raw.replace(/\s/g, '');
  console.log('[onText] text:', raw, 'normalized:', text);

  // ① 診断コマンド（フォールバック付き）
  if (/^(診断|しんだん)$/i.test(text)) {
    try {
      console.log('[DIAG] start');
      const question = await startDiagnosis(userId); // ここで失敗する可能性あり
      console.log('[DIAG] got question:', question?.id);

      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: `にゃん性格診断を始めるにゃ！\n\n${question.text}`,
        quickReply: {
          items: question.choices.map((choice) => ({
            type: 'action',
            action: {
              type: 'postback',
              label: choice.label,
              data: `diag:q=${question.id}&a=${choice.value}`,
            },
          })),
        },
      });
    } catch (e) {
      console.error('[DIAG] error:', e?.message || e);
      // フォールバック（診断サービスが壊れていても必ず応答する）
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'にゃん性格診断・テスト版だにゃ！まずはこれに答えてみて？',
        quickReply: {
          items: [
            { type: 'action', action: { type: 'postback', label: '朝型', data: 'diag:q=1&a=morning' } },
            { type: 'action', action: { type: 'postback', label: '夜型', data: 'diag:q=1&a=night' } },
            { type: 'action', action: { type: 'postback', label: '決められない', data: 'diag:q=1&a=unknown' } },
          ],
        },
      });
    }
    return;
  }

  // ② 相談フォームリンク
  if (text === 'フォーム') {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '📮 相談フォームはこちらです：\nhttps://forms.gle/xxxxxxxx',
    });
    return;
  }

  // ③ 通常対話（ここは今のままでOK）
  const message = raw; // 普段の処理は正規化前の文面を使う
  await insertMessage(userId, 'user', message, sessionId);

  const history = await fetchHistory(sessionId);
  const helper = getPromptHelper(message);

  const { data: character, error } = await supabase
    .from('characters')
    .select('prompt_template')
    .eq('name', 'けみー')
    .single();

  if (error || !character) {
    console.error('キャラクター設定の取得失敗:', error?.message);
    await client.replyMessage(event.replyToken, { type: 'text', text: 'いまは少し調子が悪いにゃ…' });
    return;
  }

  const systemPrompt = character.prompt_template;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: helper },
      { role: 'user', content: message },
    ],
    temperature: 0.7,
  });

  const rawReply = completion.choices[0].message.content;

  const reformulated = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'あなたは「けみー」というAIキャラの表現アドバイザーです。以下の文章を、「けみーらしく」やわらかく、問いを1つに絞って再構成してください。語尾に「にゃ」が自然に混ざり、説明っぽさは控え、問い＋つぶやきで返してください。',
      },
      { role: 'user', content: rawReply },
    ],
    temperature: 0.7,
  });

  const reply = ensureKemiiStyle(reformulated.choices[0].message.content || 'うんうん、聞いてるにゃ。');
  await insertMessage(userId, 'assistant', reply, sessionId);
  await client.replyMessage(event.replyToken, { type: 'text', text: reply });
}


// ------- Postback（診断・他機能の分岐点）-------

if (data.startsWith('diag:q=1')) {
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: 'なるほどにゃ。じゃあ次の質問いくよ！\n最近いちばんワクワクしたのはどれ？',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: '人との会話', data: 'diag:q=2&a=talk' } },
        { type: 'action', action: { type: 'postback', label: '新しい挑戦', data: 'diag:q=2&a=challenge' } },
        { type: 'action', action: { type: 'postback', label: 'おいしいごはん', data: 'diag:q=2&a=food' } },
      ],
    },
  });
  return;
}

async function onPostback(event) {
  const userId = event.source.userId;
  const data = event.postback?.data || '';

  // 診断フローのPostback: "diag:q=1&a=2"
  if (data.startsWith('diag:')) {
    const payload = data.replace(/^diag:/, '');
    const [qPart, aPart] = payload.split('&');
    const questionId = parseInt(qPart.split('=')[1], 10);
    const answerValue = aPart.split('=')[1];

    try {
      const nextQuestion = await processAnswer(userId, questionId, answerValue);

      if (!nextQuestion) {
        // スコアを取得
        const { data: sessions } = await supabase
          .from('diagnosis_sessions')
          .select('*')
          .eq('user_id', userId)
          .eq('finished', true)
          .order('created_at', { ascending: false })
          .limit(1);

        const session = sessions?.[0];
        const fileName = calculateDiagnosisResult(session?.scores || {});

        await client.replyMessage(event.replyToken, [
          { type: 'text', text: '診断が完了したにゃ！結果はこちらだにゃ👇' },
          {
            type: 'image',
            originalContentUrl: `https://あなたのドメイン/images/${fileName}`,
            previewImageUrl: `https://あなたのドメイン/images/${fileName}`,
          },
        ]);
      } else {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: nextQuestion.text,
          quickReply: {
            items: nextQuestion.choices.map((choice) => ({
              type: 'action',
              action: {
                type: 'postback',
                label: choice.label,
                data: `diag:q=${nextQuestion.id}&a=${choice.value}`,
              },
            })),
          },
        });
      }
    } catch (err) {
      console.error('❌ Postback処理エラー:', err?.message || err);
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '回答の保存中にエラーが起きたにゃ…ごめんにゃ',
      });
    }

    return;
  }

  // ここに「深いテーマ 7ステップ」の Postback も将来追加できます:
  // if (data.startsWith('deep:')) { ... }

  // 未対応のPostbackは黙って無視
  return;
}

// ------- 起動 -------

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
