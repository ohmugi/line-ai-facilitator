// src/server.js
console.log("SERVER FILE LOADED");
console.log("SERVER BOOT START");


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
import { getStep1Options } from "./supabase/step1Options.js";  // ★ 変更
import { getLineProfile } from "./line/getProfile.js";
import { replyQuickText } from "./line/replyQuick.js";
import { pushMessage } from "./line/push.js";
import { supabase } from "./supabase/client.js";
import { pushQuickText } from "./line/pushQuick.js";
import { pushQuickMention } from "./line/pushQuickMention.js";
import { handleJoin } from "./handlers/join.js";
import { handleFollow } from "./handlers/follow.js";
import { startFirstSceneByPush, startFirstSceneByPushWithTarget } from "./logic/startFirstSceneByPush.js";



// AI
import { generateReflection } from "./ai/generateReflection.js";
import { generateStep2Question, generateStep2Options } from "./ai/generateStep2.js";
import { generateStep3Question, generateStep3Options } from "./ai/generateStep3.js";
import { generateStep4Question, generateStep4Options } from "./ai/generateStep4.js";



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
    try {
      console.log("=== EVENT RECEIVED ===");
      console.log(JSON.stringify(event, null, 2));
      console.log("[EVENT]", event.type);
      console.log("EVENT TYPE:", event.type);

      const source = event.source;
      const householdId = source.groupId || source.roomId || source.userId;
      const replyToken = event.replyToken;

      // =============================
      // memberJoined（メンバーが追加された）
      // =============================
      if (event.type === "memberJoined") {
        const session = getSession(householdId);
        if (!session.parents) session.parents = { A: null, B: null };

        for (const m of event.joined.members) {
          const profile = await getLineProfile(m.userId, householdId);
          const name = profile?.displayName || "あなた";

          if (!session.parents.A) {
            session.parents.A = { userId: m.userId, name };
          } else if (!session.parents.B && session.parents.A.userId !== m.userId) {
            session.parents.B = { userId: m.userId, name };
          }
        }

        // 2人揃ったらランダムで指定して開始
        if (session.parents.A && session.parents.B && !session.started) {
          session.started = true;
          const first = Math.random() < 0.5 ? session.parents.A : session.parents.B;
          session.currentUserId = first.userId;
          session.currentUserName = first.name;

          await startFirstSceneByPushWithTarget(householdId);
        }

        continue;
      }

      /**
       * =============================
       * グループにけみーが追加されたとき（自動オンボーディング）
       * =============================
       */
if (event.type === "join") {
  await handleJoin({
    event,
    householdId,
    replyToken,
    startSession,
    getSession,
  });

  // ★もし startFirstSceneByPush が server.js 内関数なら、ここで呼ぶ
  // await startFirstSceneByPush(householdId);

  continue;
}

if (event.type === "follow") {
  await handleFollow({ event, replyToken });
  continue;
}

      // =============================
      // セッション開始（postback / はじめる）
      // =============================
    if (
  event.type === "postback" ||
  (event.type === "message" &&
    event.message?.type === "text" &&
    event.message.text.trim() === START_SIGNAL)
) {
  console.log("[SESSION] manual start triggered");

  startSession(householdId, crypto.randomUUID());

  const profile = await getLineProfile(source.userId, householdId);
  const displayName = profile?.displayName || "あなた";

  const session = getSession(householdId);

  // parents 初期化(なければ作る)
  if (!session.parents) {
    session.parents = { A: null, B: null };
  }

  // この人を A として登録(暫定)
  session.parents.A = {
    userId: source.userId,
    name: displayName,
  };

  // 先攻をランダム決定(まだ決まっていなければ)
  if (!session.firstSpeaker) {
    session.firstSpeaker = Math.random() < 0.5 ? "A" : "B";
    console.log("[TURN] firstSpeaker:", session.firstSpeaker);
  }

  session.turn = session.firstSpeaker;
  session.currentUserId = source.userId;
  session.currentUserName = displayName;
  session.finishedUsers = [];  // ★ 初期化

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

        // ======== 2人目の登録（B） ========
        if (
          session.parents &&
          session.parents.A &&
          !session.parents.B &&
          session.parents.A.userId !== source.userId
        ) {
          const profileB = await getLineProfile(source.userId, householdId);
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

        // ======== switch ========
        switch (session.phase) {
          case "scene_emotion": {
  console.log("[DEBUG] scene_emotion 入力:", userText);

  session.lastEmotionAnswer = userText;
  updateContext(session);

  session.phase = "value_norm_choice";
  console.log("[DEBUG] phase -> value_norm_choice");

  // ★ Claude APIで質問と選択肢を生成
  let question, options;
  try {
    question = await generateStep2Question({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      userName: session.currentUserName,
    });
    options = await generateStep2Options({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
    });
  } catch (e) {
    console.error("[Claude ERROR] step2:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "scene_emotion";
    break;
  }

  await replyQuickText(replyToken, question, options);
  break;
}

          case "value_norm_choice": {
  console.log("[DEBUG] value_norm_choice 入力:", userText);

  session.lastValueChoice = userText;
  updateContext(session);

  session.phase = "background_choice";
  console.log("[DEBUG] phase -> background_choice");

  // ★ Claude APIで質問と選択肢を生成
  let question, options;
  try {
    question = await generateStep3Question({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      userName: session.currentUserName,
    });
    options = await generateStep3Options({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
    });
  } catch (e) {
    console.error("[Claude ERROR] step3:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "value_norm_choice";
    break;
  }

  await replyQuickText(replyToken, question, options);
  break;
}

         case "background_choice": {
  console.log("[DEBUG] background_choice 入力:", userText);

  session.lastBackgroundChoice = userText;
  updateContext(session);

  session.phase = "vision_choice";
  console.log("[DEBUG] phase -> vision_choice");

  // ★ Claude APIで質問と選択肢を生成
  let question, options;
  try {
    question = await generateStep4Question({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      backgroundChoice: session.lastBackgroundChoice,
      userName: session.currentUserName,
    });
    options = await generateStep4Options({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      backgroundChoice: session.lastBackgroundChoice,
    });
  } catch (e) {
    console.error("[Claude ERROR] step4:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "background_choice";
    break;
  }

  await replyQuickText(replyToken, question, options);
  break;
}

         case "vision_choice": {
  console.log("[DEBUG] vision_choice 入力:", userText);

  session.lastVisionChoice = userText;
  updateContext(session);

  session.phase = "finishing";
  console.log("[DEBUG] phase -> finishing");

  let reflection;
  try {
    reflection = await generateReflection({
      sceneText: session.sceneText,
      emotionAnswer: session.lastEmotionAnswer,
      valueChoice: session.lastValueChoice,
      backgroundChoice: session.lastBackgroundChoice,
      visionChoice: session.lastVisionChoice,
      userName: session.currentUserName,
    });
  } catch (e) {
    console.error("[Claude ERROR] reflection:", e?.message || e);
    await replyText(replyToken, "ちょっと考え中だにゃ🐾 もう一度送ってみてにゃ");
    session.phase = "vision_choice";
    break;
  }

  await saveMessage({
    householdId,
    role: "AI",
    text: reflection,
    sessionId: session.sessionId,
  });

  await replyText(replyToken, reflection);

  // ★★★ 夫婦交互ロジック ★★★
  session.finishedUsers = session.finishedUsers || [];
  session.finishedUsers.push(source.userId);
  console.log("[FINISHED]", session.finishedUsers);

  // 2人揃ってるかチェック
  const parents = session.parents;
  if (parents && parents.A && parents.B) {
    const bothFinished = 
      session.finishedUsers.includes(parents.A.userId) &&
      session.finishedUsers.includes(parents.B.userId);

    if (bothFinished) {
      // ★ 両方終わったらセッション完了
      console.log("[SESSION] 両方完了、セッション終了");
      endSession(householdId);
    } else {
      // ★ まだ片方だけ → もう片方に通知
      const nextUser = session.finishedUsers.includes(parents.A.userId)
        ? parents.B
        : parents.A;

      console.log("[TURN] 次は", nextUser.name, "の番");
      
      session.currentUserId = nextUser.userId;
      session.currentUserName = nextUser.name;
      session.phase = "scene_emotion";
      
      // ★ 回答履歴をリセット(次の人用)
      session.lastEmotionAnswer = null;
      session.lastValueChoice = null;
      session.lastBackgroundChoice = null;
      session.lastVisionChoice = null;
      
      // ★ 同じシナリオで、次の人にメンション付きpush通知
      const options = await getStep1Options(session.sceneId);
      const optionTexts = options.map(o => o.option_text);

      const msg = `お待たせしたにゃ🐾 次はあなたの番だにゃ。

${session.sceneText}

選択肢から選んでもいいし、
自分の言葉で書いてくれてもいいにゃ🐾`;

      await pushQuickMention(
        householdId,
        msg,
        optionTexts,
        nextUser.userId,
        nextUser.name
      );
    }
  } else {
    // ★ まだ1人しか登録されてない場合は、とりあえず終了
    console.log("[SESSION] 1人しか登録されてないため終了");
    endSession(householdId);
  }

  break;
}

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

        continue;
      }

      console.log("[IGNORED EVENT]", event.type);
    } catch (err) {
      console.error("[handleWebhookEvents ERROR]", err?.message || err?.code || String(err), err);
    }
  }
}

/**
 /**
 * =========================
 * scene + emotion（push版）
 * =========================
 */









/**
 * =========================
 * Server start
 * =========================
 */
const PORT = process.env.PORT || 3000;
console.log("ABOUT TO LISTEN");

app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
  console.log(`server running on ${PORT}`);

});
