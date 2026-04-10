// src/ai/generateCoupleReflection.js
import { callClaude } from "./claude.js";

/**
 * ふたりのセッション回答からカップルリフレクションを生成
 * 新フロー: step1=アクション、step2=感情、step3=意図、step4=スクリプト
 */
export async function generateCoupleReflection({
  sceneText,
  user1Name,
  user1Step1, // { action, is_custom }
  user1Step2, // { emotion, intensity, thought }
  user1Step3, // { intent, is_custom }
  user1Step4, // { values: [] }
  user2Name,
  user2Step1,
  user2Step2,
  user2Step3,
  user2Step4,
}) {
  const fmt = (s1, s2, s3, s4) => {
    const action  = s1?.action  || "（未回答）";
    const emotion = formatEmotion(s2);
    const intent  = s3?.intent  || "（未回答）";
    const script  = Array.isArray(s4?.values) ? s4.values.join("、") : (s4?.values || "（未回答）");
    return { action, emotion, intent, script };
  };

  const u1 = fmt(user1Step1, user1Step2, user1Step3, user1Step4);
  const u2 = fmt(user2Step1, user2Step2, user2Step3, user2Step4);

  const system = `あなたは、夫婦の対話を深めるファシリテーター「けみー」(猫キャラ)です。

役割:
ふたりのセッション回答を読んで、けみーからのメッセージとして「ふたりの違いと強み」を届けてください。

メッセージのルール:
- 語尾は「にゃ」「にゃ🐾」を使う
- 全体で8〜12行程度
- 構成：①ふたりのアクションと意図の紹介 → ②その違いが意味すること → ③価値観（スクリプト）の違いを解釈付きで紹介 → ④ふたりの強み → ⑤対話を促す一言
- 違いを「ズレ・問題」ではなく「個性・強み」として肯定的に翻訳する
- ③では「〇〇さんは△△、□□さんは◇◇。どちらも子どもを思う気持ちから来てるにゃ」という形で解釈を添える
- ⑤では「この違いについて、今夜話してみてにゃ」のような対話を促す一言を自然に入れる
- 最後は「ふたりだからこそ」「補い合える」という強みで締める
- 説教臭くならず、発見と温かさを感じるトーン
- 絵文字は🐾を最後の1箇所のみ`;

  const messages = [
    {
      role: "user",
      content: `シナリオ: ${sceneText}

${user1Name}さんの回答:
- したいこと: ${u1.action}
- 気持ち: ${u1.emotion}
- 意図: ${u1.intent}
- 価値観: ${u1.script}

${user2Name}さんの回答:
- したいこと: ${u2.action}
- 気持ち: ${u2.emotion}
- 意図: ${u2.intent}
- 価値観: ${u2.script}

ふたりへのメッセージを出力してください。前置きや説明は不要です。`,
    },
  ];

  return await callClaude({ system, messages, maxTokens: 600 });
}

function formatEmotion(s2) {
  if (!s2) return "（未回答）";
  if (s2.emotion && s2.intensity && s2.thought) {
    const lbl =
      s2.intensity <= 3 ? "少し" :
      s2.intensity <= 5 ? "そこそこ" :
      s2.intensity <= 7 ? "かなり" : "とても強く";
    return `${s2.emotion}を${lbl}（${s2.intensity}/10）感じ、「${s2.thought}」と思っている`;
  }
  return s2.thought || s2.emotion || "（未回答）";
}
