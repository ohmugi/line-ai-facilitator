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
import { getEmotionExamples } from "./supabase/emotionExamples.js";
import { getLineProfile } from "./line/getProfile.js";
import { replyQuickText } from "./line/replyQuick.js";
import { pushMessage } from "./line/push.js";
import { supabase } from "./supabase/client.js";
import { pushQuickText } from "./line/pushQuick.js";
import { handleJoin } from "./handlers/join.js";
import { handleFollow } from "./handlers/follow.js";



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
          const profile = await getLineProfile(m.userId);
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

        const profile = await getLineProfile(source.userId);
        const displayName = profile?.displayName || "あなた";

        const session = getSession(householdId);

        // parents 初期化（なければ作る）
        if (!session.parents) {
          session.parents = { A: null, B: null };
        }

        // この人を A として登録（暫定）
        session.parents.A = {
          userId: source.userId,
          name: displayName,
        };

        // 先攻をランダム決定（まだ決まっていなければ）
        if (!session.firstSpeaker) {
          session.firstSpeaker = Math.random() < 0.5 ? "A" : "B";
          console.log("[TURN] firstSpeaker:", session.firstSpeaker);
        }

        session.turn = session.firstSpeaker;
        session.currentUserId = source.userId;
        session.currentUserName = displayName;
        session.finishedUsers = [];

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

        // ======== switch ========
        switch (session.phase) {
          case "scene_emotion": {
            console.log("[DEBUG] scene_emotion 入力:", userText);

            session.lastEmotionAnswer = userText;
            updateContext(session);

            session.phase = "value_norm_choice";
            console.log("[DEBUG] phase -> value_norm_choice");

            const options = await generateValueOptions(session.context);

            const msg = `${session.currentUserName}さん、
その気持ちの裏に、どんな考えがありそうかにゃ？
近いものをえらんでもいいし、
しっくり来なければ自由に書いてほしいにゃ🐾`;

            await replyQuickText(replyToken, msg, options);
            break;
          }

          case "value_norm_choice": {
            console.log("[DEBUG] value_norm_choice 入力:", userText);

            session.lastValueChoice = userText;
            updateContext(session);

            session.phase = "background_choice";
            console.log("[DEBUG] phase -> background_choice");

            const options = await generateBackgroundOptions({
              emotionAnswer: session.lastEmotionAnswer,
              valueChoice: session.lastValueChoice,
              sceneText: session.sceneId,
            });

            const msg = `${session.currentUserName}さん、
その考えは、どんな経験から生まれたと思うかにゃ？
近いものをえらんでもいいし、
しっくり来なければ自由に書いてほしいにゃ🐾`;

            await replyQuickText(replyToken, msg, options);
            break;
          }

          case "background_choice": {
            console.log("[DEBUG] background_choice 入力:", userText);

            session.lastBackgroundChoice = userText;
            updateContext(session);

            session.phase = "vision_choice";
            console.log("[DEBUG] phase -> vision_choice");

            const options = await generateVisionOptions({
              emotionAnswer: session.lastEmotionAnswer,
              valueChoice: session.lastValueChoice,
              backgroundChoice: session.lastBackgroundChoice,
              sceneText: session.sceneId,
            });

            const msg = `${session.currentUserName}さん、
この場面で、子どもにどうなってほしいか、
もしくは、どう関わっていきたいかにゃ？
近いものをえらんでもいいし、
ぴったり来なければ自由に書いてほしいにゃ🐾`;

            await replyQuickText(replyToken, msg, options);
            break;
          }

          case "vision_choice": {
            console.log("[DEBUG] vision_choice 入力:", userText);

            session.lastVisionChoice = userText;
            updateContext(session);

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
            session.finishedUsers = session.finishedUsers || [];
            session.finishedUsers.push(source.userId);
            console.log("[FINISHED]", session.finishedUsers);

            endSession(householdId);
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
      console.error("[handleWebhookEvents ERROR]", err);
    }
  }
}

/**
 /**
 * =========================
 * scene + emotion（push版）
 * =========================
 */
async function startFirstSceneByPushWithTarget(householdId) {
  const session = getSession(householdId);
  const scene = await pickNextScene(session);
  const examples = await getEmotionExamples();
  const options = examples.map(e => e.label);

  const msg = `${session.currentUserName}さんへ：${scene.scene_text}
近いものをえらんでもいいし、ぴったり来なければ自由に書いてほしいにゃ🐾`;

  session.sceneText = scene.scene_text;
  session.phase = "scene_emotion";

  await pushQuickText(householdId, msg, options);
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
console.log("ABOUT TO LISTEN");

app.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on ${PORT}`);
  console.log(`server running on ${PORT}`);

});
