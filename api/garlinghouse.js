// Vercel Serverless Function
// 고정 타임라인(GARLINGHOUSE_TIMELINE, ~2026-07까지) 이후의 최신 발언을 검색으로 찾아옵니다.
const SYSTEM_INSTRUCTIONS = `당신은 크립토 업계 뉴스 리서처입니다. 웹 검색은 최대 2회까지만 쓸 수 있습니다.

브래드 갈링하우스(Ripple CEO)가 ${new Date().getFullYear()}년에 한 발언·인터뷰·SNS 게시물 중,
아래에서 알려주는 기준일(since) 이후의 것만 찾으세요. 이미 잘 알려진 과거 발언(SEC 소송, 상장 등)은
제외하고, 최근 것만 다루세요. 찾은 게 없으면 빈 배열을 반환하세요.

각 항목은 원문을 그대로 인용하지 말고 본인 언어로 짧게 요약하세요 (한 항목당 1~2문장).

답변은 아래 JSON 형식으로만 하세요. 설명, 마크다운 코드블록, 다른 텍스트 없이 순수 JSON만 출력하세요.

{
  "entries": [
    { "date": "YYYY-MM(-DD)", "period": "짧은 소제목", "text": "요약 내용" }
  ]
}`;

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다." });
    return;
  }

  const since = req.query.since || "2026-07";

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
        system: [{ type: "text", text: SYSTEM_INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `기준일(since): ${since}` }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
      }),
    });

    const data = await response.json();
    const fullText = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (!response.ok) {
      res.status(response.status).json({ error: data.error?.message || "Anthropic API 오류" });
      return;
    }

    let parsed;
    try {
      const cleaned = fullText.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
      parsed = JSON.parse(cleaned);
    } catch {
      res.status(500).json({ error: "응답 파싱에 실패했습니다" });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ entries: parsed.entries || [] });
  } catch (err) {
    res.status(500).json({ error: err.message || "발언을 가져오지 못했습니다" });
  }
}
