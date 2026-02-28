//src/db/scenes.js
import { supabase } from "../supabase/client.js";

export async function getActiveScene() {
  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("is_active", true)
    .limit(1);
  if (error) {
    console.error("getActiveScene error:", error);
    return null;
  }
  return data?.[0] ?? null;
}

// ★ 追加
export async function getSceneById(sceneId) {
  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("id", sceneId)
    .single();

  if (error) {
    console.error("[getSceneById ERROR]", error);
    return null;
  }

  return data;
}
