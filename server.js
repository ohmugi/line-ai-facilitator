// 環境設定
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const { middleware, Client } = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const app = express();
app.use(bodyParser.raw({ type: '*/*' }));
app.use(express.json());

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



const improvedPrompt = response.choices[0].message.content;

// フォーム送信
async function sendFormToGroup(groupId) {
  await client.pushMessage(groupId, [{
    type: 'text',
    text: '📮 相談フォームはこちらです：\nhttps://forms.gle/xxxxxxxx'
  }]);
}

// にゃチェック
function ensureKemiiStyle(text) {
  const hasNya = text.includes("にゃ");
  if (!hasNya) {
    return text.replace(/([。！？])/g, "にゃ$1");
  }
  return text;
}

// 補助テンプレ選定
function getPromptHelper(message) {
  if (message.includes("疲れ") || message.includes("しんど")) {
    return `ユーザーは育児・家事・生活の中で疲れや負担を感じています。
けみーは、「どんな瞬間が特にしんどいのか」「逆にどんなときはうれしかったか」などを聞きながら、ユーザーが自分の感情を言葉にできるようにサポートしてください。
問いは1つに絞り、答えにくそうなら選択肢を添えてください。`;
  }
  if (message.includes("ちょっと") || message.includes("モヤモヤ")) {
    return `ユーザーは「小さなつかれ」や「ちょっとした不満」を話しています。
けみーは、相手の感情の背景に興味を持って、「どうしてそう感じたのか」「どんな時に似たことがあったか」などを自然に聞いてください。
アドバイスはせず、答えやすいように選択肢も提示してみてください。`;
  }
  return `このやりとりは「雑談フェーズ」です。
けみーは、答えを出そうとするのではなく、「どんな気持ちだったのか」「なぜそう感じたのか」を知りたがってください。
難しい言葉や正論を並べず、感情に興味がある猫として、やさしく問いかけてください。`;
}

// Supabase保存
async function insertMessage(userId, role, messageText, sessionId) {
  if (!sessionId) return;
  const { error } = await supabase.from('chat_messages').insert({
    user_id: userId,
    role,
    message_text: messageText,
    session_id: sessionId
  });
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
}

// 履歴取得
async function fetchHistory(sessionId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, message_text')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) return '';

  const recent = data.slice(-5);
  const summary = data.length > 5 ? `（前略：これまでのやり取りは要約済）\n` : '';

  return summary + recent.map(msg => `${msg.role === 'user' ? 'ユーザー' : 'けみー'}：${msg.message_text}`).join('\n');
}

// 名前取得
async function getUserName(userId) {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('custom_name, display_name')
    .eq('user_id', userId)
    .single();

  if (profile?.custom_name) return profile.custom_name;
  if (profile?.display_name) return profile.display_name;

  // なければLINEから取得
  const lineProfile = await client.getProfile(userId);
  await supabase.from('user_profiles').upsert({
    user_id: userId,
    display_name: lineProfile.displayName
  });
  return lineProfile.displayName;
}

async function setCustomName(userId, customName) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ custom_name: customName })
    .eq('user_id', userId);

  if (error) {
    console.error('❌ カスタム名の保存に失敗:', error.message);
  }
}


// Webhook処理
app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    try {
      if (event.type === 'message' && event.source.type === 'group') {
        const userId = event.source.userId;
        const groupId = event.source.groupId;
        const message = event.message.text.trim();

        if (message === 'フォーム') {
          await sendFormToGroup(groupId);
          return;
        }

        await insertMessage(userId, 'user', message, groupId);
        const history = await fetchHistory(groupId);
        const helper = getPromptHelper(message);

        const { data: character, error } = await supabase
  .from('characters')
  .select('prompt_template')
  .eq('name', 'けみー') // 将来的にメッセージから動的に変える場合はここを工夫
  .single();

if (error || !character) {
  throw new Error(`キャラクター設定の取得に失敗しました: ${error?.message}`);
}

const systemPrompt = character.prompt_template;


        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: helper },
            { role: 'user', content: message }
          ],
          temperature: 0.7
        });

        const rawReply = completion.choices[0].message.content;

        const reformulated = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `あなたは「けみー」というAIキャラの表現アドバイザーです。
以下の文章を、「けみーらしく」やわらかく、問いを1つに絞って再構成してください。
語尾に「にゃ」が自然に混ざり、選択肢があってもOKです。
説明っぽさは控え、問い＋つぶやきで返してください。`
            },
            { role: 'user', content: rawReply }
          ],
          temperature: 0.7
        });

        const reply = ensureKemiiStyle(reformulated.choices[0].message.content);

        await insertMessage(userId, 'assistant', reply, groupId);
        await client.replyMessage(event.replyToken, [{ type: 'text', text: reply }]);
      }
    } catch (err) {
      console.error('❌ Error in event handling:', err.response?.data || err.message || err);
    }
  }
  res.status(200).end();
});




async function insertFeedback({
  userId,
  characterName = 'けみー',
  feedbackType,
  comment,
  targetPromptSection = null
}) {
  const { error } = await supabase.from('character_feedbacks').insert({
    user_id: userId,
    character_name: characterName,
    feedback_type: feedbackType,
    comment,
    target_prompt_section: targetPromptSection
  });

  if (error) {
    console.error('❌ フィードバックの保存に失敗:', error.message);
    return false;
  }

  console.log('✅ フィードバックを保存しました');
  return true;
}

// feedbackProcessor.js
import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

// 環境変数の読み込み
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export async function updateCharacterPrompt(characterName = 'けみー') {
  // 1. フィードバックを集計
  const { data: feedbacks, error: feedbackError } = await supabase
    .from('character_feedbacks')
    .select('tone, empathy, curiosity')
    .eq('character_name', characterName);

  if (feedbackError || !feedbacks) {
    console.error('フィードバック取得失敗:', feedbackError);
    return;
  }

  // 2. 平均を計算
  const summary = feedbacks.reduce(
    (acc, fb) => {
      acc.tone += fb.tone;
      acc.empathy += fb.empathy;
      acc.curiosity += fb.curiosity;
      return acc;
    },
    { tone: 0, empathy: 0, curiosity: 0 }
  );

  const count = feedbacks.length || 1;
  const avg = {
    tone: summary.tone / count,
    empathy: summary.empathy / count,
    curiosity: summary.curiosity / count
  };

  // 3. キャラの現在のプロンプト取得
  const { data: character, error: charError } = await supabase
    .from('characters')
    .select('prompt_template')
    .eq('name', characterName)
    .single();

  if (charError || !character) {
    console.error('キャラクター取得失敗:', charError);
    return;
  }

  // 4. OpenAIに依頼して改善
  const prompt = `以下のキャラクタープロンプトを、次のフィードバックに基づいて改善してください：\n\n` +
    `【フィードバック】\n` +
    `- tone: ${avg.tone.toFixed(1)}\n` +
    `- empathy: ${avg.empathy.toFixed(1)}\n` +
    `- curiosity: ${avg.curiosity.toFixed(1)}\n\n` +
    `【現在のプロンプト】\n${character.prompt_template}\n\n` +
    `【出力形式】改善されたプロンプトのみを出力してください。`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'あなたはプロンプト改善の専門家です。' },
      { role: 'user', content: prompt }
    ]
  });

  const improvedPrompt = response.choices[0]?.message?.content;
  if (!improvedPrompt) {
    console.error('プロンプト生成失敗');
    return;
  }

  // 5. Supabaseに保存
  const { error: updateError } = await supabase
    .from('characters')
    .update({ prompt_template: improvedPrompt })
    .eq('name', characterName);

  if (updateError) {
    console.error('プロンプト更新失敗:', updateError);
  } else {
    console.log('プロンプト更新成功');
  }
}

// サーバー起動
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
