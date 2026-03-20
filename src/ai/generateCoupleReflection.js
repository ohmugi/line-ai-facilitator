// src/ai/generateCoupleReflection.js
import { callClaude } from "./claude.js";

/**
 * ふたりのセッション回答からカップルリフレクションを生成
 * けみーからのメッセージ風（違い→ふたりの強みとして届ける）
 */
export async function generateCoupleReflection({
  sceneText,
  user1Name,
  user1Step1,  // { emotion, intensity, thought }
  user1Step2,  // { values: [] }
  user1Step4,  // { choice: string, is_custom: boolean }
  user2Name,
  user2Step1,
  user2Step2,
  user2Step4,
}) {
  const fmt1 = formatStep1(user1Step1);
  const fmt2 = formatStep1(user2Step1);
  const val1 = Array.isArray(user1Step2?.values) ? user1Step2.values.join("、") : "";
  const val2 = Array.isArray(user2Step2?.values) ? user2Step2.values.join("、") : "";
  const vision1 = user1Step4?.choice || "";
  const vision2 = user2Step4?.choice || "";

  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
ふたりのセッション回答を読んで、けみーからのメッセージとして「ふたりの違いと強み」を届けてください。

メッセージのルール:
- 語尾は「にゃ」「にゃ🐾」を使う
- 全体で8〜12行程度
- 構成：①ふたりの感じ方の紹介 → ②その違いが意味すること → ③関わり方の違いを解釈付きで紹介 → ④ふたりの強み → ⑤対話を促す一言
- 違いを「ズレ・問題」ではなく「個性・強み」として肯定的に翻訳する
- ③では「〇〇さんは△△したい、□□さんは◇◇したい。どちらも子どもを思う気持ちから来てるにゃ」という形で解釈を添える
- ⑤では「この違いについて、今夜話してみてにゃ」のような対話を促す一言を自然に入れる
- 最後は「ふたりだからこそ」「補い合える」という強みで締める
- 説教臭くならず、発見と温かさを感じるトーン
- 絵文字は🐾を最後の1箇所のみ

悪い例:
- 「ふたりの考え方が違います」（問題として提示）
- 「話し合いが必要です」（上から目線）
- 長すぎる（15行以上）

良い例（構成イメージ）:
「${user1Name}さんは〜を感じて、${user2Name}さんは〜を感じたんだにゃ。
感じ方が違うのは、大切にしてることが違うからにゃ。
${user1Name}さんは〜したい、${user2Name}さんは〜したい——どちらも子どもを思う気持ちからだにゃ。
この違い、ふたりで話してみたら新しい発見があるかもにゃ。
${user1Name}さんの〜する力と、${user2Name}さんの〜する力、
ふたりで使えばすごく強いにゃ🐾」`;

  const visionLine1 = vision1 ? `\n- 子どもとの関わり方: ${vision1}` : "";
  const visionLine2 = vision2 ? `\n- 子どもとの関わり方: ${vision2}` : "";

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}

${user1Name}さんの回答:
- 感情: ${fmt1}
- 大切にしていること: ${val1}${visionLine1}

${user2Name}さんの回答:
- 感情: ${fmt2}
- 大切にしていること: ${val2}${visionLine2}

ふたりへのメッセージを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 600 });
}

function formatStep1(s1) {
  if (!s1) return "（未回答）";
  if (s1.emotion && s1.intensity && s1.thought) {
    const lbl = s1.intensity <= 3 ? "少し" : s1.intensity <= 5 ? "そこそこ" : s1.intensity <= 7 ? "かなり" : "とても強く";
    return `${s1.emotion}を${lbl}（${s1.intensity}/10）感じ、「${s1.thought}」と思っている`;
  }
  return s1.thought || s1.emotion || "（未回答）";
}
