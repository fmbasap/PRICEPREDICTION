import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client = null;
let debugInfo = "";

if (!supabaseUrl && !supabaseAnonKey) {
  debugInfo = "환경변수 2개 다 비어있음 (빌드에 반영 안 됨)";
} else if (!supabaseUrl) {
  debugInfo = "VITE_SUPABASE_URL이 비어있음";
} else if (!supabaseAnonKey) {
  debugInfo = "VITE_SUPABASE_ANON_KEY가 비어있음";
} else {
  try {
    client = createClient(supabaseUrl, supabaseAnonKey);
    debugInfo = `연결 시도됨 (URL 앞부분: ${supabaseUrl.slice(0, 20)}...)`;
  } catch (e) {
    debugInfo = `클라이언트 생성 실패: ${e.message}`;
    client = null;
  }
}

export const supabase = client;
export const supabaseDebugInfo = debugInfo;
