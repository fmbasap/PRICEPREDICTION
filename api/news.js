// Vercel Serverless Function
// 브라우저에서 Anthropic API를 직접 호출하면 인증/CORS에 막히므로,
// 서버(이 함수) 쪽에서 환경변수의 API 키로 대신 요청합니다.
const ASSET_NAMES = {
  XRP: "XRP(리플)",
  FLR: "Flare(FLR, 플레어)",
};

export default async function handler(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다." });
    return;
  }

  const assetKey = (req.query.asset || "XRP").toUpperCase();
  const assetName = ASSET_NAMES[assetKey] || assetKey;

  const prompt = `당신은 암호화폐 뉴스 분석가입니다. 웹 검색으로 지난 24~48시간 이내의 ${assetName} 관련
최신 뉴스를 조사하세요. 가격, 규제, 파트너십, 생태계 발전 등 시장 심리에 영향을 줄 만한 소식을 우선하세요.

조사한 뉴스 전반의 분위기를 0~100 점수로 매기세요. 0은 매우 부정적, 50은 중립, 100은 매우 긍정적입니다.

조사 후 아래 JSON 형식으로만 답하세요. 설명, 마크다운 코드블록, 다른 텍스트 없이 순수 JSON만 출력하세요.

{
  "score": 0부터 100 사이의 정수
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API 오류 (${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const fullText = (data.content || [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
    const clean = fullText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message || "뉴스를 불러오지 못했습니다" });
  }
}
