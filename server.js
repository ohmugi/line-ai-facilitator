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




// ---- ユーティリティ ----
function gidOf(event) {
  return event.source.type === 'group' ? event.source.groupId : event.source.userId;
}
// 強さのバケット（1〜5に統一）
function intensityBucket(n) {
  const v = Number(n) || 3;
  if (v <= 1) return 1;
  if (v === 2) return 2;
  if (v === 3) return 3;
  if (v === 4) return 4;
  return 5;
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

  // 感情別ガイド（NVC 10カテゴリ×1..5）
const GUIDE = {
  anger: { // 怒り
    1:'小さくいらだつ（表情に出ない）',
    2:'やや不快（短くチクリとする）',
    3:'はっきり怒る（言葉がきつくなる）',
    4:'かなり腹立つ（声量・口調が強くなる）',
    5:'強い怒り（今は対話が難しい）',
  },
  sadness: { // 悲しみ
    1:'少ししょんぼり（ため息が出る）',
    2:'やや落ち込む（気持ちが下向き）',
    3:'胸が重い（集中しづらい）',
    4:'かなりつらい（涙が出そう）',
    5:'深く悲しい（何も手につかない）',
  },
  anxiety: { // 不安
    1:'少しそわそわ（注意が散る）',
    2:'やや不安（同じことを考え直す）',
    3:'落ち着かない（身体に緊張を感じる）',
    4:'かなり不安（最悪の想像が浮かぶ）',
    5:'強い恐れ（眠れない/手がつかない）',
  },
  helpless: { // 無力感
    1:'少し疲れ（気力はある）',
    2:'やや無力（腰が重い）',
    3:'手につかない（先延ばしが増える）',
    4:'かなり消耗（簡単なことも負担）',
    5:'打ちのめされる（動けない）',
  },
  shame: { // 恥/罪悪感
    1:'少し気まずい（顔を伏せたくなる）',
    2:'やや後悔（やり直したい気持ち）',
    3:'自己否定が出る（自分を責める）',
    4:'かなり恥ずかしい（人目を避けたい）',
    5:'強い罪悪感（居ても立ってもいられない）',
  },
  joy: { // 喜び
    1:'小さくうれしい（口元が緩む）',
    2:'けっこううれしい（誰かに言いたい）',
    3:'うれしい（気分が上向く）',
    4:'とてもうれしい（体が軽い）',
    5:'最高にうれしい（飛び上がりたい）',
  },
  calm: { // 安心
    1:'少し落ち着く（肩の力が抜ける）',
    2:'やや安心（呼吸が整う）',
    3:'安心できる（視野が広がる）',
    4:'だいぶ穏やか（余裕が戻る）',
    5:'深く安らぐ（安心感で満たされる）',
  },
  vitality: { // 活力
    1:'少し元気（手をつけられる）',
    2:'やや意欲（動き出せる）',
    3:'やる気が出る（ペースが上がる）',
    4:'かなり活発（工夫が湧く）',
    5:'満ちあふれる（次々やりたい）',
  },
  affection: { // 愛情/つながり
    1:'少しあたたかい（ほっとする）',
    2:'やや親しみ（距離が近く感じる）',
    3:'つながりを感じる（心が柔らぐ）',
    4:'強く感謝（胸が熱くなる）',
    5:'深い愛情（涙が出るほどうれしい）',
  },
  pride: { // 誇り/満足
    1:'少し満足（うまくいった）',
    2:'やや誇らしい（自分を認められる）',
    3:'誇りを感じる（努力が報われた）',
    4:'かなり誇らしい（人に伝えたい）',
    5:'大きな達成感（自分を誇れる）',
  },
};


 // 強さカルーセル（感情別説明を使用）
function buildIntensityCarousel(code){
  const g = GUIDE[code] || {1:'ごく弱い',2:'やや弱い',3:'ほどほど',4:'かなり強い',5:'とても強い'};
  const columns = [1,2,3,4,5].map(n => ({
    thumbnailImageUrl: `https://dummyimage.com/600x400/ffffff/000.png&text=${n}`,
    title: `強さ ${n}`,
    text: g[n], // ← 感情別
    actions: [{ type:'postback', label:String(n), data:`ef:int:${n}`, displayText:String(n) }]
  }));
  return { type:'template', altText:'強さを選んでね', template:{ type:'carousel', columns } };
}


  return {
    type:'template',
    altText:'強さを選んでね',
    template:{ type:'carousel', columns }
  };




// ---- OpenAI生成系 ----
// 新：2–3文に増量（gpt-4o-mini）
async function generateEmpathyLong(message){
  const prompt = `次の発話に、自然で温かい共感を2〜3文で返してください。
- ポジなら喜びを一緒に味わう
- ネガなら労いと受容
- 中立なら丁寧に受け止める
- 過度に大げさにしない／絵文字なし
発話: ${message}`;
  const r = await openai.chat.completions.create({
    model:'gpt-4o-mini', temperature:0.25,
    messages:[{role:'user',content:prompt}]
  });
  return (r.choices?.[0]?.message?.content || 'そっか、そうだったんだね。話してくれてうれしいよ。').trim();
}
// 800msで間に合わない時はローカル共感にフォールバック（ACKを遅らせない）
function localEmpathy(msg=''){
  const pos = /(楽し|嬉|良さ|ワクワク|合格|できた|助か|ありがとう)/.test(msg);
  const neg = /(疲れ|大変|困|不安|悲|落ち込|つら|怒|失敗)/.test(msg);
  if (pos) return 'それ、いい時間になりそうだね。うれしさが伝わってきたよ。どんなところが楽しみ？';
  if (neg) return 'それは本当に大変だったね。ここまで頑張ってきたこと、ちゃんと伝わってるよ。';
  return 'なるほど、そういうことがあったんだね。気持ちをことばにしてくれて、ありがとう。';
}
async function generateEmpathySmart(message){
  return await Promise.race([
    generateEmpathyLong(message),
    new Promise(res=>setTimeout(()=>res(localEmpathy(message)), 800))
  ]);
}


// まとめ生成（新：1〜5用／“惜しい”改善）
async function generateSummary({ utter, label, bucket }){
  const scale = {1:'ごく弱い',2:'やや弱い',3:'ほどほど',4:'かなり強い',5:'とても強い'}[bucket] || 'ほどほど';
  const prompt = `次の出来事と感情を、自然で読みやすい日本語で1〜2文にまとめてください。
- 事実→感情の順で簡潔に
- 強さは「ごく弱い/ほどほど/とても強い」などに言い換え
- 過度に断定せず「〜みたい」「〜だったかも」を許容
- 最後に一言ねぎらい（例:「話してくれてありがとう」）
出来事: ${utter}
感情: ${label}（強さ:${scale}）`;
  try{
    const r = await openai.chat.completions.create({
      model:'gpt-4o-mini', temperature:0.25,
      messages:[{role:'user',content:prompt}]
    });
    return (r.choices?.[0]?.message?.content || `${label}だったみたい。話してくれてありがとう。`).trim();
  }catch{
    return `${label}だったみたい。話してくれてありがとう。`;
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
    // onText S1（即時ACK→後追いpushでタイムアウト回避）
// onText S1（最初から共感を返す｜長文・フォールバック付）
const empathy = await generateEmpathySmart(text);
await client.replyMessage(event.replyToken, { type:'text', text: empathy });
await client.pushMessage(gid, { type:'text', text:'近い気持ちを1つ選んでね（当てはまらなければ「どれでもない」→自由入力OK）' });
// 新：toneを推定→NVCのポジ/ネガから上位3をAPI選定
const cand = await suggestEmotionCodes(text);
await client.pushMessage(gid, buildEmotionCarousel(cand));
// 新規：文脈抽出（トーン判定＋キー3つをJSONで返させる）
async function suggestEmotionCodes(utter){
  const POS = ['joy','calm','vitality','affection','pride'];
  const NEG = ['anger','sadness','anxiety','helpless','shame'];
  const ALL = [...POS, ...NEG];
  const prompt = `文章のトーンを positive/negative/neutral のいずれかで判定し、
そのトーンに合う次の感情キーから上位3件を返してください（JSONのみ）:
keys: ${ALL.join(',')}
出力例: {"tone":"positive","codes":["joy","calm","affection"]}
文章: ${utter}`;
  try{
    const r = await openai.chat.completions.create({
      model:'gpt-4o-mini', temperature:0.2,
      messages:[{role:'user',content:prompt}]
    });
    const txt = r.choices?.[0]?.message?.content||'{}';
    const j = JSON.parse(txt);
    let pool = ALL;
    if (j.tone==='positive') pool = POS;
    if (j.tone==='negative') pool = NEG;
    const picked = (j.codes||[]).filter(k=>pool.includes(k));
    // フォールバック：ポジ出来事ならポジ側
    if (!picked.length){
      const guessPos = /(楽し|嬉|良さ|ワクワク|合格|助か|安堵)/.test(utter);
      return (guessPos?POS:NEG).slice(0,3);
    }
    return picked.slice(0,3);
  }catch{
    return ['joy','calm','affection'];
  }
}


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
    // ef:emo後（カルーセルで提示）
await client.replyMessage(replyToken, { type:'text', text:`${label} の強さはどれくらい？` });
await client.pushMessage(gid, buildIntensityCarousel(ek));

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
// ef:emo 後の案内（1〜5に統一）
const guide = GUIDE[ek]
  ? `\n例）1:${GUIDE[ek][1]} / 3:${GUIDE[ek][3]} / 5:${GUIDE[ek][5]}`
  : `\n例）1=ごく弱い / 3=ほどほど / 5=とても強い`;

await client.replyMessage(replyToken, { type:'text', text:`${label} の強さはどれくらい？${guide}` });
await client.pushMessage(gid, buildIntensityButtons(ek));

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
