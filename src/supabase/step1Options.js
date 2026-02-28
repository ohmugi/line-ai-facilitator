// src/supabase/step1Options.js
import { supabase } from "./client.js";

/**
 * 指定したシナリオのStep1選択肢を取得
 */
export async function getStep1Options(sceneId) {
  const { data, error } = await supabase
    .from("step1_options")
    .select("option_text, display_order")
    .eq("scene_id", sceneId)
    .order("display_order");

  if (error) {
    console.error("[getStep1Options ERROR]", error);
    return [];
  }

  return data || [];
}
