// Vercel Serverless Function
// 브라우저에서 Yahoo Finance를 직접 호출하면 CORS에 막히므로,
// 서버(이 함수) 쪽에서 대신 요청해서 결과만 넘겨줍니다.
const INDICES = [
  { symbol: "^KS11", label: "코스피" },
  { symbol: "^IXIC", label: "나스닥 종합" },
];

async function fetchIndex(symbol, label) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=5d&interval=1d`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CryptoTrendDashboard/1.0)" },
  });
  if (!response.ok) throw new Error(`Yahoo Finance 응답 오류 (${response.status})`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("데이터가 없습니다");

  const meta = result.meta || {};
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : null;

  return { symbol, label, price, prevClose, changePct, currency: meta.currency || null };
}

export default async function handler(req, res) {
  try {
    const results = await Promise.all(
      INDICES.map(({ symbol, label }) =>
        fetchIndex(symbol, label).catch((err) => ({ symbol, label, error: err.message }))
      )
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    res.status(200).json({ indices: results, asOf: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message || "지수 데이터를 가져오지 못했습니다" });
  }
}
