// server.js（Kemii MVP：共感＆まとめを毎回API生成）

import express from 'express';
import bodyParser from 'body-parser';
import { middleware, Client } from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const app = express();

// ---- Health endpoints (Renderのヘルスチェック用) ----
app.get('/', (_req, res) => res.status(200).send('Kemii MVP OK'));
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
app.head('/webhook', (_req, res) => res.status(200).end());

// ---- LINE設定 ----
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new Client(config);

// ---- Supabase設定 ----
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// ---- OpenAI設定 ----
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- ログ: 失敗しても体験継続 ----
async function safeInsert(table, values) {
  try { await supabase.from(table).insert(values); }
  catch (e) { console.error(`[DB] insert ${table} fail:`, e?.message || e); }
}
async function safeUpdate(table, patch, match) {
  try { await supabase.from(table).update(patch).match(match); }
  catch (e) { console.error(`[DB] update ${table} fail:`, e?.message || e); }
}
async function logEvent(event, meta) {
  await safeInsert('empathy_logs', { event, meta });
}

// ---- セッション（超簡易：メモリ保持）----
const sessions = new Map();

// ---- 定数（感情セット＆ガイド）----
const EMOTIONS = [
  { k:'relief', e:'😄', l:'ほっとした' },
  { k:'joy',    e:'😍', l:'うれしい' },
  { k:'excite', e:'🤩', l:'ワクワク' },
  { k:'warm',   e:'😊', l:'じんわり' },
  { k:'irrit',  e:'😤', l:'イライラ' },
  { k:'sad',    e:'😔', l:'しょんぼり' },
  { k:'rush',   e:'😓', l:'あたふた' },
  { k:'hazy',   e:'😒', l:'もやもや' },
];
const GUIDE = {
  joy:   {1:'ちょっとニコッ',3:'小さなラッキー',5:'ふわっと上がる',7:'いい日だなって思える',10:'飛び上がるくらい最高'},
  relief:{1:'肩の力が抜けた',3:'小さく安心',5:'息がつけた',7:'すーっと軽くなった',10:'解放されたみたい'},
  excite:{1:'少し楽しみ',3:'小さくドキドキ',5:'待ち遠しい',7:'ソワソワしてくる',10:'眠れないほどドキドキ'},
  warm:  {1:'軽くありがとう',3:'ちょっとあたたかい',5:'ぽかぽか満たされる',7:'胸にしみる',10:'涙が出そうな感謝'},
  irrit: {1:'少し眉をひそめる',3:'小さくカチン',5:'しばらく残る不快',7:'積もってざわつく',10:'爆発しそう'},
  sad:   {1:'軽くがっかり',3:'少し落ちる',5:'手につかない',7:'胸が重い',10:'締めつけられるほど'},
  rush:  {1:'少し急かされる',3:'ソワソワ',5:'余裕がない',7:'何をすべきか迷う',10:'パニックみたい'},
  hazy:  {1:'小さな引っかかり',3:'落ち着かない',5:'何度も思い返す',7:'一日中スッキリしない',10:'心が曇りっぱなし'},
};

// ---- ユーティリティ ----
function gidOf(event) {
  return event.source.type === 'group' ? event.source.groupId : event.source.userId;
}
function intensityBucket(n) {
  if ([1,3,5,7,10].includes(n)) return n;
  if (n <= 2) return 1;
  if (n <= 4) return 3;
  if (n <= 6) return 5;
  if (n <= 8) return 7;
  return 10;
}
function buildEmotionCarousel(codes){
  const columns = codes.slice(0,4).map(k => {
    const m = EMOTIONS.find(x=>x.k===k);
    return {
      thumbnailImageUrl: 'https://dummyimage.com/600x400/ffffff/000.png&text=kemii',
      title: m.l,
      text: '当てはまらなければ「どれでもない」で自由入力OKだよ',
      actions: [
        { type:'postback', label:'これにする', data:`ef:emo:${k}`, displayText:`${m.l}` }
      ]
    };
  });
  columns.push({
    thumbnailImageUrl: 'https://dummyimage.com/600x400/ffffff/000.png&text=?',
    title: 'どれでもない',
    text: '自由に入力してOKだよ（短くで大丈夫）',
    actions: [{ type:'postback', label:'自由入力する', data:'ef:other', displayText:'どれでもない' }]
  });
  return { type:'template', altText:'感情を選んでね', template:{ type:'carousel', columns } };
}
function buildIntensityButtons(code){
  const make = n => ({ type:'postback', label:String(n), data:`ef:int:${n}`, displayText:`${n}` });
  return {
    type:'template',
    altText:'強さを選んでね',
    template:{ type:'buttons', title:'強さ（1/3/5/7/10）', text: GUIDE[code] ? '1=弱い / 5=けっこう / 10=とても' : '1/3/5/7/10から選んでね', actions:[make(1),make(3),make(5),make(7)] }
  };
}
function buildIntensityButton10(code){
  return { type:'template', altText:'さらに強い？', template:{ type:'buttons', title:'最高レベル？', text:'最高なら「10」を選んでね', actions:[{ type:'postback', label:'10', data:`ef:int:10`, displayText:'10' }] } };
}

// ---- OpenAI生成系 ----
async function generateEmpathy(message){
  const prompt = `次の発話に対して、1〜2文の自然な共感を返してください。
- ポジなら「おめでとう！」など
- ネガなら「大変だったね」など
- 曖昧なら「そっか〜」など
発話: ${message}`;
  const r = await openai.chat.completions.create({
    model:'gpt-4o-mini',
    messages:[{role:'user',content:prompt}],
    temperature:0.3
  });
  return (r.choices?.[0]?.message?.content || 'そっか、そうだったんだね').trim();
}

async function generateSummary({ utter, label, bucket }){
  const scale = {1:'とても弱い',3:'やや弱い',5:'ほどほど',7:'かなり強い',10:'とても強い'}[bucket] || 'ほどほど';
  const prompt = `次の出来事と感情を、1〜2文で自然な日本語にまとめてください。
- 数字は言い換えて
- 「〜だったみたい」を使ってOK
- 最後に軽くねぎらいを一言
出来事: ${utter}
感情: ${label}（強さ:${scale}）`;
  try{
    const r = await openai.chat.completions.create({
      model:'gpt-4o-mini',
      messages:[{role:'user',content:prompt}],
      temperature:0.3
    });
    return (r.choices?.[0]?.message?.content || `${label}だったみたい。ありがとうね`).trim();
  }catch{
    return `${label}だったみたい。ありがとうね`;
  }
}

// ---- Webhook ----
app.post(
  '/webhook',
  bodyParser.raw({ type: '*/*' }),
  middleware(config),
  async (req, res) => {
    const events = req.body.events || [];
    try {
      await Promise.all(events.map(handleEvent));
      res.status(200).end();
    } catch (e) {
      console.error('❌ Webhook error:', e?.response?.data || e.message || e);
      res.status(200).end();
    }
  }
);

async function handleEvent(event) {
  if (event.type === 'message' && event.message?.type === 'text') return onText(event);
  if (event.type === 'postback') return onPostback(event);
  return;
}

// ---- Message ----
async function onText(event) {
  const gid = gidOf(event);
  const text = (event.message.text || '').trim();
  const s = sessions.get(gid) || { step: 0, payload: {} };

  // S1
  if (s.step === 0 || s.step === 6) {
    if (!text) {
      await client.replyMessage(event.replyToken, { type:'text', text:'短くで大丈夫だよ。今日は何があった？' });
      sessions.set(gid, { step: 0, payload: {} });
      return;
    }

    await logEvent('message_received', { length: text.length, at: Date.now() });
    const empathy = await generateEmpathy(text);

    // DBセッション保存
    let dbSessionId = null;
    try {
      const { data } = await supabase
        .from('empathy_sessions')
        .insert({ group_id: gid, user_id: event.source.userId, step: 2, payload: { utter: text } })
        .select('id').single();
      dbSessionId = data?.id;
    } catch(e){ console.error('[DB] create session fail:', e?.message || e); }

    sessions.set(gid, { step: 2, payload: { utter: text, db_session_id: dbSessionId } });

    await client.replyMessage(event.replyToken, { type:'text', text: empathy });
    await client.pushMessage(gid, { type:'text', text:'近い気持ちを1つ選んでね（当てはまらなければ「どれでもない」→自由入力OK）' });
    await client.pushMessage(gid, buildEmotionCarousel(EMOTIONS.map(e=>e.k)));
    return;
  }

  // 自由入力
  if (s.step === 3 && s.payload?.emotion_key === 'other') {
    const ek = 'other';
    const otherLabel = text.slice(0, 10);
    const nextPayload = { ...s.payload, emotion_key: ek, other_label: otherLabel };
    sessions.set(gid, { step: 4, payload: nextPayload });

    if (s.payload?.db_session_id) {
      await safeUpdate('empathy_sessions',{ step: 4, payload: nextPayload },{ id: s.payload.db_session_id });
    }
    await logEvent('emotion_chosen', { label:'other', custom: otherLabel });

    const guide = GUIDE[ek] ? `\n例）1:${GUIDE[ek][1]} / 5:${GUIDE[ek][5]} / 10:${GUIDE[ek][10]}` : '';
    await client.replyMessage(event.replyToken, { type:'text', text:`${otherLabel} の強さはどれくらい？${guide}` });
    await client.pushMessage(gid, buildIntensityButtons(ek));
    await client.pushMessage(gid, buildIntensityButton10(ek));
    return;
  }

  await client.replyMessage(event.replyToken, { type:'text', text:'当てはまらないときは、近い気持ちの名前を自由入力してね' });
}

// ---- Postback ----
async function onPostback(event) {
  const gid = gidOf(event);
  const data = event.postback?.data || '';
  const s = sessions.get(gid) || { step: 0, payload: {} };
  const replyToken = event.replyToken;
  if (!data.startsWith('ef:')) return;
  const [, cmd, arg] = data.split(':');

  if (cmd === 'other') {
    sessions.set(gid, { step: 3, payload: { ...s.payload, emotion_key:'other' } });
    await client.replyMessage(replyToken, { type:'text', text:'当てはまらないときは気持ちを自由入力してね' });
    return;
  }

  if (cmd === 'emo') {
    const ek = arg;
    const nextPayload = { ...s.payload, emotion_key: ek };
    sessions.set(gid, { step: 4, payload: nextPayload });
    if (s.payload?.db_session_id) {
      await safeUpdate('empathy_sessions',{ step: 4, payload: nextPayload },{ id: s.payload.db_session_id });
    }
    await logEvent('emotion_chosen', { label: ek });

    const label = EMOTIONS.find(e=>e.k===ek)?.l || 'その気持ち';
    const guide = GUIDE[ek] ? `\n例）1:${GUIDE[ek][1]} / 5:${GUIDE[ek][5]} / 10:${GUIDE[ek][10]}` : '';
    await client.replyMessage(replyToken, { type:'text', text:`${label} の強さはどれくらい？${guide}` });
    await client.pushMessage(gid, buildIntensityButtons(ek));
    await client.pushMessage(gid, buildIntensityButton10(ek));
    return;
  }

  if (cmd === 'int') {
    const n = Number(arg);
    await logEvent('intensity_chosen', { value:n });
    const ek = s.payload?.emotion_key || 'hazy';
    const utter = s.payload?.utter || '';
    const bucket = intensityBucket(n);
    const label = ek === 'other' ? (s.payload?.other_label || 'その気持ち') : (EMOTIONS.find(e=>e.k===ek)?.l || 'その気持ち');

    const summary = await generateSummary({ utter, label, bucket });

    const nextPayload = { utter, emotion_key: ek, intensity: n, summary, db_session_id: s.payload?.db_session_id };
    sessions.set(gid, { step: 6, payload: nextPayload });
    if (s.payload?.db_session_id) {
      await safeUpdate('empathy_sessions',{ step: 6, payload: nextPayload },{ id: s.payload.db_session_id });
    }
    await safeInsert('empathy_runs',{ group_id:gid, user_id:event.source.userId, utter, emotion_key:ek, intensity:n, summary_shared:summary });
    await logEvent('summary_shown', { length: summary.length });
    await client.replyMessage(replyToken, { type:'text', text: summary });
    return;
  }
}

// ---- 起動 ----
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`Kemii MVP listening on ${PORT}`));
