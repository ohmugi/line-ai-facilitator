// src/logic/startFirstSceneByPush.js
import { getSession, saveSession } from "../session/sessionManager.js";
import { generateStep1Options } from "../ai/generateStep1.js";
import { pushQuickText } from "../line/pushQuick.js";
import { pushQuickMention } from "../line/pushQuickMention.js";
import { supabase } from "../supabase/client.js";

/**
 * 生年月から日本の学年を計算してage_groupを返す
 *
 * 日本の学年区切り：4月2日〜翌4月1日生まれが同学年
 * birth_dayは未取得のため月で近似：
 *   1〜3月生まれ → 入学年 = birthYear + 6
 *   4〜12月生まれ → 入学年 = birthYear + 7
 *
 * grade <= 0        : toddler         (未就学)
 * grade 1〜3        : elementary_lower (小1〜小3)
 * grade 4〜6        : elementary_upper (小4〜小6)
 * grade 7〜12       : teen             (中1〜高3)
 * grade > 12        : universal
 */
async function getHouseholdAgeGroup(householdId) {
  const { data } = await supabase
    .from("households")
    .select("child_birth_year, child_birth_month")
    .eq("group_id", householdId)
    .maybeSingle();

  if (!data?.child_birth_year) return "universal";

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentSchoolYear = currentMonth >= 4 ? now.getFullYear() : now.getFullYear() - 1;

  // 入学年度の計算（4月2日以降生まれを月で近似）
  const schoolEntryYear = data.child_birth_month <= 3
    ? data.child_birth_year + 6
    : data.child_birth_year + 7;

  const grade = currentSchoolYear - schoolEntryYear + 1;

  if (grade <= 0)  return "toddler";
  if (grade <= 3)  return "elementary_lower";
  if (grade <= 6)  return "elementary_upper";
  if (grade <= 12) return "teen";
  return "universal";
}

/**
 * pickNextScene関数
 */
async function pickNextScene(session, ageGroup = "universal") {
  // 年齢に合うシナリオ + universal シナリオの両方を対象にする
  const ageGroups = ageGroup === "universal" ? ["universal"] : [ageGroup, "universal"];

  const query = supabase
    .from("scenes")
    .select("id, scene_text, category, age_group")
    .eq("is_active", true);

  // universal（生年月未設定）は全シーン対象、それ以外は age_group でフィルタ
  const { data: allScenes, error } = ageGroup === "universal"
    ? await query
    : await query.in("age_group", ageGroups);

  if (error || !allScenes || allScenes.length === 0) {
    console.error("[pickNextScene] query error:", error, "count:", allScenes?.length);
    throw new Error("No active scenes found");
  }

  console.log(`[pickNextScene] ageGroup=${ageGroup}, count=${allScenes.length}`);

  const used = session.usedSceneIds || [];
  const lastCat = session.lastCategory;

  let candidates = allScenes.filter(s => !used.includes(s.id));
  let filtered = candidates.filter(s => s.category !== lastCat);

  if (filtered.length === 0) {
    if (scenes.length === 0) throw new Error("No active scenes found for ageGroup: " + ageGroup);
    console.log("[SCENE] 1周完了 → usedSceneIds をリセット");
    session.usedSceneIds = [];
    session.lastCategory = null;
    return pickNextScene(session, ageGroup);
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
