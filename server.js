// すべてのHTTPアクセスを1行ログ（/healthz も /webhook も）
app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});


// server.js

import express from 'express';
import { middleware, Client } from '@line/bot-sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);
const app = express();

// ---- LINE設定 ----（LINE_* / CHANNEL_* どちらの命名でも拾う）
const config = {
  channelAccessToken:
    process.env.CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret:
    process.env.CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.warn('[BOOT] LINE env missing:', {
    hasToken: !!config.channelAccessToken,
    hasSecret: !!config.channelSecret,
  });
}
const client = new Client(config);


// ---- OpenAI ----
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- セッション管理 ----
const sessions = new Map();

// ---- ざっくり極性（ポジ/ネガ/中立）推定：軽量辞書 ----
const NEG_HINTS = ['しんど','つら','辛','だる','不快','嫌','ムカ','むずむず','痛','鼻水','鼻づまり','咳','くしゃみ','頭痛','熱','発熱','寒気','花粉','アレルギ','疲れ','疲労','最悪','泣'];
const POS_HINTS = ['うれし','嬉し','助か','よかった','良かった','最高','楽しい','喜び','安心','感謝','ありがとう','ほっと','救われ','楽しみ','期待','褒め','できた','達成'];

function getSentimentRough(text='') {
  const t = text.toLowerCase();
  const neg = NEG_HINTS.some(k => t.includes(k));
  const pos = POS_HINTS.some(k => t.includes(k));
  if (neg && !pos) return 'negative';
  if (pos && !neg) return 'positive';
  return 'neutral';
}

// ---- 6感情の固定セット（POS2＋NEG4） ----
const POS_KEYS = ['joy','gratitude'];
const NEG_KEYS = ['anger','moyamoya','sadness','anxiety'];


// 並び順：ネガティブならネガ先頭、ポジティブならポジ先頭
function orderedSixBySentiment(sentiment) {
  if (sentiment === 'negative') return [...NEG_KEYS, ...POS_KEYS];
  if (sentiment === 'positive') return [...POS_KEYS, ...NEG_KEYS];
  return [...POS_KEYS, ...NEG_KEYS]; // neutral はポジ先頭
};


// 出来事テキストを軽く整形（句点削除など）
function tidyEventText(raw=''){
  const t = String(raw).trim().replace(/\s+/g,' ');
  return t.replace(/[。.!?]+$/,'');
}

// 出来事の「て形／で」への簡易変換
// 例: 「おいしかった」→「おいしくて」, 「〜でした」→「〜で」
function toTeJoin(text=''){
  let s = tidyEventText(text);

  // i形容詞「〜かった」→「〜くて」
  s = s.replace(/([ぁ-んァ-ーン一-龠A-Za-z0-9]+?)かった$/,'$1くて');

  // よくある言い回しの個別ケア（よかった→よくて 等）
  s = s.replace(/よかった$/,'よくて');

  // 名詞述語「〜でした/だった」→「〜で」
  s = s.replace(/でした?$/,'で').replace(/だった$/,'で');

  // 末尾が既に「で/て」ならそのまま、そうでなければ「で」を追加
  if (!/(で|て)$/.test(s)) s = s + 'で';
  return s;
}

// 最終文を合成（例：「昼ご飯がおいしくてけっこううれしかったのね。話してくれてありがとうにゃ」）
function renderFeelingSentence(eventText, ek, intensity){
  const lead = toTeJoin(eventText);       // 〜で／〜て
  const adv  = intensityAdverb(intensity);
  const pred = emotionPredicate(ek);      // 〜うれしかった など（過去形）
  const advStr = adv ? adv : '';
  return `${lead}${advStr}${pred}のね。話してくれてありがとうにゃ`;
}


// ---- 感情カテゴリ（6種に整理） ----
const EMOTIONS = [
  { k:'joy',      l:'嬉しい',   desc:'うれしさ・満足感' },
  { k:'gratitude',l:'感謝',     desc:'ありがたい・助かった・大事にされた感覚' },

  { k:'anger',    l:'イライラ', desc:'カチンとする・思い通りにいかない' },
  { k:'moyamoya', l:'モヤモヤ', desc:'はっきり言えない違和感・納得いかない感じ' },
  { k:'sadness',  l:'悲しい',   desc:'傷ついた・がっかり・孤独' },
  { k:'anxiety',  l:'不安',     desc:'心配・落ち着かない・そわそわ' },
];

// ---- 感情別強さガイド ----
const GUIDE = {
  joy: {
    1:'少しうれしい',
    2:'けっこううれしい',
    3:'うれしい',
    4:'とてもうれしい',
    5:'最高にうれしい',
  },
  gratitude: {
    1:'ちょっとありがたい',
    2:'ありがたい',
    3:'とても感謝している',
    4:'深く感謝している',
    5:'本当に感謝している',
  },
  anger: {
    1:'少しイラッとする',
    2:'ややいらだつ',
    3:'イライラする',
    4:'かなりイライラ',
    5:'強いイライラ',
  },
  moyamoya: {
    1:'少し引っかかる',
    2:'やや納得いかない',
    3:'けっこう釈然としない',
    4:'かなりモヤモヤする',
    5:'強くモヤモヤする',
  },
  sadness: {
    1:'少ししょんぼり',
    2:'落ち込む',
    3:'胸が重い',
    4:'かなりつらい',
    5:'深く悲しい',
  },
  anxiety: {
    1:'少しそわそわ',
    2:'やや不安',
    3:'落ち着かない',
    4:'かなり不安',
    5:'強い恐れ',
  },
};


// ---- 共感生成 ----
async function generateEmpathyLong(message){
  const prompt = `あなたは思いやりのある猫キャラ「けみー」です。丁寧でやさしく、語尾に軽く「〜にゃ」を添えてください。
次の発話に対して、自然で温かい共感を2〜3文で返してください。
- 1文目: 出来事を自然に言い換える（同じ表現は避ける）
- 2文目: 話し手の意味づけや期待を推測する
- 3文目: その気持ちに寄り添う一言（ポジ=喜ぶ/ネガ=ねぎらう/曖昧=受け止める）
- テンプレ的な出だしは避ける／深刻な話題ではふざけすぎない
発話: """${message}"""`;
  const r = await openai.chat.completions.create({
    model:'gpt-4o-mini', temperature:0.5,
    messages:[{role:'user', content:prompt}]
  });
  return (r.choices?.[0]?.message?.content || '話してくれてありがとうにゃ。気持ちが伝わってきたにゃ。').trim();
}

function localEmpathy(msg=''){
  return 'なるほど、そうだったんだね。気持ちを話してくれてありがとうにゃ。';
}


async function generateEmpathySmart(message){
  // 1回目: 4秒待つ
  try {
    return await Promise.race([
      generateEmpathyLong(message),
      new Promise((res)=>setTimeout(()=>res(null), 4000))
    ]) || await Promise.race([
      // 2回目: 追加で3秒待つ（合計最大7秒）
      generateEmpathyLong(message),
      new Promise((res)=>setTimeout(()=>res(null), 3000))
    ]) || '教えてくれて助かるにゃ。もう少しだけ詳しく知りたいにゃ。どの辺が一番引っかかった？（約束／言い方／タイミング／その他）';
  } catch {
    // 失敗時も“掘り質問”を返す
    return '教えてくれて助かるにゃ。もう少しだけ詳しく知りたいにゃ。どの辺が一番引っかかった？（約束／言い方／タイミング／その他）';
  }
}


function buildEmotionCarousel(sentiment) {
  const keys = orderedSixBySentiment(sentiment);
  const items = keys
    .map(k => EMOTIONS.find(e => e.k === k))
    .filter(Boolean);

  return {
    type: 'template',
    altText: '感情の選択',
    template: {
      type: 'buttons',
      title: '今の気持ちに近いのは？',
      text: '1つ選んでね',
      actions: items.map(e => ({
        type: 'postback',
        label: e.l,
        data: `ef:emo:${e.k}`,
        displayText: e.l
      }))
    }
  };
}





// ---- 強さカルーセル ----
function buildIntensityCarousel(code){
  const g = GUIDE[code] || {1:'ごく弱い',2:'やや弱い',3:'ほどほど',4:'かなり強い',5:'とても強い'};
  const columns = [1,2,3,4,5].map(n=>({
    thumbnailImageUrl:`https://dummyimage.com/600x400/ffffff/000.png&text=${n}`,
    title:`強さ ${n}`,
    text:g[n],
    actions:[{ type:'postback', label:String(n), data:`ef:int:${n}`, displayText:String(n) }]
  }));
  return { type:'template', altText:'強さを選んでね', template:{ type:'carousel', columns } };
}


import crypto from "crypto";

// --- /webhook 署名の可視化（SDK前段で生ボディに対して検証ログを出す）---
app.use('/webhook', express.raw({ type: '*/*' }), (req, _res, next) => {
  try {
    const signature = req.header('x-line-signature') || '';
    if (!config.channelSecret) {
      console.error('[SIGN] missing secret');
      return next();
    }
    const hmac = crypto.createHmac('sha256', config.channelSecret);
    hmac.update(req.body);
    const expected = hmac.digest('base64');
    const ok = signature === expected;
    if (!ok) {
      console.error('[SIGN] invalid signature. Will be rejected by SDK middleware.');
    } else {
      console.log('[SIGN] ok');
    }
  } catch (e) {
    console.error('[SIGN] error', e);
  }
  next();
});

// --- LINE SDK ミドルウェア適用（署名NGはここで401に）---
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    const events = req.body?.events || [];
    console.log("[WEBHOOK RECEIVED]", events.length);

    await Promise.all(events.map(handleEvent));
    return res.sendStatus(200);
  } catch (e) {
    console.error("[WEBHOOK_ERR]", e?.response?.data || e);
    return res.sendStatus(200); // 再送ループ回避のため200
  }
});





async function handleEvent(event){
  if (event.type==='message' && event.message.type==='text'){
    return onText(event);
  }
  if (event.type==='postback'){
    return onPostback(event);
  }
}

async function onText(event){
  const gid = event.source.groupId || event.source.userId;
  const text = event.message.text.trim();
  const s = sessions.get(gid) || { step:0, payload:{} };

  // ★ 自由入力の受け取りフェーズなら、共感生成をスキップして強さカルーセルへ直行
  if (s.step === 'await_free_label') {
    const ek = normalizeFeelingTo4(text) || 'moyamoya'; // 寄せられなければモヤモヤ扱い（方針に応じて変更可）
    sessions.set(gid, { step:'await_intensity', payload:{ ...s.payload, emotion_key: ek, utter: s.payload.utter || s.payload.utter }});
    const label = EMOTIONS.find(e=>e.k===ek)?.l || 'その気持ち';
    await client.replyMessage(event.replyToken, [
      { type:'text', text:`${label} の強さはどれくらい？` },
      buildIntensityCarousel(ek),
    ]);
    return;
  }

  // ★ 強さ待ちなど、途中フェーズでは共感を出さない（防御）
  if (s.step === 'await_intensity') {
    await client.replyMessage(event.replyToken, { type:'text', text:'まずは強さを選んでね' });
    return;
  }

  // ここから通常の最初の入力処理（既存ロジック）
  const empathy = await generateEmpathySmart(text);
  const sentiment = getSentimentRough(text); // 'positive' | 'negative' | 'neutral'
// 8件配列は作らず、sentiment を直接渡す
await sendReply(event.replyToken, [
  { type:'text', text: empathy },
  { type:'text', text:'いまの気持ちに近いものを1つ選んでほしいにゃ' },
  buildEmotionCarousel(sentiment),
]);

  sessions.set(gid, { step:2, payload:{ utter:text } });
}




async function onPostback(event){
  const gid = event.source.groupId || event.source.userId;
  const data = event.postback.data;
  const s = sessions.get(gid) || { step:0, payload:{} };
  const [ef, cmd, arg] = data.split(':');

if (cmd==='emo'){
  const ek = arg;
  sessions.set(gid, { step:3, payload:{...s.payload, emotion_key:ek} });
  const label = EMOTIONS.find(e=>e.k===ek)?.l || 'その気持ち';
  await client.replyMessage(event.replyToken, [
    { type:'text', text:`${label} の強さはどれくらいか教えてほしいにゃ` },
    buildIntensityCarousel(ek),
  ]);
}

if (cmd==='int'){
  const n = Number(arg);
  const ek = s.payload.emotion_key;
  const utter = s.payload.utter || '';

  const sentence = renderFeelingSentence(utter, ek, n);
  await client.replyMessage(event.replyToken, { type:'text', text: sentence });

  sessions.delete(gid); // ★ ここで終了。次の入力は新規フロー
  return;
}


 if (cmd==='other'){
  sessions.set(gid, { step: 'await_free_label', payload:{...s.payload} });
  await client.replyMessage(event.replyToken, { type:'text', text:'どんな気持ちか、ひと言で教えてほしいにゃ（例：モヤモヤ／さみしい／心配 など）' });
  return;
}



}

// ---- 起動 ----
const PORT = process.env.PORT || 3000;

// ---- Health Check & Root ----
app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'kemii',
    env: {
      channelAccessToken: !!(process.env.CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN),
      channelSecret: !!(process.env.CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET),
      openaiKey: !!process.env.OPENAI_API_KEY,
      supabaseUrl: !!process.env.SUPABASE_URL,
      supabaseKey: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY),
    },
    time: new Date().toISOString(),
  });
});

async function sendReply(replyToken, messages) {
  try {
    const arr = Array.isArray(messages) ? messages : [messages];
    const r = await client.replyMessage(replyToken, arr);
    console.log('[REPLY OK]', r);
  } catch (e) {
    const status = e?.status || e?.response?.status;
    const data = e?.originalError?.response?.data || e?.response?.data || e?.message;
    console.error('[REPLY ERROR]', status, data);

    // ← 期限切れ時は push でフォールバック（権限がある場合）
    if (status === 400 && String(data).includes('Invalid reply token')) {
      const to = lastTargetIdFromEventContext(); // groupId || userId を取れる実装にしておく
      if (to) {
        try {
          await client.pushMessage(to, { type:'text', text:'（けみー）遅くなっちゃった…もう一度送ってくれる？' });
          console.log('[PUSH FALLBACK] sent');
        } catch (pe) {
          console.error('[PUSH ERROR]', pe?.response?.status, pe?.message);
        }
      }
    }
  }
}


app.get('/', (_req, res) => {
  res.status(200).send('Kemii is running');
});

app.listen(PORT, ()=>console.log(`Kemii server running on ${PORT}`));
