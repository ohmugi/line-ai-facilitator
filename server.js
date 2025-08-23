
import express from 'express';
import bodyParser from 'body-parser';
import { middleware, Client } from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';

const app = express();



// --- LINE設定 ---
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new Client(config);

const supabase = createClient(
  process.env.SUPABASE_URL,
  // サーバ側は Service Role を推奨（RLSを気にしない）
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// 失敗しても体験は続行するログ関数
async function safeInsert(table, values){
  try { await supabase.from(table).insert(values); }
  catch(e){ console.error(`[DB] insert ${table} fail:`, e?.message || e); }
}
async function safeUpdate(table, patch, match){
  try { await supabase.from(table).update(patch).match(match); }
  catch(e){ console.error(`[DB] update ${table} fail:`, e?.message || e); }
}
async function logEvent(event, meta){
  await safeInsert('empathy_logs', { event, meta });
}

// --- セッション（超簡易：メモリ保持）---
// key: groupId(or userId)
const sessions = new Map();

// --- 定数（感情セット＆ガイド）---
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

// --- ユーティリティ ---
function gidOf(event){
  return event.source.type === 'group' ? event.source.groupId : event.source.userId;
}
function brief(text, max=25){
  const t=(text||'').trim();
  if (!t) return '';
  const s = t.split('。')[0] || t;
  return s.slice(0,max);
}
function empathyLine(text){
  const posHint = /うれ|嬉|助か|安心|良|ほっと|ありがとう|感謝|ワクワク|楽し/.test(text||'');
  return posHint ? 'それはうれしかったね' : 'それは大変だったね';
}
function intensityBucket(n){
  if ([1,3,5,7,10].includes(n)) return n;
  if (n<=2) return 1;
  if (n<=4) return 3;
  if (n<=6) return 5;
  if (n<=8) return 7;
  return 10;
}
function emotionButtons(){
  const items = EMOTIONS.map(m => ({
    type:'action',
    action:{ type:'postback', label:`${m.e}${m.l}`, data:`ef:emo:${m.k}` }
  }));
  items.push({ type:'action', action:{ type:'postback', label:'❓どれでもない', data:'ef:other' }});
  return items;
}
function numberButtons(){
  return Array.from({length:10}, (_,i)=>i+1).map(n => ({
    type:'action', action:{ type:'postback', label:String(n), data:`ef:int:${n}` }
  }));
}


// 全体はJSONで処理
app.use(express.json());
app.post('/webhook',
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


async function handleEvent(event){
  if (event.type==='message' && event.message?.type==='text') return onText(event);
  if (event.type==='postback') return onPostback(event);
}

async function onText(event){
  const gid = gidOf(event);
  const text = (event.message.text||'').trim();

  // セッション取得/初期化
  const s = sessions.get(gid) || { step:0, payload:{} };

  // S1: 吐き出し受信
  if (s.step===0 || s.step===6){
    if (!text){
      await client.replyMessage(event.replyToken, { type:'text', text:'短くで大丈夫だよ。今日は何があった？' });
      sessions.set(gid, { step:0, payload:{} });
      return;
    }
    // S2: 共感応答 → つづける
await logEvent('message_received', { length: text.length, at: Date.now() });
const empathy = empathyLine(text);

// DB: セッションrowを作成（S2状態で保存）
let dbSessionId = null;
try{
  const { data, error } = await supabase
    .from('empathy_sessions')
    .insert({ group_id: gid, user_id: event.source.userId, step: 2, payload: { utter: text } })
    .select('id')
    .single();
  if (!error) dbSessionId = data.id;
}catch(e){ console.error('[DB] create session fail:', e?.message || e); }

// メモリ側にもDBのidを保持
sessions.set(gid, { step:2, payload:{ utter:text, db_session_id: dbSessionId }});

// 共感表示＋極性ログ
await logEvent('empathy_shown', { polarity: empathy.includes('うれ') ? 'pos' : 'neg' });

await client.replyMessage(event.replyToken, {
  type:'text',
  text: empathy,
  quickReply:{ items:[{ type:'action', action:{ type:'postback', label:'つづける', data:'ef:pick' }}] }
});
    return;
  }

  // 「どれでもない」後の自由入力
  if (s.step===3 && s.payload?.emotion_key==='other'){
    const ek = 'other';
const otherLabel = text.slice(0,10);
sessions.set(gid, { step:4, payload:{ ...s.payload, emotion_key:ek, other_label:otherLabel }});

// DB: 感情選択を保存（otherとして）
if (s.payload?.db_session_id){
  await safeUpdate('empathy_sessions',
    { step: 4, payload: { ...(s.payload||{}), emotion_key: ek, other_label: otherLabel } },
    { id: s.payload.db_session_id }
);
}
await logEvent('emotion_chosen', { label: 'other', custom: otherLabel });

await client.replyMessage(event.replyToken, {
  type:'text',
  text:'その気持ちはどれくらい強かった？（1〜10）',
  quickReply:{ items: numberButtons() }
});
    return;
  }

  // それ以外のテキストは無視してS2〜S4の誘導を維持
  await client.replyMessage(event.replyToken, { type:'text', text:'近い気持ちを1つ選んでね' });
}

async function onPostback(event){
  const gid = gidOf(event);
  const data = event.postback?.data || '';
  const s = sessions.get(gid) || { step:0, payload:{} };
  const replyToken = event.replyToken;

  if (!data.startsWith('ef:')) return;

  const [, cmd, arg] = data.split(':'); // pick / emo:<k> / int:<n> / other

  if (cmd==='pick'){
    sessions.set(gid, { step:3, payload: s.payload });
    await client.replyMessage(replyToken, {
      type:'text',
      text:'近い気持ちはどれかな？',
      quickReply:{ items: emotionButtons() }
    });
    return;
  }

  if (cmd==='other'){
    sessions.set(gid, { step:3, payload:{ ...s.payload, emotion_key:'other' }});
    await client.replyMessage(replyToken, { type:'text', text:'どんな気持ちにいちばん近い？短くでOKだよ' });
    return;
  }

  if (cmd==='emo'){
    const ek = arg;
sessions.set(gid, { step:4, payload:{ ...s.payload, emotion_key:ek }});

if (s.payload?.db_session_id){
  await safeUpdate('empathy_sessions',
    { step: 4, payload: { ...(s.payload||{}), emotion_key: ek } },
    { id: s.payload.db_session_id }
  );
}
await logEvent('emotion_chosen', { label: ek });

await client.replyMessage(replyToken, {
  type:'text',
  text:'その気持ちはどれくらい強かった？（1〜10）',
  quickReply:{ items: numberButtons() }
});
    return;
  }

  if (cmd==='int'){
  const n = Number(arg);
  await logEvent('intensity_chosen', { value: n });

  const ek = s.payload?.emotion_key || 'hazy';
  const utter = s.payload?.utter || '';
  const bucket = intensityBucket(n);

  const label = ek==='other' ? (s.payload?.other_label || 'その気持ち') : (EMOTIONS.find(e=>e.k===ek)?.l || 'その気持ち');
  const gtext = GUIDE[ek]?.[bucket];
  if (gtext){
    await client.pushMessage(gid, { type:'text', text:`“${label}${bucket}”は、${gtext}くらいの感じだよ` });
  }

  const poi = brief(utter, 25);
  const phrase = gtext || '';
  const summary = `${poi}のとき、${phrase}んだね`.slice(0,45);

  sessions.set(gid, { step:6, payload:{ utter, emotion_key:ek, intensity:n, summary, db_session_id: s.payload?.db_session_id }});

  if (s.payload?.db_session_id){
    await safeUpdate('empathy_sessions',
      { step: 6, payload: { ...(s.payload||{}), intensity: n, summary } },
      { id: s.payload.db_session_id }
    );
  }
  await safeInsert('empathy_runs', {
    group_id: gid,
    user_id: event.source.userId,
    utter,
    emotion_key: ek,
    intensity: n,
    summary_shared: summary
  });
  await logEvent('summary_shown', { length: summary.length });

  await client.replyMessage(replyToken, { type:'text', text: summary });
  return;
}
  }

// --- 起動 ---
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
// --- health check & root ---
app.get('/', (_req, res) => res.status(200).send('Kemii MVP OK'));
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
app.listen(PORT, HOST, () => console.log(`Kemii MVP listening on ${HOST}:${PORT}`));
