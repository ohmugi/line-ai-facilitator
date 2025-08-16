// server.js (MVP最小版) - ESM前提
// 必要環境変数：LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import express from 'express';
import bodyParser from 'body-parser';
import { Client as LineClient, middleware as lineMiddleware } from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';

// ====== 環境設定 ======
const {
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PORT = 10000,
} = process.env;

if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_CHANNEL_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('環境変数が不足しています。必要: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// LINEクライアント / Supabase
const client = new LineClient({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
});
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ====== 小ユーティリティ ======
const isGroupEvent = (ev) => ev.source?.type === 'group';
const getSessionKey = (ev) => (isGroupEvent(ev) ? ev.source.groupId : ev.source.userId);

// QuickReply itemsを手早く作る
function qrItems(pairs) { // [{label, data}]
  return {
    items: pairs.map(p => ({ type:'action', action:{ type:'postback', label:p.label, data:p.data }})),
  };
}

// ====== ライト質問（2問） ======
// topic: 'food' | 'plan'
// stepの意味：0=開始直後, 1=自由テキスト回答待ち, 2=二択(＋その他)で感情/性質の確認, 3=小さな行動提案, 4=完了/要約済
async function startLiteTopic(groupId, assigneeUserId, topic){
  const { data, error } = await supabase
    .from('lite_sessions')
    .insert({ group_id: groupId, assignee_user_id: assigneeUserId, topic, step: 0, payload: {} })
    .select('*')
    .single();
  if (error) { console.error('startLiteTopic error', error); return; }

  const sid = data.id;
  if (topic === 'food'){
    await client.pushMessage(groupId, {
      type: 'text',
      text: 'もし最近の相手の“はまっている食べ物”を当てるなら？',
      quickReply: qrItems([
        { label:'考える', data:`lite:${sid}:food:answer` },
        { label:'また今度', data:`lite:${sid}:skip` },
      ]),
    });
  } else {
    await client.pushMessage(groupId, {
      type:'text',
      text:'今年中に「一緒にやりたいこと」を一つだけ挙げるなら？',
      quickReply: qrItems([
        { label:'考える', data:`lite:${sid}:plan:answer` },
        { label:'また今度', data:`lite:${sid}:skip` },
      ]),
    });
  }
}

// ====== Webサーバ ======
const app = express();
app.get('/health', (_, res) => res.status(200).send('ok'));

app.post('/webhook', lineMiddleware({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
}), async (req, res) => {
  try {
    const results = await Promise.all((req.body.events || []).map(handleEvent));
    res.json(results);
  } catch (e) {
    console.error('Webhook error', e);
    res.status(500).end();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

// ====== イベント振り分け ======
async function handleEvent(event){
  if (event.type === 'message' && event.message?.type === 'text') {
    return onText(event);
  }
  if (event.type === 'postback') {
    return onPostback(event);
  }
  return null;
}

// ====== テキスト受信 ======
async function onText(event){
  const raw = (event.message.text || '').trim();
  const text = raw.replace(/\s/g, ''); // 全角半角スペース除去
  const groupIdOrUserId = getSessionKey(event);
  const userId = event.source.userId;

  // MVP起動ワード
  if (/^ライト1$/i.test(text)) {
    await startLiteTopic(groupIdOrUserId, userId, 'food');
    return;
  }
  if (/^ライト2$/i.test(text)) {
    await startLiteTopic(groupIdOrUserId, userId, 'plan');
    return;
  }

  // ★「自由テキスト回答待ち（step=1）」のセッションに対する回答をここで受ける
  // 対象は：このユーザーが担当の最新セッションで step=1 のもの（グループ/個チャット両対応）
  const { data: active } = await supabase
    .from('lite_sessions')
    .select('*')
    .eq('group_id', groupIdOrUserId)
    .eq('assignee_user_id', userId)
    .eq('step', 1)
    .order('created_at', { ascending: false })
    .limit(1);
  const s = active?.[0];

  if (s) {
    const userText = (event.message.text || '').trim();
    const payload = { ...(s.payload||{}), userAnswer: userText };
    await supabase.from('lite_sessions').update({ step: 2, payload }).eq('id', s.id);

    if (s.topic === 'food') {
      await client.replyMessage(event.replyToken, {
        type:'text',
        text:`なるほどにゃ。「${userText}」って、“ちょっとした便利さが嬉しい”感じ？ それとも“趣味のこだわり”っぽい？`,
        quickReply: qrItems([
          { label:'便利さ', data:`lite:${s.id}:food:feel_convenience` },
          { label:'こだわり', data:`lite:${s.id}:food:feel_hobby` },
          { label:'どちらでもない', data:`lite:${s.id}:food:feel_none` },
        ]),
      });
    } else {
      await client.replyMessage(event.replyToken, {
        type:'text',
        text:`いいにゃ。「${userText}」は、どちらかと言えば“おだやかに過ごす系”？ それとも“アクティブに動く系”？`,
        quickReply: qrItems([
          { label:'おだやか', data:`lite:${s.id}:plan:mood_calm` },
          { label:'アクティブ', data:`lite:${s.id}:plan:mood_active` },
          { label:'どちらでもない', data:`lite:${s.id}:plan:mood_none` },
        ]),
      });
    }
    return;
  }

  // それ以外のテキストはスルー（MVPでは不要な雑応答はしない）
  return;
}

// ====== Postback受信（ライト質問のみ） ======
async function onPostback(event){
  const data = event.postback?.data || '';
  if (!data.startsWith('lite:')) {
    // MVP版ではlite以外のpostbackは無視
    return;
  }

  const [_, sessionId, topic, token] = data.split(':'); // lite:<sid>:<topic>:<token>
  const { data: s } = await supabase.from('lite_sessions').select('*').eq('id', sessionId).single();
  if (!s) {
    await client.replyMessage(event.replyToken, { type:'text', text:'セッションが見つからないにゃ…' });
    return;
  }

  // STEP0 → “自由テキスト入力へ”
  if (s.step === 0 && token === 'answer') {
    await supabase.from('lite_sessions').update({ step: 1 }).eq('id', s.id);
    await client.replyMessage(event.replyToken, {
      type:'text',
      text: (topic==='food')
        ? '思い浮かんだ“食べ物の名前”をここに送ってみてにゃ'
        : 'やりたいことを短く一言で送ってみてにゃ',
    });
    return;
  }

  // STEP2（2択） → 小さな行動提案へ
  if (s.step === 2) {
    const nextPayload = { ...(s.payload||{}), choice: token };
    await supabase.from('lite_sessions').update({ step: 3, payload: nextPayload }).eq('id', s.id);

    if (topic === 'food') {
      await client.replyMessage(event.replyToken, {
        type:'text',
        text:'よかったら小さく試してみよ？ 次の買い物で1つだけカゴに入れるか、週末ランチで食べにいくか、どっちにする？',
        quickReply: qrItems([
          { label:'次の買い物に追加', data:`lite:${s.id}:food:act_buy` },
          { label:'週末ランチにする', data:`lite:${s.id}:food:act_lunch` },
          { label:'今回は見送り', data:`lite:${s.id}:food:act_skip` },
        ]),
      });
    } else {
      await client.replyMessage(event.replyToken, {
        type:'text',
        text:'小さく前進させるにゃ。今月のカレンダーに仮で入れるか、画像/リンクを1つだけ送り合うか、どっちにする？',
        quickReply: qrItems([
          { label:'カレンダーに仮入れ', data:`lite:${s.id}:plan:act_calendar` },
          { label:'画像/リンクを共有', data:`lite:${s.id}:plan:act_share` },
          { label:'今回は見送り', data:`lite:${s.id}:plan:act_skip` },
        ]),
      });
    }
    return;
  }

  // STEP3（行動選択） → まとめ
  if (s.step === 3 && token?.startsWith('act_')) {
    await supabase.from('lite_sessions').update({ step: 4 }).eq('id', s.id);
    const summary = (topic === 'food')
      ? '今日の小さな一歩：次の買い物 or 週末ランチで試すにゃ。数日後にそっと聞くから、気楽にいこう〜'
      : '今日の小さな一歩：カレンダー仮入れ or 情報1枚の共有にゃ。進んだらそれで十分えらい〜';
    await client.replyMessage(event.replyToken, { type:'text', text: summary });
    return;
  }

  // スキップ
  if (token === 'skip') {
    await supabase.from('lite_sessions').update({ step: 99 }).eq('id', s.id);
    await client.replyMessage(event.replyToken, { type:'text', text:'今日はここまででOKにゃ。' });
    return;
  }

  // それ以外は何もしない（MVPでは分岐を増やさない）
  return;
}
