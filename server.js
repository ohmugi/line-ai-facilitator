// server.js

import express from 'express';
import bodyParser from 'body-parser';
import { middleware, Client } from '@line/bot-sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);
const app = express();

// ---- LINE設定 ----
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
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

// ---- 8感情の固定セット（POS4＋NEG4）と並び替え ----
// ※内部キーは例です。あなたの EMOTIONS 定義に合わせてキーを調整してください。
const POS_KEYS = ['joy','calm','affection','pride'];       // 例：喜び / 安心 / 愛情 / 誇り
const NEG_KEYS = ['anxiety','anger','sadness','helpless']; // 例：不安 / 怒り / 悲しみ / 無力感

function orderedEightBySentiment(sentiment) {
  if (sentiment === 'negative') return [...NEG_KEYS, ...POS_KEYS];
  if (sentiment === 'positive') return [...POS_KEYS, ...NEG_KEYS];
  // neutral はとりあえずポジ先頭
  return [...POS_KEYS, ...NEG_KEYS];
}

// ===== 自然文合成ユーティリティ（主語のねじれを防ぐ版） =====

// 強さ(1-5)→ 副詞
function intensityAdverb(n){
  return { 1:'ちょっと', 2:'けっこう', 3:'かなり', 4:'すごく', 5:'最高に' }[n] || '';
}

// emotion_key → 述語（過去形）
function emotionPredicate(ek){
  const map = {
    joy:'うれしかった',
    calm:'ほっとした',
    affection:'あたたかい気持ちになった',
    pride:'誇らしく感じた',
    anxiety:'不安に感じた',
    anger:'イラッとした',
    sadness:'さみしく感じた',
    helpless:'どうにもならない気持ちになった',
    grat:'ありがたい気持ちになった',
    hope:'楽しみな気持ちになった',
    relief:'ほっとした'
  };
  return map[ek] || '気持ちになった';
}

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


// ---- 感情カテゴリ（NVC準拠、desc付き） ----
const EMOTIONS = [
  { k:'joy',      l:'喜び',     desc:'うれしさ・幸せ・達成感' },
  { k:'calm',     l:'安心',     desc:'落ち着き・安らぎ・余裕が戻る感じ' },
  { k:'vitality', l:'活力',     desc:'元気・やる気・前に進める感じ' },
  { k:'affection',l:'愛情',     desc:'親しみ・感謝・つながり' },
  { k:'pride',    l:'誇り',     desc:'満足・自信・やり切れた感覚' },
  { k:'anger',    l:'怒り',     desc:'いらだち・フラストレーション' },
  { k:'sadness',  l:'悲しみ',   desc:'落胆・喪失感・孤独' },
  { k:'anxiety',  l:'不安',     desc:'そわそわ・心配・恐れ' },
  { k:'helpless', l:'無力感',   desc:'疲労・混乱・手につかない' },
  { k:'shame',    l:'恥/罪悪感',desc:'後悔・自己否定・居心地の悪さ' },
];

// ---- 感情別強さガイド ----
const GUIDE = {
  joy: {
    1:'少しだけうれしい（口元が緩む）',
    2:'けっこううれしい（誰かに言いたい）',
    3:'うれしい（気分が上向く）',
    4:'とてもうれしい（体が軽い）',
    5:'最高にうれしい（飛び上がりたい）',
  },
  anger: {
    1:'少しいらだつ（表情に出ない）',
    2:'やや不快（チクリとする）',
    3:'怒る（言葉がきつくなる）',
    4:'かなり腹立つ（声が強くなる）',
    5:'強い怒り（対話が難しい）',
  },
  sadness: {
    1:'少ししょんぼり（ため息）',
    2:'やや落ち込む（気分が下向き）',
    3:'胸が重い（集中しづらい）',
    4:'かなりつらい（涙が出そう）',
    5:'深く悲しい（何も手につかない）',
  },
  anxiety: {
    1:'少しそわそわ（注意が散る）',
    2:'やや不安（考え直す）',
    3:'落ち着かない（体に緊張）',
    4:'かなり不安（最悪を想像）',
    5:'強い恐れ（眠れない）',
  },
  calm: {
    1:'少し落ち着く（肩の力が抜ける）',
    2:'やや安心（呼吸が整う）',
    3:'安心できる（視野が広がる）',
    4:'だいぶ穏やか（余裕が戻る）',
    5:'深く安らぐ（満たされる）',
  },
  // 他の感情も同じ形式で埋めてOK
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
  return await Promise.race([
    generateEmpathyLong(message),
    new Promise(res=>setTimeout(()=>res(localEmpathy(message)), 1800))
  ]);
}

// ---- 感情カルーセル ----
function buildEmotionCarousel(codes){
  // 渡された codes（最大10件想定）をそのまま全件カラム化
  const columns = codes.map(k=>{
    const m = EMOTIONS.find(x=>x.k===k);
    return {
      thumbnailImageUrl:'https://dummyimage.com/600x400/ffffff/000.png&text=kemii',
      title: m?.l || k,
      text:  m?.desc || 'この気持ちに近い？',
      actions:[{ type:'postback', label:'これにする', data:`ef:emo:${k}`, displayText:m?.l || k }]
    };
  });

  // 最後に「どれでもない」
  columns.push({
    thumbnailImageUrl:'https://dummyimage.com/600x400/ffffff/000.png&text=?',
    title:'どれでもない',
    text:'当てはまらないときは自由入力で近い気持ちを書いてね',
    actions:[{ type:'postback', label:'自由入力する', data:'ef:other', displayText:'どれでもない' }]
  });

  return { type:'template', altText:'感情を選んでね', template:{ type:'carousel', columns } };
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

// WebhookはLINE署名検証を最優先。body-parserは使わない
app.post('/webhook', middleware(config), (req, res) => {
  const events = req.body.events || [];

  // 先に即200を返す（LINEの再送を防ぐ）
  res.status(200).end();

  // 応答は別タスクで処理（長い生成でもOK）
  // 失敗してもWebhook応答には影響しない
  setImmediate(async () => {
    try {
      for (const ev of events) {
        await handleEvent(ev);
      }
    } catch (e) {
      console.error('Webhook async error:', e);
    }
  });
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

  const empathy = await generateEmpathySmart(text); // ← 既存のスマート共感（中では generateEmpathyLong を呼ぶ想定）
  await client.replyMessage(event.replyToken, { type:'text', text: empathy });

  // ざっくり極性で並び順だけ自動調整
  const sentiment = getSentimentRough(text); // 'positive' | 'negative' | 'neutral'
  const eight = orderedEightBySentiment(sentiment);

  await client.pushMessage(gid, { type:'text', text:'いまの気持ちに近いものを1つ選んでほしいにゃ' });
  await client.pushMessage(gid, buildEmotionCarousel(eight));

  sessions.set(gid, { step:2, payload:{utter:text} });
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
  await client.replyMessage(event.replyToken, { type:'text', text:`${label} の強さはどれくらいか教えてほしいにゃ` });
  await client.pushMessage(gid, buildIntensityCarousel(ek));
}

if (cmd==='other'){
  sessions.set(gid, { step:3, payload:{...s.payload, emotion_key:'other'} });
  await client.replyMessage(event.replyToken, { type:'text', text:'近い気持ちの名前を自由入力してほしいにゃ' });
}

if (cmd==='int'){
  const n = Number(arg);
  const ek = s.payload.emotion_key;
  const utter = s.payload.utter || ''; // onText で保存した出来事テキスト

  // 出来事＋感情＋強さ → 自然文
  const sentence = renderFeelingSentence(utter, ek, n);

  await client.replyMessage(event.replyToken, {
    type:'text',
    text: sentence
  });

  // （任意）ここで feelings 更新を行う場合は追記：
  // await supabase.from('feelings').update({ emotion: ek, intensity: n }).eq('id', feelingId);
}


}

// ---- 起動 ----
const PORT = process.env.PORT || 3000;

// ---- Health Check & Root ----
app.get('/healthz', (req, res) => {
  // 外部サービスへアクセスしない（ここでOpenAI/Supabaseに触らないのが鉄則）
  res.status(200).json({
    status: 'ok',
    service: 'kemii',
    // 簡易診断（値はマスク）
    env: {
      channelAccessToken: !!process.env.CHANNEL_ACCESS_TOKEN,
      channelSecret: !!process.env.CHANNEL_SECRET,
      openaiKey: !!process.env.OPENAI_API_KEY,
      supabaseUrl: !!process.env.SUPABASE_URL,
      supabaseKey: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY),
    },
    time: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.status(200).send('Kemii is running');
});

app.listen(PORT, ()=>console.log(`Kemii server running on ${PORT}`));
