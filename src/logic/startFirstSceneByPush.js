// src/logic/startFirstSceneByPush.js
import { getSession } from "../session/sessionManager.js";
import { getStep1Options } from "../supabase/step1Options.js";
import { pushQuickText } from "../line/pushQuick.js";

/**
 * pickNextScene関数
 */
async function pickNextScene(session) {
  const { supabase } = await import("../supabase/client.js");
  
  const { data: allScenes, error } = await supabase.supabase
    .from("scenes")
    .select("id, scene_text, category")
    .eq("is_active", true);

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
  const scene = await pickNextScene(session);
  
  session.sceneId = scene.id;
  session.sceneText = scene.scene_text;
  
  const options = await getStep1Options(scene.id);
  const optionTexts = options.map(o => o.option_text);

  const msg = `じゃあ、さっそくひとつ聞いてみるにゃ🐾

${scene.scene_text}

選択肢から選んでもいいし、
自分の言葉で書いてくれてもいいにゃ🐾`;

  session.phase = "scene_emotion";

  await pushQuickText(householdId, msg, optionTexts);
}

/**
 * シナリオ開始(ターゲット指定版)
 */
export async function startFirstSceneByPushWithTarget(householdId) {
  const session = getSession(householdId);
  const scene = await pickNextScene(session);
  
  session.sceneId = scene.id;
  session.sceneText = scene.scene_text;
  
  const options = await getStep1Options(scene.id);
  const optionTexts = options.map(o => o.option_text);

  const msg = `${session.currentUserName}さん、次はあなたの番だにゃ🐾

${scene.scene_text}

選択肢から選んでもいいし、
自分の言葉で書いてくれてもいいにゃ🐾`;

  session.phase = "scene_emotion";

  await pushQuickText(householdId, msg, optionTexts);
}
