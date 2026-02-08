// src/server.js
console.log("SERVER FILE LOADED");

import "dotenv/config";
import express from "express";
import crypto from "crypto";

import { replyText } from "./line/reply.js";
import { saveMessage } from "./supabase/messages.js";
import {
  startSession,
  isSessionActive,
  getSession,
  endSession,
} from "./session/sessionManager.js";

import { getActiveScene } from "./db/scenes.js";
import { getEmotionExamples } from "./supabase/emotionExamples.js";
import { getLineProfile } from "./line/getProfile.js";
import { replyTextWithQuickReply } from "./line/reply.js";
import { replyQuickText } from "./line/replyQuick.js";

// AI
import { generateDirection } from "./ai/generateDirection.js";
import { generateReflection } from "./ai/generateReflection.js";
import { generateValueOptions } from "./ai/generateValueOptions.js";
import { generateBackgroundOptions } from "./ai/generateBackgroundOptions.js";
import { generateVisionOptions } from "./ai/generateVisionOptions.js";



const app = express();
function updateContext(session) {
  session.context = {
    sceneText: session.sceneText,
    emotion: session.lastEmotionAnswer,
    value: session.lastValueChoice,
    background: session.lastBackgroundChoice,
    vision: session.lastVisionChoice,
  };
}

/**
 * =========================
 * Health check
 * =========================
 */
app.get("/", (_, res) => res.status(200).send("ok"));
app.get("/health", (_, res) => res.status(200).send("ok"));

/**
 * =========================
 * 定数
 * =========================
 */
const START_SIGNAL = "はじめる";

/**
 * =========================
 * LINE署名検証
 * =========================
 */
function validateLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const computed = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

  return computed === signature;
}

/**
 * =========================
 * Webhook
 * =========================
 */
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    req.rawBody = req.body;

    if (!validateLineSignature(req)) {
      console.error("signature validation failed");
      return res.sendStatus(401);
    }

    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error", e);
      return res.sendStatus(400);
    }

    res.sendStatus(200);
    handleWebhookEvents(body.events).catch(console.error);
  }
);

/**
 * =========================
 * Webhook handler
 * =========================
 */
async function handleWebhookEvents(events = []) {
  for (const event of events) {
    const source = event.source;
    const householdId =
      source.groupId || source.roomId || source.userId;
    const replyToken = event.replyToken;

    // =============================
    // セッション開始（postback / はじめる）
    // =============================
    if (
      event.type === "postback" ||
      (event.type === "message" &&
        event.message?.type === "text" &&
        event.message.text.trim() === START_SIGNAL)
    ) {
      startSession(householdId, crypto.randomUUID());

      // 名前を取得
      const profile = await getLineProfile(source.userId);
      const displayName = profile?.displayName || "あなた";

      // セッションに必要な情報をまとめて入れる
      // ======== ★ 修正版 ★ ========
const session = getSession(householdId);

// parents 構造を初期化（なければ作る）
if (!session.parents) {
  session.parents = {
    A: null,
    B: null,
  };
}

// まだ誰もいなければ、この人を A にする
if (!session.parents.A) {
  session.parents.A = {
    userId: source.userId,
    name: displayName,
  };
  console.log("[PARENTS] Aに登録:", session.parents.A);
}

// いま話している人を currentUser として保持（既存ロジックは維持）
session.currentUserId = source.userId;
session.currentUserName = displayName;
session.finishedUsers = [];

      // ★ 追加：シーン周回用の状態
session.usedSceneIds = [];
session.lastCategory = null;

      await sendSceneAndEmotion(replyToken, householdId);
      continue;
    }

    // =============================
    // テキストメッセージ処理
    // =============================
    if (event.type === "message" && event.message?.type === "text") {
      const userText = event.message.text.trim();

      if (!isSessionActive(householdId)) {
        await replyText(replyToken, "けみーは聞いてるにゃ🐾");
        continue;
      }

      const session = getSession(householdId);
console.log("[SESSION]", householdId, session.phase);

// ======== ★ ここに追加 ★ ========
// 2人目の登録（B）
if (
  session.parents &&
  session.parents.A &&
  !session.parents.B &&
  session.parents.A.userId !== source.userId
) {
  // A ではない人が初めて発話した → B に登録
  const profileB = await getLineProfile(source.userId);
  const nameB = profileB?.displayName || "あなた";

  session.parents.B = {
    userId: source.userId,
    name: nameB,
  };

  console.log("[PARENTS] Bに登録:", session.parents.B);
}


      // ユーザー発話を保存
      await saveMessage({
        householdId,
        role: "A",
        text: userText,
        sessionId: session.sessionId,
      });

      // ★★★★★ ここから switch ★★★★★
      switch (session.phase) {

        /**
         * ① scene + emotion → ② 価値観／社会規範へ
         */
       case "scene_emotion": {
  console.log("[DEBUG] scene_emotion 入力:", userText);

  // 感情を保存
  session.lastEmotionAnswer = userText;
         updateContext(session);

  // ★ いきなり次は「AIクイックリプライフェーズ」
  session.phase = "value_norm_choice";
  console.log("[DEBUG] phase -> value_norm_choice");

  // ★ ここで“質問＋選択肢”をまとめて出す
  const options = await generateValueOptions(session.context);


  const msg = `${session.currentUserName}さん、
その気持ちの裏に、どんな考えがありそうかにゃ？
いちばん近いものをえらんでほしいにゃ🐾`;

  await replyQuickText(replyToken, msg, options);
  break;
}




case "value_norm_choice": {
  console.log("[DEBUG] value_norm_choice 入力:", userText);

  // 選んだ価値観を保存（あとで使う）
  session.lastValueChoice = userText;
  updateContext(session);

  // 次は「背景のクイックリプライ」
  session.phase = "background_choice";
  console.log("[DEBUG] phase -> background_choice");

  // ★ 背景の選択肢をAIに作らせる
  const options = await generateBackgroundOptions({
    emotionAnswer: session.lastEmotionAnswer,
    valueChoice: session.lastValueChoice,
    sceneText: session.sceneId,
  });

  const msg = `${session.currentUserName}さん、
その考えは、どんな経験から生まれたと思うかにゃ？
いちばん近いものをえらんでほしいにゃ🐾`;

  await replyQuickText(replyToken, msg, options);
  break;
}
        case "background_choice": {
  console.log("[DEBUG] background_choice 入力:", userText);

  // 背景を保存
  session.lastBackgroundChoice = userText;
          updateContext(session);

  // 次は「ビジョンのクイックリプライ」
  session.phase = "vision_choice";
  console.log("[DEBUG] phase -> vision_choice");

  // ★ ビジョンの選択肢をAIに作らせる
  const options = await generateVisionOptions({
    emotionAnswer: session.lastEmotionAnswer,
    valueChoice: session.lastValueChoice,
    backgroundChoice: session.lastBackgroundChoice,
    sceneText: session.sceneId,
  });

  const msg = `${session.currentUserName}さん、
この場面で、子どもにどうなってほしいか、
もしくは、どう関わっていきたいかにいちばん近いものをえらんでほしいにゃ🐾`;

  await replyQuickText(replyToken, msg, options);
  break;
}
case "vision_choice": {
  console.log("[DEBUG] vision_choice 入力:", userText);

  // 選んだビジョンを保存
  session.lastVisionChoice = userText;
  updateContext(session);

  // 次はまとめへ
  session.phase = "reflection";
  console.log("[DEBUG] phase -> reflection");

  const reflection = await generateReflection({
    backgroundText: session.lastBackgroundChoice,
    valueChoice: session.lastValueChoice,
    emotionAnswer: session.lastEmotionAnswer,
    visionChoice: session.lastVisionChoice,
  });

  await saveMessage({
    householdId,
    role: "AI",
    text: reflection,
    sessionId: session.sessionId,
  });

  await replyText(replyToken, reflection);

  // ★★★ ここでセッション完結処理 ★★★
  session.finishedUsers.push(session.currentUserId);
  // ======== ★ 追加 ★ ========
session.finishedUsers = session.finishedUsers || [];
session.finishedUsers.push(source.userId);
console.log("[FINISHED]", session.finishedUsers);

  endSession(householdId);

  // TODO: もう一方の親に①を投げる処理をここに追加（後述）
  break;
}







        /**
         * ③ background → ④ まとめ（reflection）
         */
        case "background": {
          const reflection = await generateReflection({
            backgroundText: userText,
          });

          session.phase = "reflection";

          await saveMessage({
            householdId,
            role: "AI",
            text: reflection,
            sessionId: session.sessionId,
          });

          await replyText(replyToken, reflection);
          break;
        }

        /**
         * ④ reflection → セッション終了
         */
        case "reflection": {
          session.phase = "closing";

          await replyText(
            replyToken,
            `${session.currentUserName}さん、
ここまで一緒に考えてくれてありがとうにゃ🐾
今日は、気持ちの奥にある見え方が
少し整理できた気がするにゃ。

また別の場面でも考えてみるにゃ🐾`
          );

          endSession(householdId);
          break;
        }

        default: {
          console.warn("未知のフェーズ:", session.phase);
          await replyText(replyToken, "けみーは聞いてるにゃ🐾");
          break;
        }
      }
      // ★★★★★ switch ここまで ★★★★★
    }
  }
}
/**
 * =========================
 * scene + emotion
 * =========================
 */
async function sendSceneAndEmotion(replyToken, householdId) {
  const session = getSession(householdId);

  // ★ 変更：ランダムではなく pickNextScene を使う
  const scene = await pickNextScene(session);

  if (!scene) {
    await replyText(replyToken, "ごめんにゃ、準備中みたいにゃ🐾");
    return;
  }

  // シーン本文を session に保存（AI用）
  session.sceneText = scene.scene_text;

  // 感情の選択肢（いまのまま）
  const examples = await getEmotionExamples();
  const options = examples.map(e => e.label);

  const message = `
${session.currentUserName}さん、けみーだにゃ🐾
ちょっと考えてほしい場面があるにゃ。

${scene.scene_text}

この場面を思い浮かべたとき、
いちばん最初に浮かんだ気持ちを
えらんでほしいにゃ🐾
`;

  session.phase = "scene_emotion";

  await replyQuickText(replyToken, message, options);
}


async function pickNextScene(session) {
  // ① すべてのアクティブなシーンを取得
  const { data: allScenes, error } = await supabase
    .from("scenes")
    .select("id, scene_text, category")
    .eq("is_active", true);

  if (error || !allScenes || allScenes.length === 0) {
    throw new Error("No active scenes found");
  }

  const used = session.usedSceneIds || [];
  const lastCat = session.lastCategory;

  // ② まだ使っていないシーンだけに絞る
  let candidates = allScenes.filter(
    s => !used.includes(s.id)
  );

  // ③ 直前と同じカテゴリーをなるべく避ける
  let filtered = candidates.filter(
    s => s.category !== lastCat
  );

  // ④ もし候補がゼロなら「一周完了」→ リセットして再抽選
  if (filtered.length === 0) {
    console.log("[SCENE] 1周完了 → usedSceneIds をリセット");
    session.usedSceneIds = [];
    session.lastCategory = null;

    // 再帰的にやり直し
    return pickNextScene(session);
  }

  // ⑤ ランダムで1つ選ぶ（まんべんなく出る）
  const next =
    filtered[Math.floor(Math.random() * filtered.length)];

  // ⑥ 履歴を更新
  session.usedSceneIds.push(next.id);
  session.lastCategory = next.category;

  return next;
  console.log(
  `[SCENE] picked: ${next.id} / category=${next.category} / used=${session.usedSceneIds.length}`
);

}


/**
 * =========================
 * Server start
 * =========================
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
});
