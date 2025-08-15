// src/utils/feedbackProcessor.js
import supabase from './lib/supabaseClient.js';
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function updateCharacterPrompt(characterName) {
  // 1) フィードバック取得（必要ならキャラで絞る）
  const { data: feedbacks, error: fbErr } = await supabase
    .from('character_feedbacks')
    .select('feedback_type, character_name, created_at')
    .eq('character_name', characterName)       // ← 絞り込み推奨
    .order('created_at', { ascending: false })
    .limit(200);

  if (fbErr) throw new Error(`[FB SELECT] ${fbErr.message}`);
  if (!feedbacks || feedbacks.length === 0) {
    console.log('[INFO] no feedbacks. skip.');
    return;
  }

  // 2) 現在のテンプレ取得
  const { data: chars, error: chErr } = await supabase
    .from('characters')
    .select('id, name, prompt_template')
    .eq('name', characterName)
    .limit(1);

  if (chErr) throw new Error(`[CHAR SELECT] ${chErr.message}`);
  const character = chars?.[0];
  if (!character?.prompt_template) {
    console.warn('[WARN] prompt_template not found. skip.');
    return;
  }

  // 3) フィードバック集計
  const summary = { tone: 0, empathy: 0, curiosity: 0 };
  for (const f of feedbacks) {
    if (summary[f.feedback_type] !== undefined) summary[f.feedback_type] += 1;
  }

  // 4) OpenAI で改善
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[WARN] OPENAI_API_KEY missing. skip LLM.');
    return;
  }

  const prompt = `
以下は「${characterName}」というキャラのプロンプトです。
次のフィードバック要約を反映しつつ、元の意図を壊さない範囲で改善してください。
- tone: ${summary.tone}
- empathy: ${summary.empathy}
- curiosity: ${summary.curiosity}

【現在のプロンプト】
${character.prompt_template}
  `.trim();

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'あなたはプロンプト編集の専門家です。安全で一貫した口調を維持してください。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.4
  });

  const improved = res?.choices?.[0]?.message?.content?.trim();
  if (!improved) {
    console.warn('[WARN] empty LLM result. skip write.');
    return;
  }

  // 5) 書き戻し
  const { error: upErr } = await supabase
    .from('characters')
    .update({ prompt_template: improved, updated_at: new Date().toISOString() })
    .eq('id', character.id);

  if (upErr) throw new Error(`[CHAR UPDATE] ${upErr.message}`);

  console.log('[OK] prompt_template updated.');
}
