//src/db/scenes.js
import { supabase } from "../supabase/client.js";

export async function getActiveScene() {
  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .single();

  if (error) {
    console.error("getActiveScene error:", error);
    return null;
  }

  return data;
}
