import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client = null;
if (supabaseUrl && supabaseAnonKey) {
  try {
    client = createClient(supabaseUrl, supabaseAnonKey);
  } catch (e) {
    // URL/키 형식이 잘못돼도 앱 전체가 흰 화면으로 죽지 않도록 방지
    console.error("Supabase 클라이언트 생성 실패:", e);
    client = null;
  }
}

export const supabase = client;
