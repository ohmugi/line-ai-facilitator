// src/api/supabase.js
// Supabase クライアント（Realtime購読専用。書き込みはバックエンドAPI経由）
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);
