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
  // 心地よくない感情
  { k:'anger',    e:'😠', l:'怒り' },        // いらだち・憤り・フラストレーション 等
  { k:'sadness',  e:'😢', l:'悲しみ' },      // 喪失感・落胆・孤独 等
  { k:'anxiety',  e:'😟', l:'不安' },        // 緊張・心配・恐れ 等
  { k:'helpless', e:'🥀', l:'無力感' },      // 疲労・混乱・絶望感 等
  { k:'shame',    e:'😞', l:'恥/罪悪感' },   // 後悔・居心地の悪さ 等
  // 心地よい感情
  { k:'joy',      e:'😊', l:'喜び' },        // 嬉しさ・幸せ・達成感 等
  { k:'calm',     e:'😌', l:'安心' },        // 落ち着き・穏やかさ 等
  { k:'vitality', e:'💪', l:'活力' },        // 元気・意欲・熱中 等
  { k:'affection',e:'🤝', l:'愛情' },        // 感謝・親しみ・つながり 等
  { k:'pride',    e:'🏅', l:'誇り' },        // 満足・自信・達成感 等
];

// NVC用 GUIDE（1〜5の言い換え）
const GUIDE = {
  anger:     {1:'小さくいらだつ',2:'やや不快',3:'ほどほど怒る',4:'かなり腹が立つ',5:'強い怒り'},
  sadness:   {1:'少ししょんぼり',2:'やや落ち込む',3:'ほどほど沈む',4:'かなりつらい',5:'深く悲しい'},
  anxiety:   {1:'少しそわそわ',2:'やや不安',3:'落ち着かない',4:'かなり不安',5:'強い恐れ'},
  helpless:  {1:'少し疲れ',2:'やや無力',3:'手につかない',4:'かなり消耗',5:'打ちのめされる'},
  shame:     {1:'少し後悔',2:'やや気まずい',3:'自己否定が出る',4:'かなり恥ずかしい',5:'強い罪悪感'},
  joy:       {1:'小さく嬉しい',2:'けっこう嬉しい',3:'うれしい',4:'とてもうれしい',5:'最高にうれしい'},
  calm:      {1:'少し落ち着く',2:'やや安心',3:'安心できる',4:'だいぶ穏やか',5:'深く安らぐ'},
  vitality:  {1:'少し元気',2:'やや意欲',3:'やる気でる',4:'かなり活発',5:'満ちあふれる'},
  affection: {1:'少しあたたかい',2:'やや親しみ',3:'つながり感じる',4:'強く感謝',5:'胸が熱くなる'},
  pride:     {1:'少し満足',2:'やや誇らしい',3:'誇りを感じる',4:'かなり誇らしい',5:'大きな達成感'},
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
// 文脈抽出（NVCキーをそのまま使う）— 関数名/挙動は同じでOK
async function suggestEmotionCodes(utter){
  const codes = EMOTIONS.map(e=>e.k);
  const prompt = `次の文章に最も近い感情カテゴリを上位3件、以下のキーから返す（カンマ区切り、キーのみ）:
${codes.join(',')}
文章: ${utter}`;
  try {
    const r = await openai.chat.completions.create({
      model:'gpt-4o-mini', temperature:0.2,
      messages:[{role:'user', content: prompt}]
    });
    const picked = (r.choices?.[0]?.message?.content||'')
      .split(',').map(s=>s.trim()).filter(k=>codes.includes(k));
    return picked.length ? picked : ['joy','calm','affection','pride'];
  } catch {
    return ['joy','calm','affection','pride'];
  }
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
    // ef:emo後のガイド（NVCの言い換えを使用／1〜5）
const guide = GUIDE[ek]
  ? `\n例）1:${GUIDE[ek][1]} / 3:${GUIDE[ek][3]} / 5:${GUIDE[ek][5]}`
  : `\n例）1=ごく弱い / 3=ほどほど / 5=とても強い`;

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
