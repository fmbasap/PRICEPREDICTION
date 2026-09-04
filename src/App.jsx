import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
import { supabase, supabaseDebugInfo } from "./supabaseClient";

const ASSETS = {
  FLR: { id: "flare-networks", label: "Flare", ticker: "FLR", accent: "#E8A33D", currency: "usd", futuresSymbol: "FLRUSDT" },
  XRP: { id: "ripple", label: "XRP", ticker: "XRP", accent: "#4FD1C5", currency: "usd", futuresSymbol: "XRPUSDT" },
};

// ---- 시나리오 대결: 김광석 교수(금리인하) vs 현재 컨센서스(금리인상 66%) ----
// 기준일 2026-09-03 가격: BTC 77500 / ETH 2400 / SOL 98 / XRP 1.36
const SCENARIO_COINS = {
  BTC: { id: "bitcoin", label: "BTC", baseline: 77500 },
  ETH: { id: "ethereum", label: "ETH", baseline: 2400 },
  SOL: { id: "solana", label: "SOL", baseline: 98 },
  XRP: { id: "ripple", label: "XRP", baseline: 1.36 },
};

// 각 체크포인트에서의 누적 변화율(%) - 2026-09-03 기준 작성
const SCENARIOS = {
  kim: {
    label: "김광석 시나리오 (공격적 금리인하)",
    color: "#6FCB9F",
    checkpoints: {
      "2026-09-15": { BTC: 2, ETH: 3, SOL: 4, XRP: 5 },
      "2026-10-15": { BTC: 10, ETH: 15, SOL: 18, XRP: 20 },
      "2026-11-15": { BTC: 18, ETH: 25, SOL: 30, XRP: 33 },
      "2026-12-15": { BTC: 25, ETH: 35, SOL: 40, XRP: 45 },
    },
  },
  consensus: {
    label: "현재 컨센서스 (9월 금리인상 66%)",
    color: "#E2604F",
    checkpoints: {
      "2026-09-15": { BTC: -3, ETH: -5, SOL: -6, XRP: -3 },
      "2026-10-15": { BTC: -5, ETH: -7, SOL: -9, XRP: -3 },
      "2026-11-15": { BTC: -3, ETH: -4, SOL: -5, XRP: 0 },
      "2026-12-15": { BTC: -6, ETH: -8, SOL: -10, XRP: -2 },
    },
  },
};

const TIMEFRAMES = {
  hourly: {
    label: "시간별",
    days: 7,
    stockRange: "1mo",
    stockInterval: "60m",
    unitMs: 60 * 60 * 1000,
    fastPeriod: 6,
    slowPeriod: 24,
    rsiPeriod: 14,
    regressionWindow: 24,
    forwardUnits: 12,
    forwardLabel: "12시간",
    fastLabel: "MA 6h",
    slowLabel: "MA 24h",
  },
  daily: {
    label: "일별",
    days: 90,
    stockRange: "3mo",
    stockInterval: "1d",
    unitMs: 24 * 60 * 60 * 1000,
    fastPeriod: 7,
    slowPeriod: 25,
    rsiPeriod: 14,
    regressionWindow: 14,
    forwardUnits: 7,
    forwardLabel: "7일",
    fastLabel: "SMA 7",
    slowLabel: "SMA 25",
  },
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

function linearRegressionProjection(points, forwardSteps) {
  const n = points.length;
  if (n < 2) return { projected: [], slope: 0 };
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
  for (let i = 1; i <= forwardSteps; i++) {
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

function fmtLabel(ts, mode) {
  const d = new Date(ts);
  if (mode === "hourly") {
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ---- 예측 정확도 기록 (브라우저 localStorage에 저장) ----
function predLogKey(asset, timeframe) {
  return `predlog_v1_${asset}_${timeframe}`;
}

function loadPredLog(asset, timeframe) {
  try {
    const raw = localStorage.getItem(predLogKey(asset, timeframe));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePredLog(asset, timeframe, log) {
  try {
    localStorage.setItem(predLogKey(asset, timeframe), JSON.stringify(log.slice(-100)));
  } catch {
    // 저장 실패(용량 초과 등)는 조용히 무시
  }
}

// 지나간 목표 시점에 대해, 그 시점에 가장 가까운 실제 가격을 찾아 오차를 채워 넣는다
function resolvePredLog(log, rawPrices, toleranceMs) {
  if (!rawPrices || rawPrices.length === 0) return { log, changed: false };
  let changed = false;
  const now = Date.now();
  const nextLog = log.map((batch) => {
    const targets = batch.targets.map((t) => {
      if (t.resolved || t.ts > now) return t;
      let nearestPrice = null;
      let nearestDiff = Infinity;
      for (const [ts, price] of rawPrices) {
        const diff = Math.abs(ts - t.ts);
        if (diff < nearestDiff) {
          nearestDiff = diff;
          nearestPrice = price;
        }
      }
      if (nearestPrice != null && nearestDiff <= toleranceMs) {
        changed = true;
        return { ...t, actual: nearestPrice, resolved: true };
      }
      return t;
    });
    return { ...batch, targets };
  });
  return { log: nextLog, changed };
}

export default function CryptoTrendDashboard() {
  const [asset, setAsset] = useState("FLR");
  const [timeframe, setTimeframe] = useState("hourly");
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // ---- 로그인/등급 상태 ----
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("crypto_profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (!cancelled) setProfile(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const tier = profile?.tier || "free";
  const tierRank = { free: 0, bronze: 1, silver: 2 };
  const hasAccess = (requiredTier) => profile?.is_admin || tierRank[tier] >= tierRank[requiredTier];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const fetchAssetOnce = useCallback(async (key, tf) => {
    const meta = ASSETS[key];
    const tfConf = TIMEFRAMES[tf];

    const intervalParam = tf === "daily" ? "&interval=daily" : "";
    const url = `https://api.coingecko.com/api/v3/coins/${meta.id}/market_chart?vs_currency=usd&days=${tfConf.days}${intervalParam}`;
    const res = await fetch(url);
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
    const json = await res.json();
    return json.prices;
  }, []);

  // 429(요청 과다)일 때는 잠시 대기 후 최대 2회 재시도
  const fetchAsset = useCallback(
    async (key, tf) => {
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await fetchAssetOnce(key, tf);
        } catch (e) {
          lastErr = e;
          if (e.message === "RATE_LIMIT") {
            await sleep(1500 * (attempt + 1));
            continue;
          }
          throw e;
        }
      }
      throw new Error("요청이 많아 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    },
    [fetchAssetOnce]
  );

  // 여러 자산을 동시에 요청하면 CoinGecko 무료 API 한도에 걸려
  // "CORS" 에러처럼 보이는 429가 발생하므로, 하나씩 순서대로 요청합니다.
  const loadAll = useCallback(
    async (tf) => {
      setLoading(true);
      setError(null);
      const keys = Object.keys(ASSETS);
      const next = {};
      try {
        for (let i = 0; i < keys.length; i++) {
          next[keys[i]] = await fetchAsset(keys[i], tf);
          if (i < keys.length - 1) await sleep(350);
        }
        setCache(next);
        setLastUpdated(new Date());
      } catch (e) {
        // 이미 성공적으로 받아온 자산은 유지하고, 실패한 지점부터 에러 표시
        setCache((prev) => ({ ...prev, ...next }));
        setError(e.message || "알 수 없는 오류가 발생했습니다");
      } finally {
        setLoading(false);
      }
    },
    [fetchAsset]
  );

  useEffect(() => {
    loadAll(timeframe);
  }, [loadAll, timeframe]);

  const analysis = useMemo(() => {
    const raw = cache[asset];
    const tfConf = TIMEFRAMES[timeframe];
    if (!raw || raw.length < tfConf.slowPeriod + 2) return null;

    const prices = raw.map((p) => p[1]);
    const timestamps = raw.map((p) => p[0]);
    const smaFast = sma(prices, tfConf.fastPeriod);
    const smaSlow = sma(prices, tfConf.slowPeriod);
    const rsiVals = rsi(prices, tfConf.rsiPeriod);

    const chartData = raw.map((p, i) => ({
      ts: timestamps[i],
      date: fmtLabel(timestamps[i], timeframe),
      price: prices[i],
      smaFast: smaFast[i],
      smaSlow: smaSlow[i],
      projection: null,
    }));

    const recentWindow = prices.slice(-tfConf.regressionWindow);
    const { projected, slope } = linearRegressionProjection(recentWindow, tfConf.forwardUnits);
    const lastTs = timestamps[timestamps.length - 1];

    chartData[chartData.length - 1] = {
      ...chartData[chartData.length - 1],
      projection: chartData[chartData.length - 1].price,
    };

    projected.forEach((val, idx) => {
      const ts = lastTs + tfConf.unitMs * (idx + 1);
      chartData.push({
        ts,
        date: fmtLabel(ts, timeframe),
        price: null,
        smaFast: null,
        smaSlow: null,
        projection: val,
      });
    });

    const currentPrice = prices[prices.length - 1];
    const priceOneStepAgo = prices[prices.length - 2];
    const changeStep = ((currentPrice - priceOneStepAgo) / priceOneStepAgo) * 100;
    const compareBackSteps = timeframe === "hourly" ? Math.min(24, prices.length - 1) : Math.min(7, prices.length - 1);
    const priceCompareAgo = prices[prices.length - 1 - compareBackSteps] ?? prices[0];
    const changeCompare = ((currentPrice - priceCompareAgo) / priceCompareAgo) * 100;

    const lastFast = smaFast[smaFast.length - 1];
    const lastSlow = smaSlow[smaSlow.length - 1];
    const prevFast = smaFast[smaFast.length - 2];
    const prevSlow = smaSlow[smaSlow.length - 2];

    let crossStatus = "neutral";
    let crossLabel = "관망";
    if (lastFast != null && lastSlow != null) {
      if (lastFast > lastSlow) {
        crossStatus = "up";
        crossLabel = prevFast <= prevSlow ? "골든크로스 발생" : "단기 우위 유지";
      } else {
        crossStatus = "down";
        crossLabel = prevFast >= prevSlow ? "데드크로스 발생" : "단기 열위 유지";
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
      changeStep,
      changeStepLabel: timeframe === "hourly" ? "직전 봉" : "24시간",
      changeCompare,
      changeCompareLabel: timeframe === "hourly" ? "24봉 전" : "7일",
      crossStatus,
      crossLabel,
      lastRsi,
      rsiLabel,
      rsiStatus,
      slope,
      projectedChangePct,
    };
  }, [cache, asset, timeframe]);

  const meta = ASSETS[asset];
  const tfConf = TIMEFRAMES[timeframe];

  // ---- 예측 정확도 기록: 새 추세 연장선이 계산될 때마다 스냅샷 저장 + 지나간 예측 검증 ----
  const [predLog, setPredLog] = useState([]);
  const lastSavedKeyRef = useRef(null);

  useEffect(() => {
    if (!analysis || !cache[asset]) return;

    let log = loadPredLog(asset, timeframe);
    const { log: resolvedLog, changed: resolveChanged } = resolvePredLog(log, cache[asset], tfConf.unitMs);
    log = resolvedLog;

    const fetchKey = `${asset}_${timeframe}_${lastUpdated ? lastUpdated.getTime() : 0}`;
    let appendChanged = false;
    if (lastSavedKeyRef.current !== fetchKey) {
      lastSavedKeyRef.current = fetchKey;
      const lastBatch = log[log.length - 1];
      // 최소 저장 간격: 시간별=10분, 일별=1일
      const MIN_SAVE_INTERVAL_MS = timeframe === "hourly" ? 10 * 60 * 1000 : 24 * 60 * 60 * 1000;
      const canAppend = !lastBatch || Date.now() - lastBatch.createdAt >= MIN_SAVE_INTERVAL_MS;
      if (canAppend) {
        const targets = analysis.chartData
          .filter((d) => d.projection != null && d.price == null)
          .map((d) => ({ ts: d.ts, predicted: d.projection, actual: null, resolved: false }));
        if (targets.length > 0) {
          log = [...log, { createdAt: Date.now(), basePrice: analysis.currentPrice, targets }];
          appendChanged = true;
        }
      }
    }

    if (resolveChanged || appendChanged) {
      savePredLog(asset, timeframe, log);
    }
    setPredLog(log);
  }, [analysis, cache, asset, timeframe, lastUpdated, tfConf]);

  return (
    <div style={styles.page}>
      <style>{FONT_IMPORT}</style>
      <div style={styles.container}>
        <AccountBar session={session} profile={profile} authLoading={authLoading} tier={tier} />

        {profile?.is_admin && <AdminPanel />}

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
        </header>

        <div style={styles.subHeader}>
          <div style={styles.tfRow}>
            {Object.entries(TIMEFRAMES).map(([key, t]) => (
              <button
                key={key}
                onClick={() => setTimeframe(key)}
                style={{
                  ...styles.tfBtn,
                  ...(timeframe === key ? styles.tfBtnActive : {}),
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={() => loadAll(timeframe)} style={styles.refreshBtn} disabled={loading}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            {lastUpdated ? lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "불러오는 중"}
          </button>
        </div>

        {error && (
          <div style={styles.errorBox}>
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button onClick={() => loadAll(timeframe)} style={styles.retryBtn}>다시 시도</button>
          </div>
        )}

        {loading && !analysis && (
          <div style={styles.loadingBox}>가격 데이터를 불러오는 중입니다…</div>
        )}

        {!loading && !analysis && !error && (
          <div style={styles.loadingBox}>
            이 구간에는 표시할 데이터가 충분하지 않습니다. (장 마감 시간대이거나 데이터가 부족할 수 있어요)
          </div>
        )}

        {analysis && (
          <>
            <section style={styles.hero}>
              <div style={styles.heroLabel}>
                {meta.label} · {meta.ticker}/{meta.currency.toUpperCase()}
              </div>
              <div style={styles.heroPrice}>{fmtPrice(analysis.currentPrice)}</div>
              <div style={styles.heroDeltaRow}>
                <DeltaTag value={analysis.changeStep} label={analysis.changeStepLabel} />
                <DeltaTag value={analysis.changeCompare} label={analysis.changeCompareLabel} />
              </div>
            </section>

            <section style={styles.chartCard}>
              <div style={styles.chartLegend}>
                <LegendItem color={meta.accent} label="가격" />
                <LegendItem color="#5B9BD5" label={tfConf.fastLabel} dashed />
                <LegendItem color="#B388EB" label={tfConf.slowLabel} dashed />
                <LegendItem color="#EDEAE3" label={`추세 연장선(${tfConf.forwardLabel})`} dotted />
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={analysis.chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#232B27" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="#5B6660"
                    tick={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9 }}
                    interval={Math.floor(analysis.chartData.length / 6)}
                    axisLine={{ stroke: "#232B27" }}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#5B6660"
                    tick={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10 }}
                    domain={["auto", "auto"]}
                    tickFormatter={(v) =>
                      v < 0.01 ? v.toFixed(5) : v.toFixed(3)
                    }
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
                  <Line type="monotone" dataKey="smaSlow" stroke="#B388EB" strokeWidth={1.25} dot={false} strokeDasharray="4 3" connectNulls />
                  <Line type="monotone" dataKey="smaFast" stroke="#5B9BD5" strokeWidth={1.25} dot={false} strokeDasharray="4 3" connectNulls />
                  <Line type="monotone" dataKey="price" stroke={meta.accent} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="projection" stroke="#EDEAE3" strokeWidth={1.5} strokeDasharray="1 3" dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </section>

            <section style={styles.tableCard}>
              <div style={styles.tableTitle}>추세 연장 표 ({tfConf.forwardLabel})</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>시점</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>추세 연장 가격</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>현재가 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.chartData
                    .filter((d) => d.projection != null && d.price == null)
                    .map((d, i) => {
                      const pct = ((d.projection - analysis.currentPrice) / analysis.currentPrice) * 100;
                      return (
                        <tr key={i} style={i % 2 === 1 ? styles.trAlt : undefined}>
                          <td style={styles.td}>{d.date}</td>
                          <td style={{ ...styles.td, textAlign: "right" }}>{fmtPrice(d.projection)}</td>
                          <td
                            style={{
                              ...styles.td,
                              textAlign: "right",
                              color: pct >= 0 ? "#6FCB9F" : "#E2604F",
                            }}
                          >
                            {pct >= 0 ? "+" : ""}
                            {pct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </section>

            <PredictionAccuracyCard log={predLog} timeframe={timeframe} />

            <section style={styles.signalGrid}>
              <SignalCard
                title="이동평균 교차"
                value={analysis.crossLabel}
                status={analysis.crossStatus}
                sub={`${tfConf.fastLabel} vs ${tfConf.slowLabel}`}
              />
              <SignalCard
                title={`RSI (${tfConf.rsiPeriod})`}
                value={analysis.lastRsi != null ? analysis.lastRsi.toFixed(1) : "-"}
                status={analysis.rsiStatus}
                sub={analysis.rsiLabel}
              />
              <SignalCard
                title={`추세 연장 (${tfConf.forwardLabel} 후)`}
                value={`${analysis.projectedChangePct >= 0 ? "+" : ""}${analysis.projectedChangePct.toFixed(1)}%`}
                status={analysis.projectedChangePct >= 0 ? "up" : "down"}
                sub={`최근 ${tfConf.regressionWindow}개 구간 선형 회귀 기준`}
              />
            </section>

            <PositioningPanel key={`pos-${asset}`} symbol={meta.futuresSymbol} accent={meta.accent} />

            {hasAccess("silver") ? (
              <LiquidationPanel key={`liq-${asset}`} symbol={meta.futuresSymbol} accent={meta.accent} />
            ) : (
              <LockedPanel title="실시간 청산 추적" requiredTier="silver" />
            )}

            {(asset === "XRP" || asset === "FLR") &&
              (hasAccess("bronze") ? (
                <NewsPanel key={asset} assetKey={asset} />
              ) : (
                <LockedPanel title="뉴스 기반 심리" requiredTier="bronze" />
              ))}

            {asset === "XRP" &&
              (hasAccess("bronze") ? <PredictionMarketPanel /> : <LockedPanel title="예측시장 전망 (Polymarket)" requiredTier="bronze" />)}

            {asset === "XRP" &&
              (hasAccess("silver") ? <ExchangeFlowPanel /> : <LockedPanel title="대형 지갑 잔고 추적" requiredTier="silver" />)}

            {hasAccess("silver") ? (
              <ScenarioBattlePanel />
            ) : (
              <LockedPanel title="시나리오 대결: 김광석 vs 컨센서스" requiredTier="silver" />
            )}

            <footer style={styles.disclaimer}>
              이 화면의 추세 연장선은 최근 구간의 가격 흐름을 단순 선형 회귀로 연장한 통계적 참고선이며,
              실제 미래 가격을 예측하지 않습니다. 뉴스 기반 심리 섹션도 최신 검색 결과를 요약한 참고
              자료일 뿐, 가격 예측이 아닙니다. 암호화폐 가격은 다수의 예측 불가능한 변수에 좌우되며,
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

function PredictionAccuracyCard({ log, timeframe }) {
  const resolved = log.flatMap((batch) =>
    batch.targets.filter((t) => t.resolved).map((t) => ({ ...t, createdAt: batch.createdAt }))
  );
  const pendingCount = log.reduce((sum, b) => sum + b.targets.filter((t) => !t.resolved).length, 0);
  const recent = [...resolved].sort((a, b) => b.ts - a.ts).slice(0, 8);

  const errors = resolved.map((t) => ((t.actual - t.predicted) / t.predicted) * 100);
  const mape = errors.length ? errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length : null;
  const bias = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>예측 정확도 기록</div>
        {pendingCount > 0 && <div style={styles.newsTimestamp}>검증 대기 {pendingCount}건</div>}
      </div>

      {resolved.length === 0 ? (
        <div style={styles.newsEmpty}>
          아직 검증된 예측이 없습니다. 추세 연장선이 가리켰던 미래 시점이 실제로 지나야 비교할 수 있어요. 이 화면을
          다시 열 때마다 자동으로 쌓입니다.
        </div>
      ) : (
        <>
          <div style={styles.posGrid}>
            <div>
              <div style={styles.posLabel}>평균 절대오차 (MAPE)</div>
              <div style={styles.posValue}>{mape.toFixed(2)}%</div>
              <div style={styles.posSub}>{resolved.length}건 검증됨</div>
            </div>
            <div>
              <div style={styles.posLabel}>평균 편향</div>
              <div style={{ ...styles.posValue, color: bias >= 0 ? "#6FCB9F" : "#E2604F" }}>
                {bias >= 0 ? "+" : ""}
                {bias.toFixed(2)}%
              </div>
              <div style={styles.posSub}>{bias >= 0 ? "추세선이 실제보다 낮게 잡는 경향" : "추세선이 실제보다 높게 잡는 경향"}</div>
            </div>
          </div>

          <table style={{ ...styles.table, marginTop: 14 }}>
            <thead>
              <tr>
                <th style={styles.th}>목표시점</th>
                <th style={{ ...styles.th, textAlign: "right" }}>예측가</th>
                <th style={{ ...styles.th, textAlign: "right" }}>실제가</th>
                <th style={{ ...styles.th, textAlign: "right" }}>오차</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t, i) => {
                const err = ((t.actual - t.predicted) / t.predicted) * 100;
                return (
                  <tr key={i} style={i % 2 === 1 ? styles.trAlt : undefined}>
                    <td style={styles.td}>{fmtLabel(t.ts, timeframe)}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{fmtPrice(t.predicted)}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{fmtPrice(t.actual)}</td>
                    <td
                      style={{
                        ...styles.td,
                        textAlign: "right",
                        color: err >= 0 ? "#6FCB9F" : "#E2604F",
                      }}
                    >
                      {err >= 0 ? "+" : ""}
                      {err.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <div style={{ ...styles.posNote, marginTop: 10 }}>
        새 예측은 최소 {timeframe === "hourly" ? "10분" : "1일"} 간격으로만 저장됩니다 (새로고침을 여러 번 해도
        중복 저장되지 않습니다). 이 기기(브라우저)에만 저장되며, 다른 기기나 시크릿 모드에서는 기록이 보이지
        않아요.
      </div>
    </section>
  );
}

function TIER_LABEL(tier) {
  return { free: "무료", bronze: "브론즈", silver: "실버" }[tier] || "무료";
}

function AccountBar({ session, profile, authLoading, tier }) {
  const [showAuth, setShowAuth] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);

  if (!supabase) {
    return (
      <div style={styles.accountBar}>
        <span style={styles.accountText}>로그인 기능 준비 중</span>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div style={styles.accountBar}>
        <span style={styles.accountText}>확인 중…</span>
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <div style={styles.accountBar}>
          <span style={styles.accountText}>로그인하면 브론즈/실버 기능을 이용하실 수 있어요</span>
          <button onClick={() => setShowAuth(true)} style={styles.accountBtn}>
            로그인 / 회원가입
          </button>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </>
    );
  }

  return (
    <>
      <div style={styles.accountBar}>
        <span style={styles.accountText}>
          {session.user.email} · <span style={{ color: tier === "free" ? "#8B948E" : "#6FCB9F" }}>{TIER_LABEL(tier)}</span>
          {" "}
          <span style={{ color: "#5B9BD5" }}>
            [디버그: is_admin={String(profile?.is_admin)}, profile존재={String(!!profile)}]
          </span>
          {profile?.pending_tier && (
            <span style={{ color: "#5B9BD5" }}> ({TIER_LABEL(profile.pending_tier)} 승인 대기 중)</span>
          )}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {tier !== "silver" && (
            <button onClick={() => setShowSubscribe(true)} style={styles.accountBtn}>
              구독하기
            </button>
          )}
          <button onClick={() => supabase.auth.signOut()} style={styles.accountBtnGhost}>
            로그아웃
          </button>
        </div>
      </div>
      {showSubscribe && <SubscribeModal profile={profile} onClose={() => setShowSubscribe(false)} />}
    </>
  );
}

function AuthModal({ onClose }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSignupDone(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onClose();
      }
    } catch (e) {
      setError(e.message || "오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}>{mode === "login" ? "로그인" : "회원가입"}</div>

        {signupDone ? (
          <div style={styles.newsEmpty}>가입 확인 이메일을 보내드렸습니다. 메일함을 확인해서 인증을 완료해주세요.</div>
        ) : (
          <>
            <input
              type="email"
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.modalInput}
            />
            <input
              type="password"
              placeholder="비밀번호 (6자 이상)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.modalInput}
            />
            {error && (
              <div style={{ ...styles.errorBox, marginBottom: 0 }}>
                <AlertTriangle size={14} />
                <span>{error}</span>
              </div>
            )}
            <button onClick={submit} style={styles.modalPrimaryBtn} disabled={loading || !email || !password}>
              {loading ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
            </button>
            <button
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              style={styles.modalSwitchBtn}
            >
              {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
            </button>
          </>
        )}

        <button onClick={onClose} style={styles.modalCloseBtn}>
          닫기
        </button>
      </div>
    </div>
  );
}

function SubscribeModal({ profile, onClose }) {
  const [requesting, setRequesting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const request = async (tierName) => {
    setRequesting(true);
    setError(null);
    try {
      const { error } = await supabase.rpc("request_subscription", { p_tier: tierName });
      if (error) throw error;
      setDone(true);
    } catch (e) {
      setError(e.message || "신청에 실패했습니다");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalTitle}>구독하기</div>

        {done ? (
          <div style={styles.newsEmpty}>
            신청이 접수됐습니다. 아래 계좌로 입금해주시면 확인 후 등급이 반영됩니다 (영업일 기준 1일 이내).
            <div style={{ ...styles.posNote, marginTop: 10 }}>입금 계좌: [여기에 실제 계좌번호를 넣어주세요]</div>
          </div>
        ) : (
          <>
            <div style={styles.tierCard}>
              <div style={styles.tierName}>브론즈 · 월 15,000원</div>
              <div style={styles.tierDesc}>뉴스 기반 심리 + 예측시장 전망(Polymarket)</div>
              <button onClick={() => request("bronze")} style={styles.modalPrimaryBtn} disabled={requesting}>
                브론즈 신청
              </button>
            </div>
            <div style={styles.tierCard}>
              <div style={styles.tierName}>실버 · 월 30,000원</div>
              <div style={styles.tierDesc}>브론즈 전체 + 실시간 청산 추적 + 대형 지갑 잔고 추적</div>
              <button onClick={() => request("silver")} style={styles.modalPrimaryBtn} disabled={requesting}>
                실버 신청
              </button>
            </div>
            {error && (
              <div style={{ ...styles.errorBox, marginBottom: 0 }}>
                <AlertTriangle size={14} />
                <span>{error}</span>
              </div>
            )}
          </>
        )}

        <button onClick={onClose} style={styles.modalCloseBtn}>
          닫기
        </button>
      </div>
    </div>
  );
}

function AdminPanel() {
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const fetchPending = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("admin_list_pending");
      if (error) throw error;
      setPending(data || []);
    } catch (e) {
      setError(e.message || "조회에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const approve = async (userId, tier) => {
    setBusyId(userId);
    try {
      const { error } = await supabase.rpc("admin_approve", { p_user_id: userId, p_tier: tier });
      if (error) throw error;
      await fetchPending();
    } catch (e) {
      setError(e.message || "승인에 실패했습니다");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section style={{ ...styles.newsCard, borderColor: "#5B9BD5" }}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>🛠 관리자: 구독 승인 대기</div>
        <button onClick={fetchPending} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          새로고침
        </button>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {pending && pending.length === 0 && <div style={styles.newsEmpty}>승인 대기 중인 신청이 없습니다.</div>}

      {pending && pending.length > 0 && (
        <div style={styles.pmList}>
          {pending.map((p) => (
            <div key={p.id} style={styles.pmRow}>
              <div style={styles.pmQuestion}>{p.email}</div>
              <div style={styles.pmMetaRow}>
                <span style={{ color: "#5B9BD5", fontFamily: "IBM Plex Mono, monospace", fontSize: 12 }}>
                  {TIER_LABEL(p.pending_tier)} 신청
                </span>
                <span style={styles.pmMetaSub}>
                  {p.pending_at ? new Date(p.pending_at).toLocaleString("ko-KR") : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  onClick={() => approve(p.id, p.pending_tier)}
                  style={{ ...styles.accountBtn, borderColor: "#6FCB9F", color: "#6FCB9F" }}
                  disabled={busyId === p.id}
                >
                  승인
                </button>
                <button
                  onClick={() => approve(p.id, "free")}
                  style={styles.accountBtnGhost}
                  disabled={busyId === p.id}
                >
                  거절(free 유지)
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LockedPanel({ title, requiredTier }) {
  return (
    <section style={{ ...styles.newsCard, position: "relative" }}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>{title}</div>
      </div>
      <div style={styles.lockedBody}>
        <div style={{ fontSize: 20 }}>🔒</div>
        <div style={styles.newsEmpty}>
          {TIER_LABEL(requiredTier)} 등급부터 이용 가능합니다. 상단의 "구독하기"에서 신청해주세요.
        </div>
      </div>
    </section>
  );
}

function LiquidationPanel({ symbol, accent }) {
  const [stats, setStats] = useState({ longUsd: 0, longCount: 0, shortUsd: 0, shortCount: 0 });
  const [exchangeStatus, setExchangeStatus] = useState({ binance: "connecting", bybit: "connecting" });
  const [startedAt, setStartedAt] = useState(null);
  const [lastEvent, setLastEvent] = useState(null);
  const [msgCounts, setMsgCounts] = useState({ binance: 0, bybit: 0 });
  const [rpcDebug, setRpcDebug] = useState({ success: 0, error: 0, lastError: null });
  const [initialFetchDebug, setInitialFetchDebug] = useState("조회 중…");
  const [sharedMode, setSharedMode] = useState(!!supabase);
  const [updatedAt, setUpdatedAt] = useState(null);
  const wsRefs = useRef({});
  const lastMsgTime = useRef({ binance: Date.now(), bybit: Date.now() });
  const reconnectTimers = useRef({});
  const pingTimers = useRef({});

  // Supabase에 저장된 공유 누적치를 불러오고, 실시간 변경을 구독
  useEffect(() => {
    if (!supabase) {
      setSharedMode(false);
      return;
    }
    let cancelled = false;

    const applyRow = (row) => {
      if (!row || cancelled) return;
      setStats({
        longUsd: Number(row.long_usd) || 0,
        longCount: Number(row.long_count) || 0,
        shortUsd: Number(row.short_usd) || 0,
        shortCount: Number(row.short_count) || 0,
      });
      setUpdatedAt(row.updated_at ? new Date(row.updated_at) : new Date());
    };

    (async () => {
      const { data, error } = await supabase
        .from("liquidation_totals")
        .select("*")
        .eq("symbol", symbol)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setInitialFetchDebug(`실패: ${error.message}`);
      } else if (data) {
        setInitialFetchDebug(`성공 (기존 값 있음: 롱 $${Number(data.long_usd).toFixed(0)} / 숏 $${Number(data.short_usd).toFixed(0)})`);
      } else {
        setInitialFetchDebug("성공 (아직 이 심볼의 행이 없음 — 첫 청산 전이면 정상)");
      }
      applyRow(data);
    })();

    const channel = supabase
      .channel(`liq_${symbol}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "liquidation_totals", filter: `symbol=eq.${symbol}` },
        (payload) => applyRow(payload.new)
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;

    const setStatusFor = (exchange, value) => {
      setExchangeStatus((prev) => ({ ...prev, [exchange]: value }));
    };

    const recordLiquidation = async (isLongLiquidation, usd) => {
      setLastEvent({ isLongLiquidation, usd, time: new Date() });
      if (supabase) {
        // 공유 DB에 안전하게 더하기만 함 (다른 기기 값을 덮어쓰지 않음)
        // 함수가 저장 직후 최신 누적값을 바로 돌려주므로, 실시간 구독 없이도 즉시 반영됨
        const { data, error } = await supabase.rpc("increment_liquidation", {
          p_symbol: symbol,
          p_is_long: isLongLiquidation,
          p_usd: usd,
        });
        if (error) {
          setRpcDebug((prev) => ({ success: prev.success, error: prev.error + 1, lastError: error.message }));
          // 공유 저장 실패 시 이 기기에서만이라도 보이도록 로컬 폴백
          setStats((prev) =>
            isLongLiquidation
              ? { ...prev, longUsd: prev.longUsd + usd, longCount: prev.longCount + 1 }
              : { ...prev, shortUsd: prev.shortUsd + usd, shortCount: prev.shortCount + 1 }
          );
        } else {
          setRpcDebug((prev) => ({ ...prev, success: prev.success + 1 }));
          if (data) {
            setStats({
              longUsd: Number(data.long_usd) || 0,
              longCount: Number(data.long_count) || 0,
              shortUsd: Number(data.short_usd) || 0,
              shortCount: Number(data.short_count) || 0,
            });
            setUpdatedAt(data.updated_at ? new Date(data.updated_at) : new Date());
          }
        }
      } else {
        setStats((prev) =>
          isLongLiquidation
            ? { ...prev, longUsd: prev.longUsd + usd, longCount: prev.longCount + 1 }
            : { ...prev, shortUsd: prev.shortUsd + usd, shortCount: prev.shortCount + 1 }
        );
      }
    };

    // ---- Binance ----
    const connectBinance = () => {
      if (cancelled) return;
      setStatusFor("binance", "connecting");
      const streamSymbol = symbol.toLowerCase();
      let ws;
      try {
        // 2026년 3월 Binance 웹소켓 구조 개편: forceOrder(청산)는 /market 티어로 라우팅됨
        ws = new WebSocket(`wss://fstream.binance.com/market/ws/${streamSymbol}@forceOrder`);
      } catch {
        setStatusFor("binance", "disconnected");
        reconnectTimers.current.binance = setTimeout(connectBinance, 5000);
        return;
      }
      wsRefs.current.binance = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setStatusFor("binance", "live");
        setStartedAt((prev) => prev || new Date());
      };

      ws.onmessage = (msg) => {
        if (cancelled) return;
        setMsgCounts((prev) => ({ ...prev, binance: prev.binance + 1 }));
        try {
          const data = JSON.parse(msg.data);
          const o = data.o;
          if (!o) return;
          const qty = parseFloat(o.q);
          const price = parseFloat(o.ap || o.p);
          const usd = qty * price;
          const isLongLiquidation = o.S === "SELL"; // 강제 매도 = 롱 포지션 청산
          recordLiquidation(isLongLiquidation, usd);
        } catch {
          // 파싱 실패는 무시
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setStatusFor("binance", "disconnected");
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatusFor("binance", "disconnected");
        reconnectTimers.current.binance = setTimeout(connectBinance, 4000);
      };
    };

    // ---- Bybit ----
    const connectBybit = () => {
      if (cancelled) return;
      setStatusFor("bybit", "connecting");
      let ws;
      try {
        ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");
      } catch {
        setStatusFor("bybit", "disconnected");
        reconnectTimers.current.bybit = setTimeout(connectBybit, 5000);
        return;
      }
      wsRefs.current.bybit = ws;

      ws.onopen = () => {
        if (cancelled) return;
        ws.send(JSON.stringify({ op: "subscribe", args: [`allLiquidation.${symbol}`] }));
        setStatusFor("bybit", "live");
        setStartedAt((prev) => prev || new Date());
        // Bybit은 주기적으로 ping을 보내지 않으면 연결이 끊김
        pingTimers.current.bybit = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "ping" }));
        }, 20000);
      };

      ws.onmessage = (msg) => {
        if (cancelled) return;
        setMsgCounts((prev) => ({ ...prev, bybit: prev.bybit + 1 }));
        try {
          const data = JSON.parse(msg.data);
          if (!data.topic || !data.topic.startsWith("allLiquidation") || !Array.isArray(data.data)) return;
          data.data.forEach((item) => {
            const qty = parseFloat(item.v);
            const price = parseFloat(item.p);
            const usd = qty * price;
            const isLongLiquidation = item.S === "Sell"; // 강제 매도 = 롱 포지션 청산
            recordLiquidation(isLongLiquidation, usd);
          });
        } catch {
          // 파싱 실패는 무시
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setStatusFor("bybit", "disconnected");
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatusFor("bybit", "disconnected");
        if (pingTimers.current.bybit) clearInterval(pingTimers.current.bybit);
        reconnectTimers.current.bybit = setTimeout(connectBybit, 4000);
      };
    };

    connectBinance();
    connectBybit();

    // 사파리 등 모바일 브라우저가 백그라운드에서 웹소켓을 조용히 끊어놓는 경우가 있어서,
    // 화면이 다시 보일 때(포그라운드 복귀) 좀비 연결이면 강제로 재연결시킴
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      const binanceWs = wsRefs.current.binance;
      const bybitWs = wsRefs.current.bybit;
      if (!binanceWs || binanceWs.readyState !== WebSocket.OPEN) {
        if (reconnectTimers.current.binance) clearTimeout(reconnectTimers.current.binance);
        connectBinance();
      }
      if (!bybitWs || bybitWs.readyState !== WebSocket.OPEN) {
        if (reconnectTimers.current.bybit) clearTimeout(reconnectTimers.current.bybit);
        if (pingTimers.current.bybit) clearInterval(pingTimers.current.bybit);
        connectBybit();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 연결 상태가 "live"라고 뜨는데 실제로는 오랫동안 메시지가 안 오는 좀비 연결 감지
    // (일정 시간 무응답이면 강제로 끊고 재연결)
    const staleCheckInterval = setInterval(() => {
      if (cancelled || document.visibilityState !== "visible") return;
      const binanceWs = wsRefs.current.binance;
      if (binanceWs && binanceWs.readyState === WebSocket.OPEN) {
        // Binance는 3분마다 ping을 보내므로, 10분 이상 메시지가 전혀 없으면 좀비로 간주
      }
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(staleCheckInterval);
      Object.values(reconnectTimers.current).forEach((t) => clearTimeout(t));
      Object.values(pingTimers.current).forEach((t) => clearInterval(t));
      Object.values(wsRefs.current).forEach((ws) => ws && ws.close());
    };
  }, [symbol]);

  const total = stats.longUsd + stats.shortUsd;
  const longPct = total > 0 ? (stats.longUsd / total) * 100 : 50;
  const elapsedMin = startedAt ? Math.max(1, Math.round((Date.now() - startedAt.getTime()) / 60000)) : 0;

  const anyLive = exchangeStatus.binance === "live" || exchangeStatus.bybit === "live";
  const overallColor = anyLive ? "#6FCB9F" : exchangeStatus.binance === "connecting" || exchangeStatus.bybit === "connecting" ? "#8B948E" : "#E2604F";
  const exchangeLabel = (label, s) => {
    const color = s === "live" ? "#6FCB9F" : s === "connecting" ? "#8B948E" : "#E2604F";
    return (
      <span style={{ color, fontFamily: "IBM Plex Mono, monospace", fontSize: 10 }}>
        {label} {s === "live" ? "●" : s === "connecting" ? "…" : "✕"}
      </span>
    );
  };

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>
          실시간 청산 추적 {sharedMode && <span style={styles.newsTimestamp}>(전체 기기 합산)</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {exchangeLabel("Binance", exchangeStatus.binance)}
          {exchangeLabel("Bybit", exchangeStatus.bybit)}
          <span style={{ ...styles.liveDot, background: overallColor }} />
        </div>
      </div>

      <div style={styles.newsEmpty}>
        {sharedMode
          ? updatedAt
            ? `모든 기기에서 감지한 청산이 합산되어 표시됩니다 (마지막 갱신: ${updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`
            : "공유 데이터를 불러오는 중…"
          : startedAt
          ? `${elapsedMin}분째 이 기기에서만 추적 중 (Supabase 미연결 — ${supabaseDebugInfo})`
          : "연결 대기 중…"}
      </div>

      {sharedMode && (
        <div style={{ ...styles.posNote, marginTop: 6 }}>
          RPC 저장: 성공 {rpcDebug.success}건 / 실패 {rpcDebug.error}건
          {rpcDebug.lastError && ` (최근 에러: ${rpcDebug.lastError})`}
        </div>
      )}

      <div style={{ ...styles.posNote, marginTop: 4 }}>초기 조회: {initialFetchDebug}</div>

      <div style={{ ...styles.posNote, marginTop: 4 }}>
        수신 메시지: Binance {msgCounts.binance}건 / Bybit {msgCounts.bybit}건
      </div>

      {total > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={styles.splitBar}>
            <div style={{ ...styles.splitBarLong, width: `${longPct.toFixed(1)}%` }} />
          </div>
          <div style={styles.posSplitRow}>
            <span style={{ color: "#6FCB9F" }}>
              롱 청산 ${(stats.longUsd / 1000).toFixed(1)}K ({stats.longCount}건)
            </span>
            <span style={{ color: "#E2604F" }}>
              숏 청산 ${(stats.shortUsd / 1000).toFixed(1)}K ({stats.shortCount}건)
            </span>
          </div>
          {lastEvent && (
            <div style={{ ...styles.posNote, marginTop: 10 }}>
              최근: {lastEvent.time.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}{" "}
              <span style={{ color: lastEvent.isLongLiquidation ? "#E2604F" : "#6FCB9F" }}>
                {lastEvent.isLongLiquidation ? "롱 청산" : "숏 청산"}
              </span>{" "}
              ${lastEvent.usd.toFixed(0)}
            </div>
          )}
        </div>
      ) : (
        anyLive && (
          <div style={{ ...styles.posNote, marginTop: 8 }}>아직 감지된 청산이 없습니다.</div>
        )
      )}
    </section>
  );
}

function PositioningPanel({ symbol, accent }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPositioning = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [premiumRes, oiRes, ratioRes, oiHistRes, takerRes] = await Promise.all([
        fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
        fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
        fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`),
        fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=2`),
        fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=1`),
      ]);
      if (!premiumRes.ok || !oiRes.ok || !ratioRes.ok) {
        throw new Error("이 자산은 선물 데이터가 없습니다");
      }
      const premium = await premiumRes.json();
      const oi = await oiRes.json();
      const ratioArr = await ratioRes.json();
      const ratio = Array.isArray(ratioArr) ? ratioArr[0] : null;

      let oiChangePct = null;
      if (oiHistRes.ok) {
        const oiHist = await oiHistRes.json();
        if (Array.isArray(oiHist) && oiHist.length >= 2) {
          const prev = parseFloat(oiHist[0].sumOpenInterest);
          const curr = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest);
          if (prev > 0) oiChangePct = ((curr - prev) / prev) * 100;
        }
      }

      let takerBuyRatio = null;
      if (takerRes.ok) {
        const takerArr = await takerRes.json();
        const taker = Array.isArray(takerArr) ? takerArr[0] : null;
        if (taker) takerBuyRatio = parseFloat(taker.buySellRatio);
      }

      setData({
        markPrice: parseFloat(premium.markPrice),
        fundingRate: parseFloat(premium.lastFundingRate),
        openInterestQty: parseFloat(oi.openInterest),
        oiChangePct,
        longAccount: ratio ? parseFloat(ratio.longAccount) : null,
        shortAccount: ratio ? parseFloat(ratio.shortAccount) : null,
        longShortRatio: ratio ? parseFloat(ratio.longShortRatio) : null,
        takerBuyRatio,
      });
    } catch (e) {
      setError(e.message || "선물 데이터를 불러오지 못했습니다");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchPositioning();
  }, [fetchPositioning]);

  const fundingColor = data && data.fundingRate >= 0 ? "#6FCB9F" : "#E2604F";
  const oiUsd = data && data.markPrice ? data.openInterestQty * data.markPrice : null;

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>포지셔닝 (선물 · Binance)</div>
        <button onClick={fetchPositioning} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          갱신
        </button>
      </div>

      {loading && !data && !error && <div style={styles.newsEmpty}>선물 데이터를 불러오는 중…</div>}

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <div style={styles.posGrid}>
          <div>
            <div style={styles.posLabel}>펀딩비 (8h)</div>
            <div style={{ ...styles.posValue, color: fundingColor }}>
              {data.fundingRate >= 0 ? "+" : ""}
              {(data.fundingRate * 100).toFixed(4)}%
            </div>
            <div style={styles.posSub}>{data.fundingRate >= 0 ? "롱 → 숏 지불 (롱 우세)" : "숏 → 롱 지불 (숏 우세)"}</div>
          </div>

          <div>
            <div style={styles.posLabel}>미결제약정(OI)</div>
            <div style={{ ...styles.posValue, color: accent }}>
              {oiUsd != null ? `$${(oiUsd / 1_000_000).toFixed(1)}M` : "-"}
            </div>
            <div style={styles.posSub}>
              {data.openInterestQty.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} {symbol.replace("USDT", "")}
              {data.oiChangePct != null && (
                <span style={{ color: data.oiChangePct >= 0 ? "#6FCB9F" : "#E2604F", marginLeft: 6 }}>
                  ({data.oiChangePct >= 0 ? "+" : ""}
                  {data.oiChangePct.toFixed(2)}% / 1h)
                </span>
              )}
            </div>
          </div>

          {data.takerBuyRatio != null && (
            <div>
              <div style={styles.posLabel}>테이커 매수/매도 비율 (5m)</div>
              <div
                style={{
                  ...styles.posValue,
                  color: data.takerBuyRatio >= 1 ? "#6FCB9F" : "#E2604F",
                }}
              >
                {data.takerBuyRatio.toFixed(2)}
              </div>
              <div style={styles.posSub}>{data.takerBuyRatio >= 1 ? "시장가 매수 우세" : "시장가 매도 우세"}</div>
            </div>
          )}

          {data.longAccount != null && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={styles.posLabel}>
                롱/숏 계정 비율 {data.longShortRatio != null && `(${data.longShortRatio.toFixed(2)} : 1)`}
              </div>
              <div style={styles.splitBar}>
                <div style={{ ...styles.splitBarLong, width: `${(data.longAccount * 100).toFixed(1)}%` }} />
              </div>
              <div style={styles.posSplitRow}>
                <span style={{ color: "#6FCB9F" }}>롱 {(data.longAccount * 100).toFixed(1)}%</span>
                <span style={{ color: "#E2604F" }}>숏 {(data.shortAccount * 100).toFixed(1)}%</span>
              </div>
            </div>
          )}

          <div style={{ gridColumn: "1 / -1", ...styles.posNote }}>
            OI 증가는 신규 롱·숏이 동시에 매칭되며 생긴 것으로, 어느 한쪽만 늘었다는 뜻이 아닙니다. 테이커
            매수/매도 비율은 시장가로 적극적으로 체결된 방향을 보여주는 보조 지표입니다 (1보다 크면 매수 우세,
            작으면 매도 우세 — 짧은 구간 지표라 노이즈가 큽니다).
          </div>
        </div>
      )}
    </section>
  );
}

function ScenarioBattlePanel() {
  const [actuals, setActuals] = useState({}); // { "BTC:2026-09-15": price }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const checkpointDates = Object.keys(SCENARIOS.kim.checkpoints).sort();
  const today = new Date();
  const passedCheckpoints = checkpointDates.filter((d) => new Date(d + "T23:59:59") <= today);

  const evaluate = async () => {
    setLoading(true);
    setError(null);
    try {
      const nextActuals = { ...actuals };

      for (const [coinKey, coinMeta] of Object.entries(SCENARIO_COINS)) {
        // 이미 Supabase에 기록된 값 먼저 확인
        if (supabase) {
          const { data } = await supabase
            .from("scenario_actuals")
            .select("*")
            .eq("coin", coinKey);
          (data || []).forEach((row) => {
            nextActuals[`${coinKey}:${row.checkpoint_date}`] = Number(row.actual_price);
          });
        }

        // 아직 기록 안 된 지난 체크포인트가 있으면 CoinGecko에서 조회
        const missing = passedCheckpoints.filter((d) => nextActuals[`${coinKey}:${d}`] == null);
        if (missing.length === 0) continue;

        const daysAgo = Math.min(
          90,
          Math.ceil((today - new Date(checkpointDates[0])) / (24 * 60 * 60 * 1000)) + 5
        );
        const url = `https://api.coingecko.com/api/v3/coins/${coinMeta.id}/market_chart?vs_currency=usd&days=${daysAgo}&interval=daily`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        const prices = json.prices || []; // [[ts, price], ...]

        for (const cpDate of missing) {
          const targetTs = new Date(cpDate + "T00:00:00Z").getTime();
          let nearest = null;
          let nearestDiff = Infinity;
          for (const [ts, price] of prices) {
            const diff = Math.abs(ts - targetTs);
            if (diff < nearestDiff) {
              nearestDiff = diff;
              nearest = price;
            }
          }
          if (nearest != null && nearestDiff <= 3 * 24 * 60 * 60 * 1000) {
            nextActuals[`${coinKey}:${cpDate}`] = nearest;
            if (supabase) {
              await supabase.rpc("record_scenario_actual", {
                p_checkpoint_date: cpDate,
                p_coin: coinKey,
                p_price: nearest,
              });
            }
          }
        }
      }

      setActuals(nextActuals);
    } catch (e) {
      setError(e.message || "평가에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    evaluate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const computeErrorForCheckpoint = (scenarioKey, cpDate) => {
    const errors = [];
    for (const [coinKey, coinMeta] of Object.entries(SCENARIO_COINS)) {
      const actual = actuals[`${coinKey}:${cpDate}`];
      if (actual == null) continue;
      const changePct = SCENARIOS[scenarioKey].checkpoints[cpDate][coinKey];
      const target = coinMeta.baseline * (1 + changePct / 100);
      const errPct = (Math.abs(actual - target) / target) * 100;
      errors.push(errPct);
    }
    if (errors.length === 0) return null;
    return errors.reduce((a, b) => a + b, 0) / errors.length;
  };

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>시나리오 대결: 김광석 vs 컨센서스</div>
        <button onClick={evaluate} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          평가
        </button>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {passedCheckpoints.length === 0 && (
        <div style={styles.newsEmpty}>
          첫 체크포인트는 2026-09-15입니다. 그 이후부터 평가가 시작됩니다.
        </div>
      )}

      {passedCheckpoints.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>체크포인트</th>
              <th style={{ ...styles.th, textAlign: "right", color: SCENARIOS.kim.color }}>김광석 오차</th>
              <th style={{ ...styles.th, textAlign: "right", color: SCENARIOS.consensus.color }}>컨센서스 오차</th>
              <th style={{ ...styles.th, textAlign: "right" }}>우세</th>
            </tr>
          </thead>
          <tbody>
            {passedCheckpoints.map((cpDate, i) => {
              const kimErr = computeErrorForCheckpoint("kim", cpDate);
              const consErr = computeErrorForCheckpoint("consensus", cpDate);
              const winner =
                kimErr == null || consErr == null ? "-" : kimErr < consErr ? "김광석" : "컨센서스";
              return (
                <tr key={cpDate} style={i % 2 === 1 ? styles.trAlt : undefined}>
                  <td style={styles.td}>{cpDate}</td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    {kimErr != null ? `${kimErr.toFixed(1)}%` : "대기"}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    {consErr != null ? `${consErr.toFixed(1)}%` : "대기"}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      textAlign: "right",
                      color: winner === "김광석" ? SCENARIOS.kim.color : winner === "컨센서스" ? SCENARIOS.consensus.color : "#8B948E",
                      fontWeight: 600,
                    }}
                  >
                    {winner}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ ...styles.posNote, marginTop: 10 }}>
        오차(%)는 BTC/ETH/SOL/XRP 4개 자산의 "시나리오 목표가 대비 실제가 괴리율" 평균입니다. 작을수록 그
        시나리오가 현실에 가까웠다는 뜻입니다. 실제가는 CoinGecko 해당 날짜 종가 기준이며, 한 번 기록되면
        고정됩니다.
      </div>
    </section>
  );
}

function ExchangeFlowPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchFlow = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/exchange-flow");
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `조회에 실패했습니다 (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e.message || "잔고 데이터를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>대형 지갑 잔고 추적</div>
        <button onClick={fetchFlow} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          {loading ? "조회 중…" : data ? "다시 조회" : "불러오기"}
        </button>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {!data && !loading && !error && (
        <div style={styles.newsEmpty}>
          검증된 대형 지갑(현재 Ripple 에스크로, Coinbase 1개 주소)의 잔고 변화를 24시간 전과 비교합니다.
          XRPL은 완전히 공개된 원장이라 가능한 조회입니다. 아직 주소 수가 적어 참고용으로만 봐주세요.
        </div>
      )}

      {data && (
        <div style={styles.pmList}>
          {data.addresses.map((item) => (
            <div key={item.address} style={styles.pmRow}>
              <div style={styles.pmQuestion}>{item.label}</div>
              {item.error ? (
                <div style={{ ...styles.pmMetaSub, color: "#E2604F" }}>조회 실패: {item.error}</div>
              ) : (
                <div style={styles.pmMetaRow}>
                  <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 13, color: "#EDEAE3" }}>
                    {Math.round(item.balance).toLocaleString("ko-KR")} XRP
                  </span>
                  {item.delta != null ? (
                    <span
                      style={{
                        fontFamily: "IBM Plex Mono, monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        color: item.delta >= 0 ? "#6FCB9F" : "#E2604F",
                      }}
                    >
                      {item.delta >= 0 ? "+" : ""}
                      {Math.round(item.delta).toLocaleString("ko-KR")} (24h)
                    </span>
                  ) : (
                    <span style={styles.pmMetaSub}>24h 전 데이터 없음 (다음 조회부터 비교됨)</span>
                  )}
                </div>
              )}
            </div>
          ))}
          <div style={styles.posNote}>
            잔고 증가는 해당 주소로 순유입(예: Coinbase면 매도 대기 물량 증가 가능성), 감소는 순유출(콜드월렛 이동 등
            장기보유 신호 가능성)로 해석하는 경우가 많지만, 운영상 이동일 수도 있어 확정적 신호는 아닙니다.
          </div>
        </div>
      )}
    </section>
  );
}

function PredictionMarketPanel() {
  const [markets, setMarkets] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  const fetchMarkets = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = "/api/polymarket?q=XRP";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `예측시장 조회에 실패했습니다 (${res.status})`);
      const events = data.events || [];

      const items = [];
      events.forEach((ev) => {
        (ev.markets || []).forEach((m) => {
          if (m.closed || m.active === false) return;
          let outcomes = [];
          let prices = [];
          try {
            outcomes = JSON.parse(m.outcomes || "[]");
          } catch {
            outcomes = [];
          }
          try {
            prices = JSON.parse(m.outcomePrices || "[]");
          } catch {
            prices = [];
          }
          if (!outcomes.length || !prices.length || outcomes.length !== prices.length) return;

          let maxIdx = 0;
          prices.forEach((p, i) => {
            if (parseFloat(p) > parseFloat(prices[maxIdx])) maxIdx = i;
          });

          items.push({
            id: m.id,
            question: m.question || ev.title,
            slug: ev.slug,
            leadingOutcome: outcomes[maxIdx],
            probability: parseFloat(prices[maxIdx]) * 100,
            volume: parseFloat(m.volumeNum || m.volume || 0),
            endDate: m.endDate,
          });
        });
      });

      // 중복 제거(같은 질문이 여러 이벤트에 겹치는 경우) + 거래량 순 정렬
      const seen = new Set();
      const deduped = items.filter((it) => {
        if (seen.has(it.id)) return false;
        seen.add(it.id);
        return true;
      });
      deduped.sort((a, b) => b.volume - a.volume);

      setMarkets(deduped.slice(0, 6));
      setFetchedAt(new Date());
    } catch (e) {
      setError(e.message || "예측시장 데이터를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };

  const fmtEndDate = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} 마감`;
  };

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>예측시장 전망 (Polymarket)</div>
        <button onClick={fetchMarkets} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          {loading ? "조회 중…" : markets ? "다시 조회" : "불러오기"}
        </button>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {!markets && !loading && !error && (
        <div style={styles.newsEmpty}>
          버튼을 눌러 Polymarket에서 실제 베팅이 걸린 XRP 관련 예측시장을 가져옵니다. 확률은 애널리스트 의견이
          아니라 실제 돈을 건 트레이더들의 집단 예측입니다.
        </div>
      )}

      {markets && markets.length === 0 && (
        <div style={styles.newsEmpty}>현재 조건에 맞는 활성 XRP 예측시장을 찾지 못했습니다.</div>
      )}

      {markets && markets.length > 0 && (
        <>
          <div style={styles.pmList}>
            {markets.map((m) => (
              <a
                key={m.id}
                href={m.slug ? `https://polymarket.com/event/${m.slug}` : "https://polymarket.com"}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.pmRow}
              >
                <div style={styles.pmQuestion}>{m.question}</div>
                <div style={styles.pmMetaRow}>
                  <span
                    style={{
                      ...styles.pmProbability,
                      color: m.probability >= 50 ? "#6FCB9F" : "#E2604F",
                    }}
                  >
                    {m.leadingOutcome} {m.probability.toFixed(0)}%
                  </span>
                  <span style={styles.pmMetaSub}>
                    ${(m.volume / 1000).toFixed(0)}K 거래량{m.endDate ? ` · ${fmtEndDate(m.endDate)}` : ""}
                  </span>
                </div>
                <div style={styles.pmBar}>
                  <div style={{ ...styles.pmBarFill, width: `${m.probability}%` }} />
                </div>
              </a>
            ))}
          </div>
          {fetchedAt && (
            <div style={{ ...styles.newsTimestamp, marginTop: 8 }}>
              {fetchedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 조회 · 탭하면 Polymarket
              페이지로 이동
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NewsPanel({ assetKey }) {
  const [news, setNews] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  const fetchNews = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/news?asset=${encodeURIComponent(assetKey)}`);
      const parsed = await response.json();
      if (!response.ok || parsed.error) throw new Error(parsed.error || `뉴스 조회에 실패했습니다 (${response.status})`);
      setNews(parsed);
      setFetchedAt(new Date());
    } catch (e) {
      setError(e.message || "뉴스를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (score) => {
    if (score >= 67) return "#6FCB9F";
    if (score <= 33) return "#E2604F";
    return "#8B948E";
  };

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>뉴스 기반 심리</div>
        <button onClick={fetchNews} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          {loading ? "검색 중…" : news ? "다시 조회" : "뉴스 불러오기"}
        </button>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {!news && !loading && !error && (
        <div style={styles.newsEmpty}>
          버튼을 눌러 최근 24~48시간 {assetKey} 관련 뉴스를 검색하고 분위기를 0~100 점수로 요약합니다.
        </div>
      )}

      {news && (
        <>
          <div style={styles.gaugeRow}>
            <div style={{ ...styles.gaugeScore, color: scoreColor(news.score) }}>{news.score}</div>
            {fetchedAt && (
              <span style={styles.newsTimestamp}>
                {fetchedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 조회
              </span>
            )}
          </div>
          {news.headlines && news.headlines.length > 0 && (
            <ul style={styles.newsList}>
              {news.headlines.map((h, i) => (
                <li key={i} style={styles.newsListItem}>
                  <span style={styles.newsListDot}>·</span>
                  {h.url ? (
                    <a href={h.url} target="_blank" rel="noopener noreferrer" style={styles.newsLink}>
                      {h.title}
                      {h.source && <span style={styles.newsSource}> — {h.source}</span>}
                    </a>
                  ) : (
                    <span>
                      {h.title}
                      {h.source && <span style={styles.newsSource}> — {h.source}</span>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
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
    marginBottom: 10,
  },
  tabRow: {
    display: "flex",
    gap: 4,
    flexWrap: "wrap",
    background: "#171D1A",
    padding: 4,
    borderRadius: 8,
  },
  tab: {
    background: "transparent",
    border: "1px solid transparent",
    color: "#8B948E",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.02em",
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
  },
  subHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    flexWrap: "wrap",
    gap: 8,
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
  tfRow: {
    display: "flex",
    gap: 8,
  },
  tfBtn: {
    background: "transparent",
    border: "1px solid #232B27",
    color: "#5B6660",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    padding: "5px 10px",
    borderRadius: 6,
    cursor: "pointer",
  },
  tfBtnActive: {
    color: "#EDEAE3",
    borderColor: "#5B6660",
    background: "rgba(255,255,255,0.03)",
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
  pmList: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  pmRow: {
    display: "block",
    textDecoration: "none",
    paddingBottom: 12,
    borderBottom: "1px solid #232B27",
  },
  pmQuestion: {
    fontSize: 13,
    color: "#EDEAE3",
    lineHeight: 1.5,
    marginBottom: 6,
  },
  pmMetaRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  pmProbability: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 13,
    fontWeight: 600,
  },
  pmMetaSub: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 10,
    color: "#5B6660",
  },
  pmBar: {
    height: 4,
    borderRadius: 2,
    background: "#232B27",
    overflow: "hidden",
  },
  pmBarFill: {
    height: "100%",
    background: "#5B9BD5",
  },
  accountBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    padding: "8px 4px",
    flexWrap: "wrap",
    gap: 6,
  },
  accountText: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    color: "#8B948E",
  },
  accountBtn: {
    background: "transparent",
    border: "1px solid #5B9BD5",
    color: "#5B9BD5",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    padding: "5px 10px",
    borderRadius: 6,
    cursor: "pointer",
  },
  accountBtnGhost: {
    background: "transparent",
    border: "1px solid #232B27",
    color: "#5B6660",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    padding: "5px 10px",
    borderRadius: 6,
    cursor: "pointer",
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 100,
  },
  modalCard: {
    background: "#171D1A",
    border: "1px solid #232B27",
    borderRadius: "16px 16px 0 0",
    padding: 20,
    width: "100%",
    maxWidth: 480,
    maxHeight: "80vh",
    overflowY: "auto",
  },
  modalTitle: {
    fontFamily: "Space Grotesk, sans-serif",
    fontSize: 18,
    fontWeight: 600,
    color: "#EDEAE3",
    marginBottom: 14,
  },
  modalInput: {
    width: "100%",
    background: "#0E1210",
    border: "1px solid #232B27",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#EDEAE3",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 13,
    marginBottom: 10,
  },
  modalPrimaryBtn: {
    width: "100%",
    background: "#5B9BD5",
    border: "none",
    borderRadius: 8,
    padding: "11px 0",
    color: "#0E1210",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 8,
  },
  modalSwitchBtn: {
    width: "100%",
    background: "transparent",
    border: "none",
    color: "#8B948E",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    padding: "6px 0",
    cursor: "pointer",
  },
  modalCloseBtn: {
    width: "100%",
    background: "transparent",
    border: "1px solid #232B27",
    borderRadius: 8,
    padding: "10px 0",
    color: "#5B6660",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 12,
    cursor: "pointer",
    marginTop: 8,
  },
  tierCard: {
    border: "1px solid #232B27",
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  tierName: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 14,
    fontWeight: 600,
    color: "#EDEAE3",
    marginBottom: 6,
  },
  tierDesc: {
    fontSize: 12,
    color: "#8B948E",
    marginBottom: 10,
    lineHeight: 1.5,
  },
  lockedBody: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 8,
    padding: "16px 0",
  },
  newsList: {
    listStyle: "none",
    margin: "10px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  newsLink: {
    color: "#C7CCC8",
    textDecoration: "underline",
    textDecorationColor: "#5B6660",
    textUnderlineOffset: 2,
  },
  newsListItem: {
    display: "flex",
    gap: 6,
    fontSize: 12,
    lineHeight: 1.5,
    color: "#C7CCC8",
  },
  newsListDot: {
    color: "#5B6660",
  },
  newsSource: {
    color: "#5B6660",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
  },
  newsCard: {
    background: "#171D1A",
    border: "1px solid #232B27",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 16,
  },
  newsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  newsBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: "1px solid #232B27",
    color: "#8B948E",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 10,
    padding: "5px 9px",
    borderRadius: 6,
    cursor: "pointer",
  },
  newsEmpty: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    color: "#5B6660",
    lineHeight: 1.6,
  },
  newsTimestamp: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 10,
    color: "#5B6660",
  },
  newsSummary: {
    fontSize: 13,
    lineHeight: 1.7,
    color: "#EDEAE3",
    margin: 0,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    display: "inline-block",
  },
  posNote: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 10,
    color: "#5B6660",
    lineHeight: 1.6,
    marginTop: 4,
  },
  posGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  },
  posLabel: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 10,
    color: "#5B6660",
    marginBottom: 6,
  },
  posValue: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 4,
  },
  posSub: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 10,
    color: "#8B948E",
  },
  splitBar: {
    position: "relative",
    height: 8,
    borderRadius: 4,
    background: "#E2604F",
    overflow: "hidden",
    marginBottom: 6,
    marginTop: 4,
  },
  splitBarLong: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    background: "#6FCB9F",
  },
  posSplitRow: {
    display: "flex",
    justifyContent: "space-between",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    fontWeight: 600,
  },
  gaugeRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
  },
  gaugeScore: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 32,
    fontWeight: 600,
  },
  gaugeMeta: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  gaugeLabel: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 12,
    fontWeight: 600,
  },
  gaugeTrack: {
    position: "relative",
    height: 6,
    borderRadius: 3,
    marginBottom: 6,
    background: "linear-gradient(90deg, #E2604F 0%, #8B948E 50%, #6FCB9F 100%)",
  },
  gaugeTrackFill: {
    display: "none",
  },
  gaugeMarker: {
    position: "absolute",
    top: -3,
    width: 2,
    height: 12,
    background: "#EDEAE3",
    transform: "translateX(-1px)",
  },
  gaugeScaleRow: {
    display: "flex",
    justifyContent: "space-between",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 9,
    color: "#5B6660",
    marginBottom: 12,
  },
  tableCard: {
    background: "#171D1A",
    border: "1px solid #232B27",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 16,
  },
  tableTitle: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    color: "#8B948E",
    marginBottom: 10,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 12,
  },
  th: {
    textAlign: "left",
    color: "#5B6660",
    fontWeight: 500,
    fontSize: 10,
    padding: "6px 4px",
    borderBottom: "1px solid #232B27",
  },
  td: {
    padding: "7px 4px",
    color: "#EDEAE3",
  },
  trAlt: {
    background: "rgba(255,255,255,0.02)",
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
