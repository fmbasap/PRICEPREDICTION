// Vercel Serverless Function
// XRPScan에서 주요 지갑 잔고를 조회하고, Supabase에 스냅샷을 쌓아서
// 24시간 전 대비 순유입/유출을 계산합니다.
//
// 검증된 주소만 포함합니다 (틀린 주소는 데이터 자체가 의미 없어지므로).
// 새 주소를 추가하려면 WATCHED_ADDRESSES 배열에 추가하세요.
const WATCHED_ADDRESSES = [
  { address: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY", label: "Ripple Escrow" },
  { address: "rwpTh9DDa52XkM9nTKp2QrJuCGV5d1mQVP", label: "Coinbase" },
];

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 응답이 늦는 외부 API가 함수 전체를 타임아웃으로 끌고 가지 않도록 타임아웃 제한
async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchXrpBalance(address) {
  const res = await fetchWithTimeout(`https://api.xrpscan.com/api/v1/account/${address}`);
  if (!res.ok) throw new Error(`XRPScan 조회 실패 (${res.status})`);
  const data = await res.json();
  return parseFloat(data.xrpBalance);
}

async function insertSnapshot(address, label, balance) {
  await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/exchange_balance_snapshots`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ address, label, balance }),
  });
}

async function fetchPreviousSnapshot(address) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/exchange_balance_snapshots?address=eq.${encodeURIComponent(
    address
  )}&captured_at=lte.${encodeURIComponent(cutoff)}&order=captured_at.desc&limit=1`;
  const res = await fetchWithTimeout(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// 주소 하나 처리 - 실패해도 예외를 던지지 않고 에러 정보를 담아 반환 (다른 주소에 영향 안 주도록)
async function processAddress(address, label) {
  try {
    const balance = await fetchXrpBalance(address);
    let previous = null;
    try {
      previous = await fetchPreviousSnapshot(address);
    } catch {
      previous = null; // 이전 스냅샷 조회 실패해도 현재 잔고는 보여줌
    }
    try {
      await insertSnapshot(address, label, balance);
    } catch {
      // 저장 실패해도 지금 조회한 값은 화면에 보여줌
    }

    const previousBalance = previous ? parseFloat(previous.balance) : null;
    const delta = previousBalance != null ? balance - previousBalance : null;

    return {
      address,
      label,
      balance,
      previousBalance,
      delta,
      previousCapturedAt: previous ? previous.captured_at : null,
      error: null,
    };
  } catch (err) {
    return { address, label, balance: null, previousBalance: null, delta: null, error: err.message || "조회 실패" };
  }
}

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      res.status(500).json({ error: "서버에 Supabase 환경변수가 설정되어 있지 않습니다." });
      return;
    }

    const results = await Promise.all(WATCHED_ADDRESSES.map(({ address, label }) => processAddress(address, label)));

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ addresses: results, asOf: new Date().toISOString() });
  } catch (err) {
    // 여기까지 오면 정말 예상 못한 에러 - 그래도 항상 유효한 JSON으로 응답
    res.status(500).json({ error: err.message || "잔고 데이터를 가져오지 못했습니다" });
  }
}
