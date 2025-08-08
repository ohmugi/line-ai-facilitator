// src/lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_*_KEY in environment variables'
  );
}

// サーバー側処理（cron等）では service role キーを使うのが一般的
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

export default supabase;
