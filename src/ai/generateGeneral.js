// src/ai/generateGeneral.js
// お金・コミュニケーションなど「general」セッションタイプの AI 生成
import { callClaude } from "./claude.js";

const SYSTEM = `あなたは「けみー🐾」。夫婦・パートナー間の対話を深める温かいファシリテーターにゃ。
回答は必ず valid な JSON のみ返すにゃ（前置き・後置き不要）。`;

/**
 * general セッション各ステップの質問文と選択肢を生成
 *
 * step1: どうする？（行動の選択）
 * step2: なぜ？（理由の深掘り、step1 回答を踏まえる）
 * step3: 何を守りたい？（価値観の抽出、step1+step2 を踏まえる）
 *
 * @returns {{ question: string, options: string[] }}
 */
export async function generateGeneralStepOptions({ sceneText, step, step1Action = "", step2Reason = "" }) {
  let userPrompt;

  if (step === "step1") {
    userPrompt = `シナリオ:「${sceneText}」

この場面での行動を問う質問文を1つ、
多様な価値観（安心・体験・節約・自分軸・他者軸 など）を反映した選択肢3つを生成してにゃ。

出力:
{
  "question": "（自然な会話口調の質問文）",
  "options": ["選択肢A", "選択肢B", "選択肢C"]
}`;
  } else if (step === "step2") {
    userPrompt = `シナリオ:「${sceneText}」
その人が選んだ行動:「${step1Action}」

「なぜそうしたい？」を掘り下げる質問文を1つ、
多様な動機（感情・経験・信念・関係性 など）を反映した理由の選択肢3つを生成してにゃ。

出力:
{
  "question": "（なぜ？を引き出す自然な会話口調）",
  "options": ["理由A", "理由B", "理由C"]
}`;
  } else {
    // step3: 守りたいもの（価値観）
    userPrompt = `シナリオ:「${sceneText}」
選んだ行動:「${step1Action}」
その理由:「${step2Reason}」

この行動と理由から垣間見える「守りたいもの・大切にしているもの」を問う
自然な会話口調の質問文を1つ、
価値観を表す短い表現（20字以内）を3つ生成してにゃ。

出力:
{
  "question": "（大切にしているものを引き出す問いかけ）",
  "options": ["大切にしているものA", "大切にしているものB", "大切にしているものC"]
}`;
  }

  const raw = await callClaude({
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 600,
  });

  const parsed = JSON.parse(raw.trim());
  return { question: parsed.question, options: parsed.options };
}

/**
 * general セッションの個別リフレクションを生成
 * 「自分らしさを誇れる」「行動の選択肢が広がる」メッセージ
 */
export async function generateGeneralReflection({
  sceneText,
  actionChoice,
  reasonChoice,
  valueChoice,
  userName = "あなた",
}) {
  const prompt = `シナリオ:「${sceneText}」

${userName}さんの回答:
・どうする？ →「${actionChoice}」
・なぜ？    →「${reasonChoice}」
・守りたいもの →「${valueChoice}」

この3つから${userName}さんの「個性・こだわり・大切にしていること」を読み解き、
「その個性はあなたの強みだよ」「その価値観を生かした行動の選択肢も増えるよ」
という気持ちが伝わるメッセージを8〜12行で書いてにゃ。

ルール:
・けみー🐾らしい温かくユーモアある文体（ただし軽すぎない）
・行動を肯定しつつ「その奥にある価値観の意味」を丁寧に言語化
・その価値観を活かした別の行動アイデアを1〜2個添える
・最後は自分を誇りに思えるような締めくくり
・文末の絵文字は最後の1か所だけ
・箇条書き禁止・地の文のみ`;

  return await callClaude({
    system: "あなたは「けみー🐾」。夫婦・パートナー間の対話を深める温かいファシリテーターにゃ。",
    messages: [{ role: "user", content: prompt }],
    maxTokens: 700,
  });
}

/**
 * general セッションのカップルリフレクションを生成
 * ふたりの違いを「豊かさ」として届ける
 */
export async function generateGeneralCoupleReflection({
  sceneText,
  user1Name,
  user1Action,
  user1Reason,
  user1Value,
  user2Name,
  user2Action,
  user2Reason,
  user2Value,
}) {
  const prompt = `シナリオ:「${sceneText}」

${user1Name}さん: 「${user1Action}」→「${user1Reason}」→守りたいもの:「${user1Value}」
${user2Name}さん: 「${user2Action}」→「${user2Reason}」→守りたいもの:「${user2Value}」

ふたりの違いを「豊かさ・補完関係」として伝えるメッセージを10〜15行で書いてにゃ。

ルール:
・違いを対立でなく相乗効果・補完として描く
・それぞれの個性がふたりの関係にどんな豊かさをもたらすか具体的に
・最後にふたりの対話のきっかけになる問いかけを1つ
・けみー🐾らしい温かいトーン
・文末の絵文字は最後の1か所だけ
・箇条書き禁止・地の文のみ`;

  return await callClaude({
    system: "あなたは「けみー🐾」。夫婦・パートナー間の対話を深める温かいファシリテーターにゃ。",
    messages: [{ role: "user", content: prompt }],
    maxTokens: 800,
  });
}
