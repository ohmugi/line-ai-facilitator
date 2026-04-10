// src/ai/generatePersonalityTraits.js
import { callClaude } from "./claude.js";

/**
 * セッションの回答からユーザーの個性を特定する
 * リストにない場合は新しい個性を提案し、Supabaseに追加できるようにする
 *
 * @returns {{ identified: string[], newTrait: null | { name: string, description: string, category: string } }}
 */
export async function generatePersonalityTraits({
  sceneText,
  actionChoice,
  emotionAnswer,
  intentChoice,
  scriptValues,
  availableTraits, // [{ name, description, category }]
  userName,
}) {
  const traitList = availableTraits
    .map((t) => `- ${t.name}（${t.category}）: ${t.description}`)
    .join("\n");

  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」です。

役割:
ユーザーのセッション回答を読み、そのユーザーが持つポジティブな個性を特定してください。

ルール:
- 以下の個性リストから1〜3つを選んでください
- 回答の全体から読み取れる「その人らしさ」「強み」に着目する
- ポジティブな解釈を心がける
- リストにぴったり合う個性がない場合のみ new_trait に1つ提案する（その場合、nameは日本語の形容詞か名詞）
- JSON形式のみで出力する

出力フォーマット（JSONのみ、説明不要）:
{
  "identified": ["個性名1", "個性名2"],
  "new_trait": null
}

または新しい個性が必要な場合:
{
  "identified": ["既存の個性名"],
  "new_trait": { "name": "新しい個性名", "description": "一文の説明。", "category": "カテゴリ名" }
}`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}
${userName}さんのアクション: ${actionChoice}
気持ち: ${emotionAnswer}
意図: ${intentChoice}
スクリプト（価値観）: ${scriptValues}

個性リスト:
${traitList}

このユーザーの個性を特定してください。JSONのみ出力してください。`,
    },
  ];

  const response = await callClaude({ system, messages, maxTokens: 400 });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      identified: Array.isArray(parsed.identified) ? parsed.identified : [],
      newTrait: parsed.new_trait || null,
    };
  } catch (err) {
    console.error("[generatePersonalityTraits] Failed to parse response:", response, err);
    return { identified: [], newTrait: null };
  }
}
