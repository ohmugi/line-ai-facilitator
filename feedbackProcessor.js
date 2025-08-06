// src/utils/feedbackProcessor.js
import { supabase } from '../supabase.js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function updateCharacterPrompt(characterName) {
  // フィードバック集計
  const { data: feedbacks, error } = await supabase
    .from('character_feedbacks')
    .select('feedback_type');

  const summary = { tone: 0, empathy: 0, curiosity: 0 };
  feedbacks.forEach(f => {
    if (summary[f.feedback_type] !== undefined) summary[f.feedback_type] += 1;
  });

  // 現在のプロンプト取得
  const { data: characters } = await supabase
    .from('characters')
    .select('prompt_template')
    .eq('name', characterName);

  const currentPrompt = characters?.[0]?.prompt_template;

  // OpenAIに改善依頼
  const prompt = `
以下は「${characterName}」というキャラのプロンプトです。
以下のフィードバックを反映して改善してください：

tone: ${summary.tone}
empathy: ${summary.empathy}
curiosity: ${summary.curiosity}

【現在のプロンプト】
${currentPrompt}
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'あなたはプロンプト編集の専門家です' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7
  });

  const improvedPrompt = response.choices[0].message.content;

  // Supabaseに保存
  await supabase
    .from('characters')
    .update({ prompt_template: improvedPrompt })
    .eq('name', characterName);

  console.log('✅ プロンプト更新完了');
}
