// Vercel Serverless Function
// 브라우저에서 Polymarket Gamma API를 직접 호출하면 CORS에 막히므로,
// 서버(이 함수) 쪽에서 대신 요청해서 결과만 넘겨줍니다.
export default async function handler(req, res) {
  const q = req.query.q || "XRP";

  try {
    const url = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(
      q
    )}&events_status=active&limit_per_type=15`;

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CryptoTrendDashboard/1.0)" },
    });

    if (!response.ok) {
      throw new Error(`Polymarket API 오류 (${response.status})`);
    }

    const data = await response.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || "예측시장 데이터를 가져오지 못했습니다" });
  }
}
