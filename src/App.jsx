import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

const ASSETS = {
  FLR: { id: "flare-networks", label: "Flare", ticker: "FLR", accent: "#E8A33D" },
  XRP: { id: "ripple", label: "XRP", ticker: "XRP", accent: "#4FD1C5" },
};

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
`;

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    if (i <= period) {
      gains += gain;
      losses += loss;
      if (i === period) {
        const avgGain = gains / period;
        const avgLoss = losses / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      const prevAvgGain = out._avgGain ?? gains / period;
      const prevAvgLoss = out._avgLoss ?? losses / period;
      const avgGain = (prevAvgGain * (period - 1) + gain) / period;
      const avgLoss = (prevAvgLoss * (period - 1) + loss) / period;
      out._avgGain = avgGain;
      out._avgLoss = avgLoss;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

function linearRegressionProjection(points, forwardDays) {
  const n = points.length;
  if (n < 2) return [];
  const xs = points.map((_, i) => i);
  const ys = points;
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  const projected = [];
  for (let i = 1; i <= forwardDays; i++) {
    projected.push(intercept + slope * (n - 1 + i));
  }
  return { projected, slope };
}

function fmtPrice(v) {
  if (v == null) return "-";
  if (v < 0.01) return `$${v.toFixed(6)}`;
  if (v < 1) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function CryptoTrendDashboard() {
  const [asset, setAsset] = useState("FLR");
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchAsset = useCallback(async (key) => {
    const meta = ASSETS[key];
    const url = `https://api.coingecko.com/api/v3/coins/${meta.id}/market_chart?vs_currency=usd&days=90&interval=daily`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
    const json = await res.json();
    return json.prices; // [[timestamp, price], ...]
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [flr, xrp] = await Promise.all([fetchAsset("FLR"), fetchAsset("XRP")]);
      setCache({ FLR: flr, XRP: xrp });
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message || "알 수 없는 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }, [fetchAsset]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const analysis = useMemo(() => {
    const raw = cache[asset];
    if (!raw || raw.length < 30) return null;

    const prices = raw.map((p) => p[1]);
    const timestamps = raw.map((p) => p[0]);
    const sma7 = sma(prices, 7);
    const sma25 = sma(prices, 25);
    const rsiVals = rsi(prices, 14);

    const chartData = raw.map((p, i) => ({
      ts: timestamps[i],
      date: fmtDate(timestamps[i]),
      price: prices[i],
      sma7: sma7[i],
      sma25: sma25[i],
      projection: null,
    }));

    const recentWindow = prices.slice(-14);
    const { projected, slope } = linearRegressionProjection(recentWindow, 7);
    const lastTs = timestamps[timestamps.length - 1];
    const dayMs = 24 * 60 * 60 * 1000;

    chartData[chartData.length - 1] = {
      ...chartData[chartData.length - 1],
      projection: chartData[chartData.length - 1].price,
    };

    projected.forEach((val, idx) => {
      chartData.push({
        ts: lastTs + dayMs * (idx + 1),
        date: fmtDate(lastTs + dayMs * (idx + 1)),
        price: null,
        sma7: null,
        sma25: null,
        projection: val,
      });
    });

    const currentPrice = prices[prices.length - 1];
    const price24hAgo = prices[prices.length - 2];
    const change24h = ((currentPrice - price24hAgo) / price24hAgo) * 100;
    const price7dAgo = prices[prices.length - 8] ?? prices[0];
    const change7d = ((currentPrice - price7dAgo) / price7dAgo) * 100;

    const lastSma7 = sma7[sma7.length - 1];
    const lastSma25 = sma25[sma25.length - 1];
    const prevSma7 = sma7[sma7.length - 2];
    const prevSma25 = sma25[sma25.length - 2];

    let crossStatus = "neutral";
    let crossLabel = "관망";
    if (lastSma7 != null && lastSma25 != null) {
      if (lastSma7 > lastSma25) {
        crossStatus = "up";
        crossLabel = prevSma7 <= prevSma25 ? "골든크로스 발생" : "단기 우위 유지";
      } else {
        crossStatus = "down";
        crossLabel = prevSma7 >= prevSma25 ? "데드크로스 발생" : "단기 열위 유지";
      }
    }

    const lastRsi = rsiVals[rsiVals.length - 1];
    let rsiLabel = "중립";
    let rsiStatus = "neutral";
    if (lastRsi != null) {
      if (lastRsi >= 70) {
        rsiLabel = "과매수 구간";
        rsiStatus = "down";
      } else if (lastRsi <= 30) {
        rsiLabel = "과매도 구간";
        rsiStatus = "up";
      }
    }

    const projectedChangePct =
      currentPrice && projected.length
        ? ((projected[projected.length - 1] - currentPrice) / currentPrice) * 100
        : 0;

    return {
      chartData,
      currentPrice,
      change24h,
      change7d,
      crossStatus,
      crossLabel,
      lastRsi,
      rsiLabel,
      rsiStatus,
      slope,
      projectedChangePct,
    };
  }, [cache, asset]);

  const meta = ASSETS[asset];

  return (
    <div style={styles.page}>
      <style>{FONT_IMPORT}</style>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.tabRow}>
            {Object.entries(ASSETS).map(([key, m]) => (
              <button
                key={key}
                onClick={() => setAsset(key)}
                style={{
                  ...styles.tab,
                  ...(asset === key
                    ? { color: m.accent, borderColor: m.accent, background: "rgba(255,255,255,0.03)" }
                    : {}),
                }}
              >
                {m.ticker}
              </button>
            ))}
          </div>
          <button onClick={loadAll} style={styles.refreshBtn} disabled={loading}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            {lastUpdated ? lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "불러오는 중"}
          </button>
        </header>

        {error && (
          <div style={styles.errorBox}>
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button onClick={loadAll} style={styles.retryBtn}>다시 시도</button>
          </div>
        )}

        {loading && !analysis && (
          <div style={styles.loadingBox}>가격 데이터를 불러오는 중입니다…</div>
        )}

        {analysis && (
          <>
            <section style={styles.hero}>
              <div style={styles.heroLabel}>{meta.label} · {meta.ticker}/USD</div>
              <div style={styles.heroPrice}>{fmtPrice(analysis.currentPrice)}</div>
              <div style={styles.heroDeltaRow}>
                <DeltaTag value={analysis.change24h} label="24시간" />
                <DeltaTag value={analysis.change7d} label="7일" />
              </div>
            </section>

            <section style={styles.chartCard}>
              <div style={styles.chartLegend}>
                <LegendItem color={meta.accent} label="가격" />
                <LegendItem color="#8B948E" label="SMA 7" dashed />
                <LegendItem color="#5B6660" label="SMA 25" dashed />
                <LegendItem color="#EDEAE3" label="추세 연장선(7일)" dotted />
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={analysis.chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#232B27" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="#5B6660"
                    tick={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10 }}
                    interval={Math.floor(analysis.chartData.length / 6)}
                    axisLine={{ stroke: "#232B27" }}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#5B6660"
                    tick={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10 }}
                    domain={["auto", "auto"]}
                    tickFormatter={(v) => (v < 0.01 ? v.toFixed(5) : v.toFixed(3))}
                    axisLine={false}
                    tickLine={false}
                    width={54}
                  />
                  <Tooltip content={<CustomTooltip accent={meta.accent} />} />
                  <ReferenceLine
                    x={analysis.chartData.find((d) => d.projection && !d.price)?.date}
                    stroke="#5B6660"
                    strokeDasharray="2 2"
                  />
                  <Line type="monotone" dataKey="sma25" stroke="#5B6660" strokeWidth={1.25} dot={false} strokeDasharray="4 3" connectNulls />
                  <Line type="monotone" dataKey="sma7" stroke="#8B948E" strokeWidth={1.25} dot={false} strokeDasharray="4 3" connectNulls />
                  <Line type="monotone" dataKey="price" stroke={meta.accent} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="projection" stroke="#EDEAE3" strokeWidth={1.5} strokeDasharray="1 3" dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </section>

            <section style={styles.signalGrid}>
              <SignalCard
                title="이동평균 교차"
                value={analysis.crossLabel}
                status={analysis.crossStatus}
                sub="SMA7 vs SMA25"
              />
              <SignalCard
                title="RSI (14)"
                value={analysis.lastRsi != null ? analysis.lastRsi.toFixed(1) : "-"}
                status={analysis.rsiStatus}
                sub={analysis.rsiLabel}
              />
              <SignalCard
                title="추세 연장 (7일 후)"
                value={`${analysis.projectedChangePct >= 0 ? "+" : ""}${analysis.projectedChangePct.toFixed(1)}%`}
                status={analysis.projectedChangePct >= 0 ? "up" : "down"}
                sub="최근 14일 선형 회귀 기준"
              />
            </section>

            <footer style={styles.disclaimer}>
              이 화면의 추세 연장선은 최근 14일간의 가격 흐름을 단순 선형 회귀로 연장한 통계적 참고선이며,
              실제 미래 가격을 예측하지 않습니다. 암호화폐 가격은 다수의 예측 불가능한 변수에 좌우되며,
              이 도구는 투자 자문이 아닙니다. 데이터 출처: CoinGecko.
            </footer>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}

function DeltaTag({ value, label }) {
  const up = value >= 0;
  const Icon = Math.abs(value) < 0.05 ? Minus : up ? TrendingUp : TrendingDown;
  const color = Math.abs(value) < 0.05 ? "#8B948E" : up ? "#6FCB9F" : "#E2604F";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Icon size={13} color={color} />
      <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 13, color }}>
        {value >= 0 ? "+" : ""}
        {value.toFixed(2)}%
      </span>
      <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "#5B6660" }}>{label}</span>
    </div>
  );
}

function LegendItem({ color, label, dashed, dotted }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          width: 14,
          height: 0,
          borderTop: `2px ${dotted ? "dotted" : dashed ? "dashed" : "solid"} ${color}`,
        }}
      />
      <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#8B948E" }}>{label}</span>
    </div>
  );
}

function SignalCard({ title, value, status, sub }) {
  const color = status === "up" ? "#6FCB9F" : status === "down" ? "#E2604F" : "#8B948E";
  return (
    <div style={styles.signalCard}>
      <div style={styles.signalTitle}>{title}</div>
      <div style={{ ...styles.signalValue, color }}>{value}</div>
      <div style={styles.signalSub}>{sub}</div>
    </div>
  );
}

function CustomTooltip({ active, payload, label, accent }) {
  if (!active || !payload || !payload.length) return null;
  const price = payload.find((p) => p.dataKey === "price")?.value;
  const projection = payload.find((p) => p.dataKey === "projection")?.value;
  return (
    <div style={styles.tooltip}>
      <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#8B948E", marginBottom: 4 }}>
        {label}
      </div>
      {price != null && (
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12, color: accent }}>
          {fmtPrice(price)}
        </div>
      )}
      {price == null && projection != null && (
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12, color: "#EDEAE3" }}>
          추세선 {fmtPrice(projection)}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0E1210",
    fontFamily: "Space Grotesk, sans-serif",
    color: "#EDEAE3",
    padding: "24px 16px",
  },
  container: {
    maxWidth: 640,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  tabRow: {
    display: "flex",
    gap: 4,
    background: "#171D1A",
    padding: 4,
    borderRadius: 8,
  },
  tab: {
    background: "transparent",
    border: "1px solid transparent",
    color: "#8B948E",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.02em",
    padding: "6px 14px",
    borderRadius: 6,
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
  },
  refreshBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid #232B27",
    color: "#8B948E",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
  },
  errorBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(226,96,79,0.1)",
    border: "1px solid rgba(226,96,79,0.3)",
    color: "#E2604F",
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
  },
  retryBtn: {
    marginLeft: "auto",
    background: "transparent",
    border: "1px solid #E2604F",
    color: "#E2604F",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  loadingBox: {
    padding: "60px 0",
    textAlign: "center",
    color: "#5B6660",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 13,
  },
  hero: {
    marginBottom: 20,
  },
  heroLabel: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 12,
    color: "#8B948E",
    marginBottom: 6,
  },
  heroPrice: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 36,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    marginBottom: 8,
  },
  heroDeltaRow: {
    display: "flex",
    gap: 18,
  },
  chartCard: {
    background: "#171D1A",
    border: "1px solid #232B27",
    borderRadius: 10,
    padding: "16px 12px 8px",
    marginBottom: 16,
  },
  chartLegend: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 10,
    paddingLeft: 6,
  },
  signalGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
    marginBottom: 20,
  },
  signalCard: {
    background: "#171D1A",
    border: "1px solid #232B27",
    borderRadius: 10,
    padding: "14px 16px",
  },
  signalTitle: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 10,
    color: "#5B6660",
    marginBottom: 8,
    textTransform: "none",
  },
  signalValue: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 4,
  },
  signalSub: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    color: "#8B948E",
  },
  tooltip: {
    background: "#171D1A",
    border: "1px solid #232B27",
    borderRadius: 6,
    padding: "8px 10px",
  },
  disclaimer: {
    fontSize: 12,
    lineHeight: 1.6,
    color: "#5B6660",
    borderTop: "1px solid #232B27",
    paddingTop: 14,
  },
};
