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

async function startDeepTopic(groupId, assigneeUserId, topicKey) {
  const { data: tmpl } = await supabase
    .from('deep_templates')
    .select('intro_variants')
    .eq('topic_key', topicKey)
    .single();

  const variants = tmpl?.intro_variants || [
    'けみー、昨日変な夢を見たにゃ。小さい頃のこと思い出した…'
  ];
  const intro = variants[Math.floor(Math.random() * variants.length)];

  const { data: session, error } = await supabase
    .from('deep_sessions')
    .insert({
      group_id: groupId,
      topic_key: topicKey,
      assignee_user_id: assigneeUserId,
      step: 0,
      payload: {}
    })
    .select('id')
    .single();

  if (error) {
    console.error('startDeepTopic insert error:', error.message);
    return;
  }

  await client.pushMessage(groupId, {
    type: 'text',
    text: intro,
    quickReply: {
      items: [
        { type:'action', action:{ type:'postback', label:'ある', data:`deep:${session.id}:intro_yes` } },
        { type:'action', action:{ type:'postback', label:'ない/覚えてない', data:`deep:${session.id}:intro_no` } },
        { type:'action', action:{ type:'postback', label:'また今度', data:`deep:${session.id}:skip` } }
      ]
    }
  });
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

  // 入力の正規化（全角/半角スペース除去）＋ログ
  const raw = (event.message.text || '').trim();
  const text = raw.replace(/\s/g, '');
  console.log('[onText] text:', raw, 'normalized:', text);

  // ★ セキララ開始（親テーマをテスト起動）
  if (/^(セキララ|深い話|はじめて)$/i.test(text)) {
    await startDeepTopic(
      isGroup ? event.source.groupId : userId, // グループID推奨
      userId,                                  // ひとまず発言者を指名
      'parenting_style'                        // 親テーマ
    );
    return;
  }

  // ② 相談フォーム
  if (text === 'フォーム') {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '📮 相談フォームはこちらです：\nhttps://forms.gle/xxxxxxxx',
    });
    return;
  }

  // ③ 通常対話
  const message = raw; // 通常処理は正規化前を使用
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
        content: 'あなたは「けみー」の表現アドバイザーです。文を「けみーらしく」やわらかく、問いは1つに絞って整えてください。語尾に「にゃ」が自然に混ざるように。',
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

async function onPostback(event) {
  const data = event.postback?.data || '';

  // ★ deep: セキララの最小ハンドラ（STEP0→STEP1、STEP1→STEP2）
  if (data.startsWith('deep:')) {
    const [_, sessionId, token, arg] = data.split(':'); // deep:<SESSION_ID>:s1:<index> 等

    // 現在のセッション取得
    const { data: s } = await supabase.from('deep_sessions').select('*').eq('id', sessionId).single();
    if (!s) {
      await client.replyMessage(event.replyToken, { type: 'text', text: 'セッションが見つからないにゃ…' });
      return;
    }

    // STEP0 → STEP1（範囲）
    if (s.step === 0) {
      await supabase.from('deep_sessions').update({ step: 1 }).eq('id', s.id);
      const { data: tmpl } = await supabase.from('deep_templates').select('s1_choices').eq('topic_key', s.topic_key).single();
      const items = tmpl.s1_choices.map((label, i) => ({
        type: 'action', action: { type: 'postback', label, data: `deep:${s.id}:s1:${i}` }
      }));
      items.push({ type: 'action', action: { type: 'postback', label: 'パス', data: `deep:${s.id}:pass` }});
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'へぇ〜にゃ。もし思い出すなら、どのあたり？',
        quickReply: { items }
      });
      return;
    }

    // STEP1（範囲選択） → STEP2（ポジ候補）
    if (s.step === 1 && token === 's1') {
      const domainKeyList = ['discipline','study','chores','money','social','health'];
      const domainKey = domainKeyList[Number(arg)] || domainKeyList[0];

      // payloadに保存＆step進行
      await supabase.from('deep_sessions')
        .update({ step: 2, payload: { ...(s.payload || {}), s1_domain: domainKey } })
        .eq('id', s.id);

      const { data: tmpl } = await supabase
        .from('deep_templates')
        .select('s2_pos_choices')
        .eq('topic_key', s.topic_key)
        .single();

      const choices = (tmpl.s2_pos_choices[domainKey] || []).map((label, i) => ({
        type:'action', action:{ type:'postback', label, data:`deep:${s.id}:s2:${i}` }
      }));
      choices.push({ type:'action', action:{ type:'postback', label:'パス', data:`deep:${s.id}:pass` }});

      await client.replyMessage(event.replyToken, {
        type:'text',
        text:'その中で“ありがたかった”に近いのは？',
        quickReply:{ items: choices }
      });
      return;
    }

    // 以降（STEP3〜7）は後で追加。今はここまで通ればOK。
    await client.replyMessage(event.replyToken, { type:'text', text:'続きはこの後実装するにゃ。' });
    return;
  }

  // （診断diag: を使うなら、この下に書く。今回はセキララ優先なので省略/後回し）
  return;
}
  // 既存の diag: 分岐があればそのまま下で
  ...
}

  
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
