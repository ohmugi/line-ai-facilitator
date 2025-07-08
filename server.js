// 夫婦ファシリテーターBot（専門家モード＋改行整形＋履歴要約付き）
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new Client(config);
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const systemPromptBase = `
あなたは、夫婦関係や子育てに関する悩みを聞く、AIファシリテーターです。  
この会話は、ユーザーが自分の本音や願いを整理し、必要に応じて相手に伝える言葉を見つけるためのものです。  

まずはユーザー本人に寄り添い、感情やその背景にある価値観・願いを丁寧に引き出してください。  
助言や翻訳を急がず、ユーザーが「自分でも気づいていなかった本当の思い」に気づけるようサポートします。  

以下の方針に従ってください：  
- 出力は常にユーザー本人に語りかけるように（奥さん・パートナーに直接語らない）  
- 返答は共感と安心感を大切にし、あたたかく丁寧な文体に  
- LINEチャットで読みやすいよう、適度に句読点の後や2〜3文ごとに改行を入れる  
- 必要に応じて夫婦心理学・育児心理学など専門的視点をやさしく補足  
- ユーザーの同意があった場合のみ、相手に伝える言葉や対応案を一緒に考える  

目的は以下です：  
- ユーザーのモヤモヤを丁寧に整理する  
- 背景にある感情・価値観・願いを明らかにする  
- ユーザーが望むタイミングで、相手に伝える形を一緒に考える  
`;

function formatLineBreaks(text) {
  return text.replace(/([。！？])(?=[^\n])/g, '$1\n').replace(/\n{2,}/g, '\n');
}

function decideFacilitationType(message) {
  const bridgeKeywords = ["寂しい", "悲しい", "孤独", "つらい", "怒り", "分かって", "むかつく", "我慢", "無視", "冷たい"];
  const normalized = message.toLowerCase();
  return bridgeKeywords.some(word => normalized.includes(word)) ? "bridge" : "deepen";
}

async function getChatHistory(sessionId, limit = 5) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, message_text')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) return { recentMessages: [], summaryPrompt: '' };
  const summaryTarget = data.slice(0, -limit);
  const recentMessages = data.slice(-limit).map(msg => ({ role: msg.role, content: msg.message_text }));

  let summaryPrompt = '';
  if (summaryTarget.length > 0) {
    const summaryText = summaryTarget.map(msg => `${msg.role === 'user' ? 'ユーザー' : 'AI'}：${msg.message_text}`).join("\n");
    const summaryRes = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: '以下の会話を要約してください。重要な話題や感情の動きが分かるように100文字以内で整理してください。' },
        { role: 'user', content: summaryText }
      ]
    });
    summaryPrompt = `これまでの会話の要約：${summaryRes.choices[0].message.content.trim()}`;
  }
  return { recentMessages, summaryPrompt };
}

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.source.type === 'group') {
      const groupId = event.source.groupId;
      const userId = event.source.userId;
      const message = event.message.text.trim();

      if (message === "フォーム") {
        await sendFormToGroup(groupId, userId);
        return;
      }

      await insertMessage(userId, 'user', message, groupId);

      try {
        const profile = await client.getGroupMemberProfile(groupId, userId);
        const displayName = profile.displayName;

        const mode = decideFacilitationType(message);
        const { recentMessages, summaryPrompt } = await getChatHistory(groupId);

        const prompt = (mode === 'bridge')
          ? await generateFacilitatedResponse(displayName, message)
          : await generateDeepeningResponse(displayName, message);

        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: `${summaryPrompt}\n\n${systemPromptBase}` },
            ...recentMessages,
            { role: 'user', content: message }
          ],
          temperature: 0.7,
        });

        const aiReply = formatLineBreaks(response.choices[0].message.content);
        await insertMessage(userId, 'assistant', aiReply, groupId);
        await client.replyMessage(event.replyToken, [{ type: 'text', text: aiReply }]);
      } catch (err) {
        console.error('Group message error:', err);
      }
    }
  }
  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));

async function sendFormToGroup(groupId, userId) {
  const formUrl = `https://docs.google.com/forms/d/e/1FAIpQLScBz8_GoEYeT5i_u7ZjB3-Avt5QDesNHU3vbZZ4vmWOA88yhA/viewform?usp=pp_url&entry.687948068=${userId}&entry.460945064=${groupId}`;
  const flexMessage = {
    type: "flex",
    altText: "相談フォームはこちら",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        paddingAll: "20px",
        contents: [
          { type: "text", text: "AIファシリテーターに相談しませんか？", wrap: true, weight: "bold", size: "md" },
          { type: "button", action: { type: "uri", label: "相談フォームを開く", uri: formUrl }, style: "primary", margin: "lg" }
        ]
      }
    }
  };
  await client.pushMessage(groupId, flexMessage);
}

async function insertMessage(userId, role, messageText, sessionId = null) {
  const { data, error } = await supabase.from('chat_messages').insert([
    { user_id: userId, role, message_text: messageText, session_id: sessionId }
  ]);
  if (error) console.error('❌ Supabase insert error:', error);
  else console.log("✅ Supabase insert success:", data);
}

async function generateDeepeningResponse(displayName, message) {
  const prompt = `以下は、${displayName}さんの発言です：「${message}」\nこの内容を受けて、気持ちや背景に寄り添う問いかけを作ってください。`;
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: prompt }
    ],
    temperature: 0.7,
  });
  return response.choices[0].message.content;
}

async function generateFacilitatedResponse(displayName, message) {
  const prompt = `以下は、${displayName}さんの発言です：「${message}」\n相手が答えやすくなるように翻訳し、返しやすい視点を提示してください。`;
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: prompt }
    ],
    temperature: 0.7,
  });
  return response.choices[0].message.content;
}
