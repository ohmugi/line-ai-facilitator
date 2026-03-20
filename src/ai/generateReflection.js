// src/ai/generateReflection.js
import { callClaude } from "./claude.js";

/**
 * リフレクションを生成
 * これまでの対話を振り返り、納得を促すメッセージ
 */
export async function generateReflection({
  sceneText,
  emotionAnswer,
  valueChoice,
  backgroundChoice,
  backgroundDetail,
  backgroundEmotion,
  visionChoice,
  userName,
}) {
  const system = `あなたは、夫婦の対話を深めるファシリテーター「Kemy(けみー)」(猫キャラ)です。

役割:
これまでの対話を振り返り、相手が自分のスクリプトと原体験に気づけたことを肯定し、納得を促すメッセージを送ってください。

メッセージのルール:
- 語尾は「にゃ」を使う
- 4-6行程度
- 構成: 感情 → 価値観（スクリプト）→ 原体験（具体的エピソードと感情）→ 関わり方
- 「あなたは〇〇を大事にしているんだにゃ」という肯定
- 「それは△△という経験から来てるのかもしれないにゃ」という理解
- backgroundDetailとbackgroundEmotionがある場合は、より具体的にエピソードと感情を織り込む
- Step4の「関わり方」は列挙せず、Step1〜3で見えてきた価値観・原体験と自然に接続して言及する
  例: 「〇〇という気持ちの奥に△△を大切にしたい思いがあったんだにゃ。だからこそ、□□したいって感じたんだと思う」
- 押し付けがましくなく、温かく背中を押すトーン
- 絵文字は🐾を1回だけ、最後に使う

悪い例:
- 長すぎる(10行以上)
- 説教臭い
- 「頑張ってください」みたいな励まし(不要)
- 関わり方を箇条書きで列挙する

良い例:
「${userName}さんは、お金を計画的に使うことを大事にしてるんだにゃ。
それは、親に厳しく叱られた経験から来てるのかもしれないにゃ。
そんな経験があるからこそ、自分の子どもには一緒に考えるそばにいたい——そう思ったんじゃないかにゃ🐾」`;

  const contextParts = [
    `シナリオ: ${sceneText}`,
    `${userName}さんの気持ち: ${emotionAnswer}`,
    `価値観・信念: ${valueChoice}`,
    `原体験: ${backgroundChoice}`,
  ];

  if (backgroundDetail) {
    contextParts.push(`具体的な状況: ${backgroundDetail}`);
  }

  if (backgroundEmotion) {
    contextParts.push(`その時の感情: ${backgroundEmotion}`);
  }

  contextParts.push(`子どもとの関わり方: ${visionChoice}`);

  const messages = [
    {
      role: "user",
      content: `${contextParts.join("\n")}

リフレクションメッセージのみを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 500 });
}
