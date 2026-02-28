// src/logic/startFirstSceneByPush.js
import { getSession } from "../session/sessionManager.js";
import { supabase } from "../supabase/client.js";
import { getEmotionExamples } from "../supabase/emotionExamples.js";
import { pushQuickText } from "../line/pushQuick.js";

async function pickNextScene(session) {
  const { data: allScenes, error } = await supabase
    .from("scenes")
    .select("id, scene_text, category")
    .eq("is_active", true);

  if (error || !allScenes || allScenes.length === 0) {
    throw new Error("No active scenes found");
  }

  if (!session.usedSceneIds) session.usedSceneIds = [];

  const used = session.usedSceneIds;
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
  session.usedSceneIds.push(next.id);
  session.lastCategory = next.category;

  console.log(`[SCENE] picked: ${next.id} / category=${next.category} / used=${session.usedSceneIds.length}`);
  return next;
}

export async function startFirstSceneByPush(householdId) {
  const session = getSession(householdId);
  const scene = await pickNextScene(session);
  const examples = await getEmotionExamples();
  const options = examples.map(e => e.label);

  const msg = `${scene.scene_text}
近いものをえらんでもいいし、ぴったり来なければ自由に書いてほしいにゃ🐾`;

  session.sceneText = scene.scene_text;
  session.phase = "scene_emotion";

  await pushQuickText(householdId, msg, options);
}
