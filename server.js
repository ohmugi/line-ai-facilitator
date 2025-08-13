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

// --- Deep flow constants ---
const DEEP_DOMAINS = ['discipline','study','chores','money','social','health'];

const MEANING_CHOICES = ["自信","安心感","挑戦心","優しさ","まだ分からない"];
const IMPACT_CHOICES  = ["ある","ない","当時だけ"];
const REFRAME_CHOICES = ["心配しすぎ","時間/お金の余裕なし","世代の常識","期待が大きい","分からない"];

// 共通：クイックリプライ送信用
function qrItems(pairs){ // [{label, data}]
  return {
    items: pairs.map(p => ({ type:'action', action:{ type:'postback', label:p.label, data:p.data }}))
  };
}

async function updateSession(id, patch){
  await supabase.from('deep_sessions').update(patch).eq('id', id);
}


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
async function summarizeDeepResult(topicKey, payload){
  // 今は 'parenting_style' 前提。必要に応じて分岐を増やせます。
  const s1 = payload.s1_domain || '';
  const s2 = payload.s2_pos || '';
  const s3 = payload.s3_meaning || '';
  const s4 = payload.s4_neg || '';
  const s5 = payload.s5_impact || '';
  const s6 = payload.s6_reframe || '';

  const prompt = `
あなたは夫婦の緩衝材AI「けみー」です。評価語を避け、事実＋やわらかな解釈で1〜2文に要約します。
語尾はやさしく、「〜だったみたい」「〜かもしれない」を使ってください。

テーマ: 親からの育て方
要素:
- 範囲: ${s1}
- ありがたかった: ${s2}
- それで育った良さ: ${s3}
- 気になった: ${s4}
- 影響: ${s5}
- 背景の仮説: ${s6}

出力: 1〜2文の日本語。けみー口調は軽く、ねぎらいも一言入れる。
`;

  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role:'system', content:'要約アシスタント' }, { role:'user', content: prompt }],
      temperature: 0.5
    });
    return r.choices[0].message.content?.trim() || 'まとめたにゃ。';
  } catch(e) {
    console.error('summary error:', e?.message || e);
    return `“${s2}”がうれしくて、“${s4}”はちょっと…だったみたいにゃ。`;
  }
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

// BEGIN AI EDIT: webhook-handler
app.post('/webhook', middleware(config), async (req, res) => {
  // Normalize events to an array
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  try {
    const results = await Promise.allSettled(events.map(event => handleEvent(event)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const event = events[index];
        console.error('Webhook handleEvent failed', { type: event?.type, reason: result.reason });
      }
    });
  } catch (err) {
    // Log unexpected errors
    console.error('Webhook handler unexpected error', err);
  } finally {
    // Always respond with 200 to LINE
    res.status(200).end();
  

});
// END AI EDIT: webhook-handler

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


// ------- Postback（診断・セキララ）-------
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
        // スコア取得→結果表示
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
        // 次の設問を提示
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

    return; // ← このreturnは関数内なので合法
  }
  // ↑ ここで"diag:"ブロックが完全に閉じていることが重要（波カッコ対応）

  // セキララ（deep）フロー: "deep:<SESSION_ID>:s1:<index>" など
  else if (data.startsWith('deep:')) {
    const [_, sessionId, token, arg] = data.split(':');

    // セッション取得
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

    // STEP1（範囲）→ STEP2（ポジ候補）
    if (s.step === 1 && token === 's1') {
      const domains = ['discipline','study','chores','money','social','health'];
      const domainKey = domains[Number(arg)] || domains[0];

      await supabase
        .from('deep_sessions')
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

        // STEP2（ポジの具体） → STEP3（意味付け）
    if (s.step === 2 && token === 's2') {
      const domain = (s.payload?.s1_domain) || DEEP_DOMAINS[0];

      // s2_pos 保存（テンプレから文言を特定）
      const { data: tmpl2 } = await supabase
        .from('deep_templates')
        .select('s2_pos_choices')
        .eq('topic_key', s.topic_key)
        .single();

      const labels = tmpl2?.s2_pos_choices?.[domain] || [];
      const picked = labels[Number(arg)];
      await updateSession(s.id, { step: 3, payload: { ...(s.payload||{}), s2_pos: picked }});

      // STEP3 提示
      await client.replyMessage(event.replyToken, {
        type:'text',
        text:'それって今のあなたのどんな良さにつながってる？',
        quickReply: qrItems(
          MEANING_CHOICES.map((lb,i)=>({label:lb, data:`deep:${s.id}:s3:${i}`})).concat([{label:'パス', data:`deep:${s.id}:pass`}])
        )
      });
      return;
    }

    // STEP3（意味） → STEP4（ネガの具体）
    if (s.step === 3 && token === 's3') {
      const meaning = MEANING_CHOICES[Number(arg)];
      await updateSession(s.id, { step: 4, payload: { ...(s.payload||{}), s3_meaning: meaning }});

      const domain = (s.payload?.s1_domain) || DEEP_DOMAINS[0];
      const { data: tmpl } = await supabase
        .from('deep_templates')
        .select('s4_neg_choices')
        .eq('topic_key', s.topic_key)
        .single();

      const negs = tmpl?.s4_neg_choices?.[domain] || [];
      const items = negs.map((lb,i)=>({label:lb, data:`deep:${s.id}:s4:${i}`}));
      items.push({label:'パス', data:`deep:${s.id}:pass`});

      await client.replyMessage(event.replyToken, {
        type:'text',
        text:'反対に“これはちょっと…”に近いのは？',
        quickReply: qrItems(items)
      });
      return;
    }

    // STEP4（ネガ） → STEP5（影響）
    if (s.step === 4 && token === 's4') {
      const domain = (s.payload?.s1_domain) || DEEP_DOMAINS[0];
      const { data: tmpl } = await supabase
        .from('deep_templates')
        .select('s4_neg_choices')
        .eq('topic_key', s.topic_key)
        .single();

      const negs = tmpl?.s4_neg_choices?.[domain] || [];
      const picked = negs[Number(arg)];
      await updateSession(s.id, { step: 5, payload: { ...(s.payload||{}), s4_neg: picked }});

      await client.replyMessage(event.replyToken, {
        type:'text',
        text:'それ、今も影響ある？',
        quickReply: qrItems(IMPACT_CHOICES.map((lb,i)=>({label:lb, data:`deep:${s.id}:s5:${i}`})))
      });
      return;
    }

    // STEP5（影響） → STEP6（リフレーム）
    if (s.step === 5 && token === 's5') {
      const impact = IMPACT_CHOICES[Number(arg)];
      await updateSession(s.id, { step: 6, payload: { ...(s.payload||{}), s5_impact: impact }});

      await client.replyMessage(event.replyToken, {
        type:'text',
        text:'親の立場を想像すると、どれに近い？',
        quickReply: qrItems(REFRAME_CHOICES.map((lb,i)=>({label:lb, data:`deep:${s.id}:s6:${i}`})))
      });
      return;
    }

    // STEP6（リフレーム） → STEP7（要約・完了）
    if (s.step === 6 && token === 's6') {
      const reframe = REFRAME_CHOICES[Number(arg)];
      const full = { ...(s.payload||{}), s6_reframe: reframe };

      // 最終保存＆要約
      await updateSession(s.id, { step: 7, payload: full });

      const summary = await summarizeDeepResult(s.topic_key, full); // 下で関数を追加します

      // deep_runs に確定保存
      await supabase.from('deep_runs').insert({
        group_id: s.group_id,
        user_id: s.assignee_user_id,
        topic_key: s.topic_key,
        results: full,
        summary_shared: summary
      });

      // セッション完了
      await supabase.from('deep_sessions').update({ status:'done' }).eq('id', s.id);

      // 共有＆締め
      await client.replyMessage(event.replyToken, {
        type:'text',
        text: `${summary}\n\nありがと。今日はここまでにゃ。`
      });

      // 翌日の相手への予約は後でON（スケジューラ実装後）
      // await scheduleNextAssignee(s);

      return;
    }

    // パスやスキップ
    if (token === 'pass' || token === 'skip' || token === 'intro_no') {
      await supabase.from('deep_sessions').update({ status:'cancelled' }).eq('id', s.id);
      await client.replyMessage(event.replyToken, { type:'text', text:'今日はここまででOKにゃ。' });
      return;
    }

  }

  // 未対応のPostbackは黙って無視
  return;
}

// ------- 起動 -------

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
