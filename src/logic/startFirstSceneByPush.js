// src/logic/startFirstSceneByPush.js
import { getSession, saveSession } from "../session/sessionManager.js";
import { generateStep1Options } from "../ai/generateStep1.js";
import { pushQuickText } from "../line/pushQuick.js";
import { pushQuickMention } from "../line/pushQuickMention.js";
import { supabase } from "../supabase/client.js";

/**
 * 子どもの年齢からage_groupを返す
 */
async function getHouseholdAgeGroup(householdId) {
  const { data } = await supabase
    .from("households")
    .select("child_birth_year, child_birth_month")
    .eq("group_id", householdId)
    .maybeSingle();

  if (!data?.child_birth_year) return "universal";

  const now = new Date();
  let age = now.getFullYear() - data.child_birth_year;
  if (now.getMonth() + 1 < data.child_birth_month) age--;

  if (age <= 5) return "toddler";
  if (age <= 12) return "child";
  if (age <= 18) return "teen";
  return "universal";
}

/**
 * pickNextScene関数
 */
async function pickNextScene(session, ageGroup = "universal") {
  // 年齢に合うシナリオ + universal シナリオの両方を対象にする
  const ageGroups = ageGroup === "universal" ? ["universal"] : [ageGroup, "universal"];

  const { data: allScenes, error } = await supabase
    .from("scenes")
    .select("id, scene_text, category")
    .eq("is_active", true)
    .in("age_group", ageGroups);

  if (error || !allScenes || allScenes.length === 0) {
    throw new Error("No active scenes found");
  }

  const used = session.usedSceneIds || [];
  const lastCat = session.lastCategory;

  let candidates = allScenes.filter(s => !used.includes(s.id));
  let filtered = candidates.filter(s => s.category !== lastCat);

  if (filtered.length === 0) {
    console.log("[SCENE] 1周完了 → usedSceneIds をリセット");
    session.usedSceneIds = [];
    session.lastCategory = null;
    return pickNextScene(session);
  }

  const next = filtered[Math.floor(Math.random() * filtered.length)];

  if (!session.usedSceneIds) session.usedSceneIds = [];
  session.usedSceneIds.push(next.id);
  session.lastCategory = next.category;

  console.log(
    `[SCENE] picked: ${next.id} / category=${next.category} / used=${session.usedSceneIds.length}`
  );

  return next;
}

/**
 * シナリオ開始(push版)
 */
export async function startFirstSceneByPush(householdId) {
  const session = getSession(householdId);
  const ageGroup = await getHouseholdAgeGroup(householdId);
  const scene = await pickNextScene(session, ageGroup);
  
  session.sceneId = scene.id;
  session.sceneText = scene.scene_text;
  
  const optionTexts = await generateStep1Options({ sceneText: scene.scene_text });

  const msg = `じゃあ、さっそくひとつ聞いてみるにゃ🐾

${scene.scene_text}

選択肢から選んでもいいし、
自分の言葉で書いてくれてもいいにゃ🐾`;

  session.phase = "scene_emotion";

  // currentUserId/Name を優先、なければ parents から解決
  const firstUser = session.currentUserId && session.currentUserName
    ? { userId: session.currentUserId, name: session.currentUserName }
    : session.parents?.[session.firstSpeaker] || session.parents?.A || session.parents?.B;

  console.log("[startFirstSceneByPush] firstSpeaker:", session.firstSpeaker);
  console.log("[startFirstSceneByPush] parents:", JSON.stringify(session.parents));
  console.log("[startFirstSceneByPush] firstUser:", firstUser);

  // 次の「再開」で使えるよう最後のbot発言を保存
  session.lastBotMessage = { text: msg, options: optionTexts };
  await saveSession(householdId);

  if (firstUser) {
    await pushQuickMention(
      householdId,
      msg,
      optionTexts,
      firstUser.userId,
      firstUser.name
    );
  } else {
    console.log("[startFirstSceneByPush] FALLBACK: no firstUser, using pushQuickText");
    await pushQuickText(householdId, msg, optionTexts);
  }
}

/**
 * シナリオ開始(ターゲット指定版)
 */
export async function startFirstSceneByPushWithTarget(householdId) {
  const session = getSession(householdId);
  const ageGroup = await getHouseholdAgeGroup(householdId);
  const scene = await pickNextScene(session, ageGroup);

  session.sceneId = scene.id;
  session.sceneText = scene.scene_text;

  const optionTexts = await generateStep1Options({ sceneText: scene.scene_text });

  const msg = `お待たせしたにゃ🐾 次はあなたの番だにゃ。

${scene.scene_text}

選択肢から選んでもいいし、
自分の言葉で書いてくれてもいいにゃ🐾`;

  session.phase = "scene_emotion";

  // 次の「再開」で使えるよう最後のbot発言を保存
  session.lastBotMessage = { text: msg, options: optionTexts };
  await saveSession(householdId);

  const targetUser = session.currentUserId && session.currentUserName
    ? { userId: session.currentUserId, name: session.currentUserName }
    : null;

  console.log("[startFirstSceneByPushWithTarget] targetUser:", targetUser);

  if (targetUser) {
    await pushQuickMention(householdId, msg, optionTexts, targetUser.userId, targetUser.name);
  } else {
    await pushQuickText(householdId, msg, optionTexts);
  }
}
