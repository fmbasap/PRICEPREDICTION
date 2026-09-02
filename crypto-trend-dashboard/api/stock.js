// Vercel Serverless Function
// 브라우저에서 Yahoo Finance를 직접 호출하면 CORS에 막히므로,
// 서버(이 함수) 쪽에서 대신 요청해서 결과만 넘겨줍니다.
export default async function handler(req, res) {
  const { symbol = "005930.KS", range = "3mo", interval = "1d" } = req.query;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${range}&interval=${interval}`;

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CryptoTrendDashboard/1.0)" },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance 응답 오류 (${response.status})`);
    }

    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      throw new Error("데이터가 없습니다");
    }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    const prices = timestamps
      .map((t, i) => [t * 1000, closes[i]])
      .filter(([, close]) => close != null);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    res.status(200).json({ prices });
  } catch (err) {
    res.status(500).json({ error: err.message || "주가 데이터를 가져오지 못했습니다" });
  }
}
