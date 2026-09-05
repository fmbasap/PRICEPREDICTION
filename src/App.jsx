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
// 시나리오를 처음 정의한 기준일 - "예측한 시점"으로 삼아 경과시간 계산에 사용
const SCENARIO_BASELINE_DATE = "2026-09-03";

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

// 참고용 가상 시나리오 (실측 검증 대상 아님, 서술 + 차트로만 제공)
const HOLD_SCENARIO = {
  title: "동결 + 클래리티법 불발 + 재정정책 유동성",
  baseline: 1.37, // XRP 기준가 (2026-09-03)
  narrative: [
    "9월 15일, 미 의회의 디지털자산 시장구조법(CLARITY Act)이 최종 표결에서 불발됩니다. " +
      "이건 XRP 생태계에 특히 아픈 소식인데, 최근 ETF 자금 유입과 기관 참여 확대가 상당 부분 " +
      "\"규제 명확성\" 서사에 기대고 있었기 때문입니다. XRP는 이 소식에 단독으로 약 -6% 정도 " +
      "빠질 것으로 가정합니다.",
    "다음날인 9월 16일, FOMC는 시장이 우려하던 금리 인상 대신 동결을 선택합니다. 인상(당시 컨센서스 " +
      "약 66%)보다는 안도감을 주지만, 인하만큼 화끈한 호재는 아니라서 완만한 반등(+4% 내외)에 그칩니다.",
    "이후 몇 달간은 기준금리 자체는 그대로 묶여있지만, 재정정책(정부 지출·국채 발행 등)을 통한 " +
      "유동성 공급이 위험자산 전반을 서서히 밀어올리는 그림을 가정합니다. 다만 클래리티법 불발이라는 " +
      "앙금이 남아있어, 상단은 \"공격적 금리인하\" 시나리오만큼 뚫고 올라가진 못하는 것으로 설정했습니다.",
  ],
  points: [
    { label: "9/3(현재)", pct: 0 },
    { label: "9/14", pct: 0 },
    { label: "9/15(클래리티 불발)", pct: -6 },
    { label: "9/16(FOMC 동결)", pct: -2.2 },
    { label: "9/30", pct: 3 },
    { label: "10/15", pct: 8 },
    { label: "11/15", pct: 14 },
    { label: "12/15", pct: 20 },
  ],
};

// 브래드 갈링하우스(Ripple CEO) 주요 발언·행보 타임라인 (고정 데이터, 웹검색 기반 정리)
const GARLINGHOUSE_TIMELINE = [
  { date: "2015-04", period: "합류", text: "Ripple에 합류." },
  { date: "2016-11", period: "취임", text: "Ripple CEO로 공식 선임." },
  { date: "2020-초", period: "IPO 언급", text: "크립토 기업의 IPO 가능성을 처음 언급, 업계는 본인 상장 시사로 해석." },
  { date: "2020-12-22", period: "SEC 소송", text: "SEC가 Ripple·갈링하우스·전 CEO 크리스 라슨을 8년간 미등록 증권 판매 혐의로 제소." },
  { date: "2021", period: "Consensus", text: "SEC 문제 해결을 전제로 Ripple 상장 가능성이 '매우 높다'고 언급." },
  { date: "2021-12", period: "1주년 회고", text: "이 소송이 Ripple 하나가 아니라 크립토 산업 전체를 겨냥한 공격이라는 입장 재확인." },
  { date: "2023-07-13", period: "1심 판결", text: "토레스 판사, 개인 매도분·거래소 프로그래매틱 판매는 승소, 방조 혐의는 재판行으로 남김." },
  { date: "2024", period: "혐의 기각", text: "SEC가 방조 혐의 재판을 포기, 본인에 대한 모든 SEC 혐의 완전 기각." },
  { date: "2025-03", period: "최종 승리", text: "SEC 항소 철회로 4년 넘는 소송 최종 종결. '크립토 전쟁에서의 승리'로 규정." },
  { date: "2025-11", period: "Ripple Swell", text: "400억 달러 밸류에이션 5억 달러 투자 유치, Mastercard·Gemini 파트너십 발표." },
  { date: "2025-12-03", period: "바이낸스 블록체인 위크", text: "'최근 몇 년 중 가장 낙관적'이라며 2026년을 '가장 강세일 해'로 지목." },
  { date: "2026-01", period: "다보스 WEF", text: "스테이블코인 거래량 2024년 19조→2025년 33조 달러(약 75%↑) 성장세를 근거로 제시." },
  { date: "2026-02", period: "클래리티법 전망", text: "4월까지 통과 확률 80~90% 제시, 이후 시점을 5월 말로 수정." },
  { date: "2026-04-28", period: "XRP 라스베이거스", text: "'Lock in' 트윗 게시 — 과거 대형 발표 전 반복 사용한 표현이라 업계 주목." },
  { date: "2026", period: "와이오밍 심포지엄", text: "비상장 만족 기조에서, 상장을 어느 때보다 적극 고려하는 쪽으로 입장 선회." },
  {
    date: "2026-07",
    period: "KU 팟캐스트 회고",
    text: "소송 기간 법률비용 1.5억 달러, 미국 사업 약 5년 정지, 회사 폐업까지 논의했었다고 공개. 본인만 벌금으로 끝내주겠다는 SEC 제안은 거절했다고 밝힘.",
  },
];


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

// 홀트 이중지수평활(Holt's linear trend method) - 단순 선형회귀보다 최근 변곡점을 더 빨리 반영함.
// alpha: 값(레벨) 평활 계수, beta: 추세 평활 계수 (둘 다 0~1, 클수록 최근 데이터에 민감)
function holtForecast(points, forwardSteps, alpha = 0.4, beta = 0.2) {
  const n = points.length;
  if (n < 2) return { projected: [], finalLevel: null, finalTrend: null };

  let level = points[0];
  let trend = points[1] - points[0];

  for (let i = 1; i < n; i++) {
    const prevLevel = level;
    level = alpha * points[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  const projected = [];
  for (let h = 1; h <= forwardSteps; h++) {
    projected.push(level + h * trend);
  }
  return { projected, finalLevel: level, finalTrend: trend };
}

// <input type="datetime-local">에 넣을 수 있는 "현재 시각" 문자열 (로컬 타임존 기준, YYYY-MM-DDTHH:mm)
function nowForDateTimeLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// ---- 사용자 직접 예측 (localStorage에 저장, 자산 단위로 저장하고 시간대 무관하게 채점) ----
function userPredKey(asset) {
  return `userpred_v1_${asset}`;
}

function loadUserPredLog(asset) {
  try {
    const raw = localStorage.getItem(userPredKey(asset));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUserPredLog(asset, log) {
  try {
    localStorage.setItem(userPredKey(asset), JSON.stringify(log.slice(-50)));
  } catch {
    // 무시
  }
}

function resolveUserPredLog(log, rawPrices, toleranceMs) {
  if (!rawPrices || rawPrices.length === 0) return { log, changed: false };
  let changed = false;
  const now = Date.now();
  const nextLog = log.map((t) => {
    if (t.resolved || t.targetTs > now) return t;
    let nearestPrice = null;
    let nearestDiff = Infinity;
    for (const [ts, price] of rawPrices) {
      const diff = Math.abs(ts - t.targetTs);
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
  return { log: nextLog, changed };
}

// 지나간 목표 시점에 대해, 그 시점에 가장 가까운 실제 가격을 찾아 오차를 채워 넣는다
function resolvePredLog(log, rawPrices, toleranceMs) {
  if (!rawPrices || rawPrices.length === 0) return { log, changed: false };
  let changed = false;
  const now = Date.now();

  const resolveArr = (arr) =>
    (arr || []).map((t) => {
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

  const nextLog = log.map((batch) => ({
    ...batch,
    targets: resolveArr(batch.targets),
    holtTargets: resolveArr(batch.holtTargets), // 예전 기록(홀트 도입 전)은 undefined -> 빈 배열로 처리됨
  }));
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
  const tierRank = { free: 0, bronze: 1, silver: 2, gold: 3 };
  const hasAccess = (requiredTier) => profile?.is_admin || tierRank[tier] >= tierRank[requiredTier];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const fetchFromCoinGecko = useCallback(async (key, tf) => {
    const meta = ASSETS[key];
    const tfConf = TIMEFRAMES[tf];

    const intervalParam = tf === "daily" ? "&interval=daily" : "";
    const url = `https://api.coingecko.com/api/v3/coins/${meta.id}/market_chart?vs_currency=usd&days=${tfConf.days}${intervalParam}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8초 넘으면 포기하고 대체 소스로
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.status === 429) throw new Error("RATE_LIMIT");
      if (!res.ok) throw new Error(`CoinGecko 오류 (${res.status})`);
      const json = await res.json();
      if (!json.prices || json.prices.length === 0) throw new Error("CoinGecko 데이터 없음");
      return json.prices;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  // CoinGecko가 막혀도(사파리 프라이빗 릴레이, 광고차단 확장, 일시적 차단 등) 서비스가 죽지 않도록
  // Binance 공개 캔들 데이터로 대체 조회
  const fetchFromBinance = useCallback(async (key, tf) => {
    const meta = ASSETS[key];
    const interval = tf === "daily" ? "1d" : "1h";
    const limit = tf === "daily" ? 90 : 168; // 시간별=7일치(24*7), 일별=90일치
    const url = `https://api.binance.com/api/v3/klines?symbol=${meta.futuresSymbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance 오류 (${res.status})`);
    const candles = await res.json();
    if (!candles.length) throw new Error("Binance 데이터 없음");
    // CoinGecko의 [[timestamp, price], ...] 형식으로 맞춰서 반환 (종가 기준)
    return candles.map((c) => [c[0], parseFloat(c[4])]);
  }, []);

  const fetchAssetOnce = useCallback(
    async (key, tf) => {
      try {
        return await fetchFromCoinGecko(key, tf);
      } catch (e) {
        if (e.message === "RATE_LIMIT") throw e; // 429는 기존 재시도 로직에서 처리
        // 그 외 실패(네트워크 차단, 타임아웃 등)는 바로 Binance로 대체
        try {
          return await fetchFromBinance(key, tf);
        } catch {
          throw e; // 둘 다 실패하면 원래(CoinGecko) 에러를 보여줌
        }
      }
    },
    [fetchFromCoinGecko, fetchFromBinance]
  );

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
      holtProjection: null,
    }));

    const recentWindow = prices.slice(-tfConf.regressionWindow);
    const { projected, slope } = linearRegressionProjection(recentWindow, tfConf.forwardUnits);
    const { projected: holtProjected, finalTrend: holtTrend } = holtForecast(recentWindow, tfConf.forwardUnits);
    const lastTs = timestamps[timestamps.length - 1];

    chartData[chartData.length - 1] = {
      ...chartData[chartData.length - 1],
      projection: chartData[chartData.length - 1].price,
      holtProjection: chartData[chartData.length - 1].price,
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
        holtProjection: holtProjected[idx] ?? null,
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

    const holtProjectedChangePct =
      currentPrice && holtProjected.length
        ? ((holtProjected[holtProjected.length - 1] - currentPrice) / currentPrice) * 100
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
      holtTrend,
      holtProjectedChangePct,
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

      // 신뢰도 필터: 각 방법이 가리키는 최종 변화율이 너무 작으면(방향이 애매하면)
      // 틀릴 확률이 높으므로, 그 방법의 예측만 건너뜀 (선형회귀·홀트 각각 독립적으로 판단).
      // 시간별은 예측 구간이 짧아 원래 변동폭이 작아서 기준을 낮게, 일별은 기준을 조금 높게 잡음.
      const MIN_SIGNAL_PCT = timeframe === "hourly" ? 0.3 : 1.0;
      const linearSignalStrong = Math.abs(analysis.projectedChangePct) >= MIN_SIGNAL_PCT;
      const holtSignalStrong = Math.abs(analysis.holtProjectedChangePct) >= MIN_SIGNAL_PCT;

      if (canAppend && (linearSignalStrong || holtSignalStrong)) {
        const targets = linearSignalStrong
          ? analysis.chartData
              .filter((d) => d.projection != null && d.price == null)
              .map((d) => ({ ts: d.ts, predicted: d.projection, actual: null, resolved: false }))
          : [];
        const holtTargets = holtSignalStrong
          ? analysis.chartData
              .filter((d) => d.holtProjection != null && d.price == null)
              .map((d) => ({ ts: d.ts, predicted: d.holtProjection, actual: null, resolved: false }))
          : [];
        if (targets.length > 0 || holtTargets.length > 0) {
          log = [...log, { createdAt: Date.now(), basePrice: analysis.currentPrice, targets, holtTargets }];
          appendChanged = true;
        }
      }
    }

    if (resolveChanged || appendChanged) {
      savePredLog(asset, timeframe, log);
    }
    setPredLog(log);
  }, [analysis, cache, asset, timeframe, lastUpdated, tfConf]);

  // ---- 사용자 직접 예측: 지나간 목표시점 자동 검증 ----
  const [userPredLog, setUserPredLog] = useState([]);

  useEffect(() => {
    if (!cache[asset]) return;
    let log = loadUserPredLog(asset);
    // 사용자가 자유롭게 목표시점을 고르므로, 넉넉하게(12시간) 허용오차를 둠
    const { log: resolvedLog, changed } = resolveUserPredLog(log, cache[asset], 12 * 60 * 60 * 1000);
    if (changed) saveUserPredLog(asset, resolvedLog);
    setUserPredLog(resolvedLog);
  }, [cache, asset]);

  const addUserPrediction = (predictedPrice, targetDateTimeLocal) => {
    if (!analysis) return { ok: false, message: "현재가를 아직 못 불러왔습니다" };
    const targetTs = new Date(targetDateTimeLocal).getTime();
    if (!targetTs || Number.isNaN(targetTs)) return { ok: false, message: "목표 시점을 확인해주세요" };
    if (targetTs <= Date.now()) return { ok: false, message: "목표 시점은 미래여야 합니다" };
    if (!predictedPrice || Number.isNaN(predictedPrice)) return { ok: false, message: "예측 가격을 입력해주세요" };

    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
      targetTs,
      basePrice: analysis.currentPrice,
      predicted: predictedPrice,
      actual: null,
      resolved: false,
    };
    const next = [...userPredLog, entry];
    saveUserPredLog(asset, next);
    setUserPredLog(next);
    return { ok: true };
  };

  return (
    <div style={styles.page}>
      <style>{FONT_IMPORT}</style>
      <div style={styles.container}>
        <AccountBar session={session} profile={profile} authLoading={authLoading} tier={tier} />

        {profile?.is_admin && <AdminPanel />}

        <IndicesPanel />

        <BitcoinDominancePanel />

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
                <LegendItem color="#F4A6C6" label="홀트 예측선" dotted />
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
                  <Line type="monotone" dataKey="holtProjection" stroke="#F4A6C6" strokeWidth={1.5} strokeDasharray="1 3" dot={false} connectNulls />
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

            <section style={styles.tableCard}>
              <div style={styles.tableTitle}>홀트 예측 표 ({tfConf.forwardLabel})</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>시점</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>홀트 예측 가격</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>현재가 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.chartData
                    .filter((d) => d.holtProjection != null && d.price == null)
                    .map((d, i) => {
                      const pct = ((d.holtProjection - analysis.currentPrice) / analysis.currentPrice) * 100;
                      return (
                        <tr key={i} style={i % 2 === 1 ? styles.trAlt : undefined}>
                          <td style={styles.td}>{d.date}</td>
                          <td style={{ ...styles.td, textAlign: "right" }}>{fmtPrice(d.holtProjection)}</td>
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

            <PredictionAccuracyCard
              log={predLog}
              timeframe={timeframe}
              userPredLog={userPredLog}
              onAddUserPrediction={addUserPrediction}
              currentPrice={analysis.currentPrice}
            />

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
              <SignalCard
                title={`홀트 예측 (${tfConf.forwardLabel} 후)`}
                value={`${analysis.holtProjectedChangePct >= 0 ? "+" : ""}${analysis.holtProjectedChangePct.toFixed(1)}%`}
                status={analysis.holtProjectedChangePct >= 0 ? "up" : "down"}
                sub="이중지수평활 - 최근 변곡점 민감"
              />
            </section>

            <PositioningPanel key={`pos-${asset}`} symbol={meta.futuresSymbol} accent={meta.accent} />

            <VolumeProfilePanel
              key={`vp-${asset}`}
              coinId={meta.id}
              futuresSymbol={meta.futuresSymbol}
              accent={meta.accent}
              currentPrice={analysis.currentPrice}
            />

            <KrwVolumeProfilePanel
              key={`krwvp-${asset}`}
              coinId={meta.id}
              futuresSymbol={meta.futuresSymbol}
              label={meta.label}
              accent={meta.accent}
            />

            {hasAccess("silver") ? (
              <LiquidationPanel key={`liq-${asset}`} symbol={meta.futuresSymbol} accent={meta.accent} />
            ) : (
              <LockedPanel title="실시간 청산 추적" requiredTier="silver" />
            )}

            {asset === "XRP" &&
              (hasAccess("gold") ? (
                <NewsPanel key={asset} assetKey={asset} />
              ) : (
                <LockedPanel title="뉴스 기반 심리" requiredTier="gold" />
              ))}

            {hasAccess("bronze") ? (
              <PredictionMarketPanel key={asset} assetKey={asset} />
            ) : (
              <LockedPanel title="예측시장 전망 (Polymarket)" requiredTier="bronze" />
            )}

            {asset === "XRP" && <GarlinghouseTimelinePanel />}

            {asset === "XRP" &&
              (hasAccess("silver") ? <ExchangeFlowPanel /> : <LockedPanel title="대형 지갑 잔고 추적" requiredTier="silver" />)}

            {hasAccess("silver") ? (
              <ScenarioBattlePanel />
            ) : (
              <LockedPanel title="시나리오 대결: 김광석 vs 컨센서스" requiredTier="silver" />
            )}

            {hasAccess("silver") && <HoldScenarioNarrativePanel />}

            {hasAccess("silver") && <CheckpointSummaryPanel />}

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

// 시간대(horizon)별 가중치 - 멀리 내다본 예측일수록 맞히기 어려우므로 가중치를 높게 줌
// 시간대(horizon)별 가중치
// 1h=1점, 2h=2점, 3h=3점까지는 그대로. 그 이후로는 시간이 2배가 될 때마다 +1점씩 늘어나서
// (6h=4, 12h=5, 24h=6, 48h=7, 96h=8, 192h=9, 384h=10, ...) 최대 30점까지 증가합니다.
function getHorizonWeight(hours) {
  if (hours <= 1) return 1;
  if (hours <= 2) return 2;
  if (hours <= 3) return 3;
  let h = 3;
  let point = 3;
  while (hours > h && point < 30) {
    h *= 2;
    point += 1;
  }
  return Math.min(point, 30);
}

// 하나의 target 배열(선형 또는 홀트)에 대해 MAPE/편향/자기강화 점수를 계산
// 같은 목표 시점(ts)을 겨냥한 예측이 여러 번(예: 시간별 10분 간격 재저장) 쌓인 경우,
// 채점 시엔 그중 가장 나중에(더 최신 정보로) 만들어진 예측 하나만 대표로 씀 - 중복 과채점 방지.
function dedupeByTargetTs(resolved) {
  const byTs = new Map();
  resolved.forEach((t) => {
    const existing = byTs.get(t.ts);
    if (!existing || t.createdAt > existing.createdAt) {
      byTs.set(t.ts, t);
    }
  });
  return Array.from(byTs.values());
}

function scoreMethod(log, key) {
  const resolvedRaw = log.flatMap((batch) =>
    (batch[key] || [])
      .filter((t) => t.resolved)
      .map((t) => ({ ...t, createdAt: batch.createdAt, basePrice: batch.basePrice }))
  );
  const resolved = dedupeByTargetTs(resolvedRaw);
  const pendingCount = log.reduce((sum, b) => sum + (b[key] || []).filter((t) => !t.resolved).length, 0);

  const errors = resolved.map((t) => ((t.actual - t.predicted) / t.predicted) * 100);
  const mape = errors.length ? errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length : null;
  const bias = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;

  const scored = resolved.map((t) => {
    const horizonHours = Math.max(0.01, (t.ts - t.createdAt) / (60 * 60 * 1000));
    const predictedDir = t.predicted - t.basePrice;
    const actualDir = t.actual - t.basePrice;
    const isFlat = Math.abs(predictedDir) < 1e-9 || Math.abs(actualDir) < 1e-9;
    const isHit = !isFlat && Math.sign(predictedDir) === Math.sign(actualDir);
    const weight = getHorizonWeight(horizonHours);
    const points = isFlat ? 0 : isHit ? weight : -7;
    return { ...t, horizonHours, isHit, isFlat, weight, points };
  });
  const judged = scored.filter((s) => !s.isFlat);
  const totalScore = judged.reduce((a, b) => a + b.points, 0);
  const hitCount = judged.filter((s) => s.isHit).length;
  const missCount = judged.length - hitCount;
  const hitRate = judged.length ? (hitCount / judged.length) * 100 : null;

  return { resolved, pendingCount, mape, bias, scored, judged, totalScore, hitCount, missCount, hitRate };
}

// 사용자 직접 예측(평평한 배열, ts 대신 targetTs)용 채점 - 로직은 scoreMethod와 동일
function scoreUserPredictions(userPredLog) {
  const resolvedRaw = userPredLog.filter((t) => t.resolved).map((t) => ({ ...t, ts: t.targetTs }));
  const resolved = dedupeByTargetTs(resolvedRaw);
  const pendingCount = userPredLog.filter((t) => !t.resolved).length;

  const errors = resolved.map((t) => ((t.actual - t.predicted) / t.predicted) * 100);
  const mape = errors.length ? errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length : null;
  const bias = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;

  const scored = resolved.map((t) => {
    const horizonHours = Math.max(0.01, (t.targetTs - t.createdAt) / (60 * 60 * 1000));
    const predictedDir = t.predicted - t.basePrice;
    const actualDir = t.actual - t.basePrice;
    const isFlat = Math.abs(predictedDir) < 1e-9 || Math.abs(actualDir) < 1e-9;
    const isHit = !isFlat && Math.sign(predictedDir) === Math.sign(actualDir);
    const weight = getHorizonWeight(horizonHours);
    const points = isFlat ? 0 : isHit ? weight : -7;
    return { ...t, horizonHours, isHit, isFlat, weight, points };
  });
  const judged = scored.filter((s) => !s.isFlat);
  const totalScore = judged.reduce((a, b) => a + b.points, 0);
  const hitCount = judged.filter((s) => s.isHit).length;
  const missCount = judged.length - hitCount;
  const hitRate = judged.length ? (hitCount / judged.length) * 100 : null;

  return { resolved, pendingCount, mape, bias, scored, judged, totalScore, hitCount, missCount, hitRate };
}

function MethodScoreBlock({ title, color, m, timeframe }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ ...styles.posLabel, color, fontSize: 12, marginBottom: 6 }}>{title}</div>
      {m.judged.length === 0 ? (
        <div style={styles.newsEmpty}>아직 검증된 예측이 없습니다.</div>
      ) : (
        <>
          <div style={{ ...styles.posValue, color: m.totalScore >= 0 ? "#6FCB9F" : "#E2604F", fontSize: 20 }}>
            {m.totalScore >= 0 ? "+" : ""}
            {m.totalScore}점
          </div>
          <div style={styles.posSub}>
            적중 {m.hitCount} / 미적중 {m.missCount} (적중률 {m.hitRate.toFixed(0)}%)
          </div>
          <div style={{ ...styles.posSub, marginTop: 4 }}>
            MAPE {m.mape.toFixed(2)}% · 편향 {m.bias >= 0 ? "+" : ""}
            {m.bias.toFixed(2)}%
          </div>
        </>
      )}
      {m.pendingCount > 0 && (
        <div style={{ ...styles.posSub, marginTop: 4 }}>검증 대기 {m.pendingCount}건</div>
      )}
    </div>
  );
}

function PredictionAccuracyCard({ log, timeframe, userPredLog, onAddUserPrediction, currentPrice }) {
  const linear = scoreMethod(log, "targets");
  const holt = scoreMethod(log, "holtTargets");
  const user = scoreUserPredictions(userPredLog || []);

  const recentAll = [
    ...linear.scored.map((s) => ({ ...s, method: "선형" })),
    ...holt.scored.map((s) => ({ ...s, method: "홀트" })),
    ...user.scored.map((s) => ({ ...s, method: "직접입력" })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 8);

  // ---- 종합 판정: 세 방법의 지금까지 성적(점수)을 가중치 삼아 현재 진행 중인 방향을 합산 ----
  const scoreWeight = (total) => Math.max(0, total) + 0.5; // 점수가 마이너스여도 최소한의 발언권은 남겨둠
  const wLinear = scoreWeight(linear.totalScore);
  const wHolt = scoreWeight(holt.totalScore);
  // 사용자의 "현재 유효한(아직 안 지난)" 가장 최근 예측 하나를 종합 판정에 반영
  const activeUserPred = [...(userPredLog || [])]
    .filter((t) => !t.resolved && t.targetTs > Date.now())
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const wUser = scoreWeight(user.totalScore);

  // 종합 판정은 "지금 이 순간의 방향 신호"가 필요하므로, 각 방법의 마지막 저장된 예측(미확정 포함) 중 최신 걸 씀
  const latestLinear = [...log].reverse().find((b) => (b.targets || []).length > 0);
  const latestHolt = [...log].reverse().find((b) => (b.holtTargets || []).length > 0);
  const linearSignalDir =
    latestLinear && latestLinear.targets.length
      ? Math.sign(latestLinear.targets[latestLinear.targets.length - 1].predicted - latestLinear.basePrice)
      : 0;
  const holtSignalDir =
    latestHolt && latestHolt.holtTargets.length
      ? Math.sign(latestHolt.holtTargets[latestHolt.holtTargets.length - 1].predicted - latestHolt.basePrice)
      : 0;
  const userSignalDir = activeUserPred ? Math.sign(activeUserPred.predicted - activeUserPred.basePrice) : 0;

  const weightedSum =
    linearSignalDir * wLinear + holtSignalDir * wHolt + userSignalDir * (activeUserPred ? wUser : 0);
  const totalW = wLinear + wHolt + (activeUserPred ? wUser : 0);
  const consensusScore = totalW > 0 ? weightedSum / totalW : 0;
  const hasAnySignal = linearSignalDir !== 0 || holtSignalDir !== 0 || (activeUserPred && userSignalDir !== 0);

  // ---- 입력 폼 상태 ----
  const [priceInput, setPriceInput] = useState("");
  const [timeInput, setTimeInput] = useState(() => nowForDateTimeLocal());
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(false);

  const submitPrediction = () => {
    setFormError(null);
    setFormSuccess(false);
    const price = parseFloat(priceInput);
    const result = onAddUserPrediction(price, timeInput);
    if (!result.ok) {
      setFormError(result.message);
    } else {
      setFormSuccess(true);
      setPriceInput("");
      setTimeInput(nowForDateTimeLocal());
    }
  };

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>예측 정확도 기록 (선형회귀 · 홀트 · 직접입력)</div>
      </div>

      {hasAnySignal && (
        <div style={{ ...styles.posNote, marginBottom: 10, color: consensusScore >= 0 ? "#6FCB9F" : "#E2604F" }}>
          종합 판정 (성적 가중): {consensusScore >= 0.15 ? "상승 우세" : consensusScore <= -0.15 ? "하락 우세" : "혼조"} ·
          가중치 = 선형 {wLinear.toFixed(1)} / 홀트 {wHolt.toFixed(1)}
          {activeUserPred ? ` / 직접입력 ${wUser.toFixed(1)}` : ""} (지금까지 점수가 높을수록 발언권이 커짐)
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <MethodScoreBlock title="선형회귀 추세연장" color="#EDEAE3" m={linear} timeframe={timeframe} />
        <MethodScoreBlock title="홀트 이중지수평활" color="#F4A6C6" m={holt} timeframe={timeframe} />
        <MethodScoreBlock title="내 직접 예측" color="#5B9BD5" m={user} timeframe={timeframe} />
      </div>

      <div style={{ borderTop: "1px solid #232B27", paddingTop: 12, marginBottom: 12 }}>
        <div style={{ ...styles.posLabel, marginBottom: 8 }}>내 예측 등록하기</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input
            type="number"
            step="any"
            placeholder={currentPrice ? `예: ${currentPrice.toFixed(4)}` : "예측 가격"}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            style={{ ...styles.modalInput, marginBottom: 0, flex: "1 1 140px" }}
          />
          <input
            type="datetime-local"
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            style={{ ...styles.modalInput, marginBottom: 0, flex: "1 1 180px" }}
          />
        </div>
        <button onClick={submitPrediction} style={styles.accountBtn}>
          예측 등록
        </button>
        {formError && <div style={{ ...styles.posNote, color: "#E2604F", marginTop: 6 }}>{formError}</div>}
        {formSuccess && <div style={{ ...styles.posNote, color: "#6FCB9F", marginTop: 6 }}>등록됐습니다. 목표 시점이 지나면 자동으로 채점됩니다.</div>}
      </div>

      {recentAll.length === 0 ? (
        <div style={styles.newsEmpty}>
          아직 검증된 예측이 없습니다. 추세선이 가리켰던 미래 시점이 실제로 지나야 비교할 수 있어요. 이 화면을
          다시 열 때마다 자동으로 쌓입니다.
        </div>
      ) : (
        <table style={{ ...styles.table, marginTop: 4 }}>
          <thead>
            <tr>
              <th style={styles.th}>방법</th>
              <th style={styles.th}>목표시점</th>
              <th style={{ ...styles.th, textAlign: "right" }}>예측가</th>
              <th style={{ ...styles.th, textAlign: "right" }}>실제가</th>
              <th style={{ ...styles.th, textAlign: "right" }}>점수</th>
            </tr>
          </thead>
          <tbody>
            {recentAll.map((t, i) => (
              <tr key={i} style={i % 2 === 1 ? styles.trAlt : undefined}>
                <td
                  style={{
                    ...styles.td,
                    color: t.method === "홀트" ? "#F4A6C6" : t.method === "직접입력" ? "#5B9BD5" : "#EDEAE3",
                  }}
                >
                  {t.method}
                </td>
                <td style={styles.td}>{fmtLabel(t.ts, timeframe)}</td>
                <td style={{ ...styles.td, textAlign: "right" }}>{fmtPrice(t.predicted)}</td>
                <td style={{ ...styles.td, textAlign: "right" }}>{fmtPrice(t.actual)}</td>
                <td
                  style={{
                    ...styles.td,
                    textAlign: "right",
                    color: t.isFlat ? "#5B6660" : t.isHit ? "#6FCB9F" : "#E2604F",
                    fontWeight: 600,
                  }}
                >
                  {t.isFlat ? "-" : `${t.points >= 0 ? "+" : ""}${t.points}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ ...styles.posNote, marginTop: 10 }}>
        새 예측은 최소 {timeframe === "hourly" ? "10분" : "1일"} 간격으로만 저장됩니다. 같은 목표 시점을 겨냥한
        예측이 여러 번 쌓이면(예: 시간별 10분마다 재저장), 채점 시엔 그중 가장 나중에 만들어진 예측 하나만
        대표로 씁니다 (중복 과채점 방지). 각 방법은 자기 예상 변화율이{" "}
        {timeframe === "hourly" ? "0.3%" : "1.0%"} 미만으로 방향이 애매하면 그 방법만 독립적으로 건너뜁니다
        (선형회귀는 저장되고 홀트는 안 될 수도, 반대도 가능). 점수 규칙은 1h:1점 · 2h:2점 · 3h:3점, 이후 2배가
        될 때마다 +1점(최대 30점) · 오답 -7점입니다. "종합 판정"은 세 방법의 지금까지 누적 점수를 가중치로 써서
        현재 진행 중인 방향을 합산한 참고 지표입니다. 이 기기(브라우저)에만 저장됩니다.
      </div>
    </section>
  );
}

function TIER_LABEL(tier) {
  return { free: "무료", bronze: "브론즈", silver: "실버", gold: "골드" }[tier] || "무료";
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
          {tier !== "gold" && (
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
              <div style={styles.tierDesc}>예측시장 전망(Polymarket)</div>
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
            <div style={styles.tierCard}>
              <div style={styles.tierName}>골드 · 월 50,000원</div>
              <div style={styles.tierDesc}>실버 전체 + 뉴스 기반 심리</div>
              <button onClick={() => request("gold")} style={styles.modalPrimaryBtn} disabled={requesting}>
                골드 신청
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

function BitcoinDominancePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchDominance = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/global");
      if (!res.ok) throw new Error(`조회에 실패했습니다 (${res.status})`);
      const json = await res.json();
      const d = json.data;
      setData({
        btcDominance: d.market_cap_percentage?.btc,
        ethDominance: d.market_cap_percentage?.eth,
        totalMarketCap: d.total_market_cap?.usd,
        marketCapChange24h: d.market_cap_change_percentage_24h_usd,
      });
    } catch (e) {
      setError(e.message || "도미넌스 데이터를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDominance();
  }, []);

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>비트코인 도미넌스</div>
        <button onClick={fetchDominance} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          갱신
        </button>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && <div style={styles.newsEmpty}>조회 중…</div>}

      {data && (
        <div style={styles.posGrid}>
          <div>
            <div style={styles.posLabel}>BTC 도미넌스</div>
            <div style={{ ...styles.posValue, color: "#F7931A" }}>
              {data.btcDominance != null ? `${data.btcDominance.toFixed(1)}%` : "-"}
            </div>
            <div style={styles.posSub}>전체 시가총액 중 BTC 비중</div>
          </div>
          <div>
            <div style={styles.posLabel}>ETH 도미넌스</div>
            <div style={{ ...styles.posValue, color: "#8B948E" }}>
              {data.ethDominance != null ? `${data.ethDominance.toFixed(1)}%` : "-"}
            </div>
            <div style={styles.posSub}>전체 시가총액 중 ETH 비중</div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={styles.posLabel}>전체 암호화폐 시가총액</div>
            <div style={styles.posValue}>
              ${data.totalMarketCap != null ? (data.totalMarketCap / 1_000_000_000_000).toFixed(2) : "-"}
              T
            </div>
            <div
              style={{
                ...styles.posSub,
                color: data.marketCapChange24h >= 0 ? "#6FCB9F" : "#E2604F",
              }}
            >
              {data.marketCapChange24h != null
                ? `${data.marketCapChange24h >= 0 ? "+" : ""}${data.marketCapChange24h.toFixed(2)}% (24h)`
                : "-"}
            </div>
          </div>
        </div>
      )}

      <div style={{ ...styles.posNote, marginTop: 10 }}>
        BTC 도미넌스가 오르면 자금이 BTC로 쏠리는(알트코인 상대적 약세) 국면, 내리면 알트코인으로 자금이
        분산되는(알트시즌) 국면으로 흔히 해석됩니다. 데이터 출처: CoinGecko.
      </div>
    </section>
  );
}

function IndicesPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchIndices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/indices");
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `조회에 실패했습니다 (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e.message || "지수 데이터를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIndices();
  }, []);

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>코스피 · 나스닥</div>
        <button onClick={fetchIndices} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          갱신
        </button>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && <div style={styles.newsEmpty}>조회 중…</div>}

      {data && (
        <div style={styles.posGrid}>
          {data.indices.map((idx) => (
            <div key={idx.symbol}>
              <div style={styles.posLabel}>{idx.label}</div>
              {idx.error ? (
                <div style={{ ...styles.pmMetaSub, color: "#E2604F" }}>조회 실패: {idx.error}</div>
              ) : (
                <>
                  <div style={styles.posValue}>
                    {idx.price != null ? idx.price.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "-"}
                  </div>
                  <div
                    style={{
                      ...styles.posSub,
                      color: idx.changePct == null ? "#8B948E" : idx.changePct >= 0 ? "#6FCB9F" : "#E2604F",
                    }}
                  >
                    {idx.changePct != null
                      ? `${idx.changePct >= 0 ? "+" : ""}${idx.changePct.toFixed(2)}% (전일 대비)`
                      : "-"}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ ...styles.posNote, marginTop: 10 }}>
        각 거래소 운영시간에만 갱신됩니다 (코스피: 한국 장 시간, 나스닥: 미국 장 시간). 장 마감 후엔 마지막
        종가가 그대로 유지됩니다. 데이터 출처: Yahoo Finance.
      </div>
    </section>
  );
}

function KrwVolumeProfilePanel({ coinId, futuresSymbol, label, accent }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPriceUsd, setCurrentPriceUsd] = useState(null);
  const [dataSource, setDataSource] = useState(null);

  const BIN_COUNT = 20;

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1) Binance 일봉으로 최대한 먼 과거까지 (한 번 호출로 최대 1000일 ≈ 2.7년)
      // 다른 카드들도 동시에 Binance를 호출해서 순간적으로 막히는 경우가 있어,
      // 약간의 지연 + 재시도를 넣어서 완화합니다.
      let candles = null;
      let binLastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
          } else {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          const binController = new AbortController();
          const binTimeout = setTimeout(() => binController.abort(), 10000);
          try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${futuresSymbol}&interval=1d&limit=1000`;
            const res = await fetch(url, { signal: binController.signal });
            if (!res.ok) throw new Error(`Binance 조회 실패 (${res.status})`);
            candles = await res.json();
            if (!candles.length) throw new Error("데이터가 없습니다");
          } finally {
            clearTimeout(binTimeout);
          }
          binLastErr = null;
          break;
        } catch (e) {
          binLastErr = e;
        }
      }

      // Binance에 없는 자산(FLR 등 선물/현물 미상장)이거나 계속 실패하면 CoinGecko 일봉으로 대체
      let points;
      let source = "binance";
      let latestPrice = null;
      if (candles) {
        points = candles.map((c) => ({
          price: (parseFloat(c[2]) + parseFloat(c[3]) + parseFloat(c[4])) / 3,
          volume: parseFloat(c[7]),
        }));
        latestPrice = parseFloat(candles[candles.length - 1][4]); // 마지막 캔들 종가
      } else {
        try {
          const cgController = new AbortController();
          const cgTimeout = setTimeout(() => cgController.abort(), 10000);
          let cgJson;
          try {
            const cgUrl = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=365&interval=daily`;
            const cgRes = await fetch(cgUrl, { signal: cgController.signal });
            if (!cgRes.ok) throw new Error(`CoinGecko 조회 실패 (${cgRes.status})`);
            cgJson = await cgRes.json();
          } finally {
            clearTimeout(cgTimeout);
          }
          const cgPrices = cgJson.prices || [];
          const cgVolumes = cgJson.total_volumes || [];
          if (cgPrices.length === 0) throw new Error("데이터가 없습니다");
          const n = Math.min(cgPrices.length, cgVolumes.length);
          points = [];
          for (let i = 0; i < n; i++) {
            points.push({ price: cgPrices[i][1], volume: cgVolumes[i][1] || 0 });
          }
          latestPrice = cgPrices[cgPrices.length - 1][1];
          source = "coingecko";
        } catch (e2) {
          throw new Error(
            `[Binance 조회 단계] ${binLastErr?.message || "실패"} → [CoinGecko 대체도 실패] ${e2.message}`
          );
        }
      }
      setDataSource(source);
      setCurrentPriceUsd(latestPrice);

      const priceValues = points.map((p) => p.price);
      const minPrice = Math.min(...priceValues);
      const maxPrice = Math.max(...priceValues);
      const binSize = (maxPrice - minPrice) / BIN_COUNT || 1;

      const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
        low: minPrice + i * binSize,
        high: minPrice + (i + 1) * binSize,
        volume: 0,
      }));

      points.forEach(({ price, volume }) => {
        let idx = Math.floor((price - minPrice) / binSize);
        if (idx >= BIN_COUNT) idx = BIN_COUNT - 1;
        if (idx < 0) idx = 0;
        bins[idx].volume += volume;
      });

      const maxVol = Math.max(...bins.map((b) => b.volume));
      const pocIdx = bins.findIndex((b) => b.volume === maxVol);
      const pocLow = bins[pocIdx]?.low;
      const pocHigh = bins[pocIdx]?.high;

      setProfile({ bins: bins.reverse(), maxVol, pocLow, pocHigh, minPrice, maxPrice });
    } catch (e) {
      setError(e.message || "매물대 데이터를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [coinId, futuresSymbol]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // 매물대(자동 범위) 기반 SOPR 근사치
  const soprMetrics = useMemo(() => {
    if (!profile || currentPriceUsd == null) return null;
    let weightedSum = 0;
    let totalVol = 0;
    let profitVol = 0;
    profile.bins.forEach((b) => {
      const mid = (b.low + b.high) / 2;
      weightedSum += mid * b.volume;
      totalVol += b.volume;
      if (mid < currentPriceUsd) profitVol += b.volume;
    });
    if (totalVol === 0) return null;
    const realizedPriceApprox = weightedSum / totalVol;
    const soprApprox = currentPriceUsd / realizedPriceApprox;
    const profitSupplyPct = (profitVol / totalVol) * 100;
    return { realizedPriceApprox, soprApprox, profitSupplyPct };
  }, [profile, currentPriceUsd]);

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>
          {label} 매물대 (자동 범위{dataSource === "coingecko" ? ", 최대 365일" : ", 최대 1000일"})
          {dataSource && (
            <span style={styles.newsTimestamp}>
              {" "}
              · {dataSource === "binance" ? "Binance 일봉" : "CoinGecko 일봉(대체)"}
            </span>
          )}
        </div>
        <button onClick={fetchProfile} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          갱신
        </button>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {loading && !profile && <div style={styles.newsEmpty}>매물대 계산 중…</div>}

      {soprMetrics && (
        <div style={styles.posGrid}>
          <div>
            <div style={styles.posLabel}>근사 SOPR (최대 1000일)</div>
            <div
              style={{
                ...styles.posValue,
                color: soprMetrics.soprApprox >= 1 ? "#6FCB9F" : "#E2604F",
              }}
            >
              {soprMetrics.soprApprox.toFixed(3)}
            </div>
            <div style={styles.posSub}>
              {soprMetrics.soprApprox >= 1 ? "평균적으로 수익권" : "평균적으로 손실권"}
            </div>
          </div>
          <div>
            <div style={styles.posLabel}>근사 실현가격</div>
            <div style={styles.posValue}>{fmtPrice(soprMetrics.realizedPriceApprox)}</div>
            <div style={styles.posSub}>조회 기간 데이터 범위 가중평균</div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={styles.posLabel}>수익권 물량 비율(근사)</div>
            <div style={styles.splitBar}>
              <div style={{ ...styles.splitBarLong, width: `${soprMetrics.profitSupplyPct.toFixed(1)}%` }} />
            </div>
            <div style={styles.posSplitRow}>
              <span style={{ color: "#6FCB9F" }}>수익권 {soprMetrics.profitSupplyPct.toFixed(1)}%</span>
              <span style={{ color: "#E2604F" }}>
                손실권 {(100 - soprMetrics.profitSupplyPct).toFixed(1)}%
              </span>
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1", ...styles.posNote }}>
            조회된 과거 데이터 범위 안의 거래만으로 계산한 근사치입니다. Binance 상장 이전 거래는 포함되지
            않습니다.
          </div>
        </div>
      )}

      {profile && (
        <>
          {currentPriceUsd != null && (
            <div style={{ ...styles.newsTimestamp, marginBottom: 8, marginTop: soprMetrics ? 14 : 0 }}>
              현재가 {fmtPrice(currentPriceUsd)}
            </div>
          )}
          <div style={styles.vpList}>
            {profile.bins.map((bin, i) => {
              const isPoc = bin.low === profile.pocLow;
              const isCurrent = currentPriceUsd != null && currentPriceUsd >= bin.low && currentPriceUsd < bin.high;
              const widthPct = profile.maxVol > 0 ? (bin.volume / profile.maxVol) * 100 : 0;
              return (
                <div key={i} style={styles.vpRow}>
                  <span style={styles.vpPriceLabel}>{fmtPrice((bin.low + bin.high) / 2)}</span>
                  <div style={styles.vpBarTrack}>
                    <div
                      style={{
                        ...styles.vpBarFill,
                        width: `${Math.max(widthPct, bin.volume > 0 ? 2 : 0)}%`,
                        background: isPoc ? "#E8A33D" : isCurrent ? accent : "#5B9BD5",
                      }}
                    />
                  </div>
                  {isCurrent && <span style={styles.vpCurrentTag}>현재가</span>}
                  {isPoc && !isCurrent && <span style={{ ...styles.vpCurrentTag, color: "#E8A33D" }}>POC</span>}
                </div>
              );
            })}
          </div>
          <div style={{ ...styles.posNote, marginTop: 10 }}>
            Binance 상장 이후 최대 약 1,000일(일봉 기준)치 거래대금을, 실제 가격이 오갔던 구간(
            {fmtPrice(profile.minPrice)}~{fmtPrice(profile.maxPrice)})으로 20개 칸에 나눈 매물대입니다.
            환율 변환 없이 달러(USD) 기준 그대로입니다.
          </div>
        </>
      )}
    </section>
  );
}

function VolumeProfilePanel({ coinId, futuresSymbol, accent, currentPrice }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null); // "binance" | "coingecko"

  // Binance 공개 API로 15분봉 90일치를 페이지네이션해서 가져옴 (분당 요청 제한 안에서 순차 호출)
  const fetchBinanceKlines = useCallback(async (symbol) => {
    const intervalMs = 15 * 60 * 1000;
    const totalCandles = 90 * 24 * 4; // 90일 * 하루 96개(15분 단위)
    let candles = [];
    let endTime = Date.now();

    while (candles.length < totalCandles) {
      const limit = Math.min(1000, totalCandles - candles.length);
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&endTime=${endTime}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance 조회 실패 (${res.status})`);
      const data = await res.json();
      if (!data.length) break;
      candles = data.concat(candles);
      endTime = data[0][0] - intervalMs;
      if (data.length < limit) break;
    }
    if (candles.length === 0) throw new Error("Binance 데이터가 없습니다");
    // [openTime, open, high, low, close, volume, closeTime, quoteVolume, ...]
    return candles.map((c) => ({
      price: (parseFloat(c[2]) + parseFloat(c[3]) + parseFloat(c[4])) / 3, // 고가+저가+종가 평균(대표가)
      volume: parseFloat(c[7]), // 달러(USDT) 환산 거래대금
    }));
  }, []);

  const fetchCoinGeckoDaily = useCallback(async () => {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=90&interval=daily`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko 조회 실패 (${res.status})`);
    const json = await res.json();
    const prices = json.prices || [];
    const volumes = json.total_volumes || [];
    if (prices.length === 0) throw new Error("데이터가 부족합니다");
    const n = Math.min(prices.length, volumes.length);
    const points = [];
    for (let i = 0; i < n; i++) {
      points.push({ price: prices[i][1], volume: volumes[i][1] || 0 });
    }
    return points;
  }, [coinId]);

  const buildProfile = (points) => {
    const priceValues = points.map((p) => p.price);
    const minPrice = Math.min(...priceValues);
    const maxPrice = Math.max(...priceValues);
    const binCount = 18;
    const binSize = (maxPrice - minPrice) / binCount || 1;

    const bins = Array.from({ length: binCount }, (_, i) => ({
      low: minPrice + i * binSize,
      high: minPrice + (i + 1) * binSize,
      volume: 0,
    }));

    points.forEach(({ price, volume }) => {
      let idx = Math.floor((price - minPrice) / binSize);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) idx = 0;
      bins[idx].volume += volume;
    });

    const maxVol = Math.max(...bins.map((b) => b.volume));
    const pocIdx = bins.findIndex((b) => b.volume === maxVol);
    const pocLow = bins[pocIdx]?.low;
    const pocHigh = bins[pocIdx]?.high;

    return { bins: bins.reverse(), maxVol, pocLow, pocHigh };
  };

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let points;
      try {
        points = await fetchBinanceKlines(futuresSymbol);
        setSource("binance");
      } catch {
        // Binance에 없는 종목(선물 미상장 등)이면 CoinGecko 일봉으로 자동 대체
        points = await fetchCoinGeckoDaily();
        setSource("coingecko");
      }
      setProfile(buildProfile(points));
    } catch (e) {
      setError(e.message || "매물대 데이터를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [futuresSymbol, fetchBinanceKlines, fetchCoinGeckoDaily]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // 매물대(bins)는 그대로 두고, 현재가만 바뀌어도 여기서 즉시 재계산 (Binance 재조회 없음)
  const soprMetrics = useMemo(() => {
    if (!profile || currentPrice == null) return null;
    let weightedSum = 0;
    let totalVol = 0;
    let profitVol = 0;
    profile.bins.forEach((b) => {
      const mid = (b.low + b.high) / 2;
      weightedSum += mid * b.volume;
      totalVol += b.volume;
      if (mid < currentPrice) profitVol += b.volume;
    });
    if (totalVol === 0) return null;
    const realizedPriceApprox = weightedSum / totalVol;
    const soprApprox = currentPrice / realizedPriceApprox;
    const profitSupplyPct = (profitVol / totalVol) * 100;
    return { realizedPriceApprox, soprApprox, profitSupplyPct };
  }, [profile, currentPrice]);

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>
          매물대 (최근 90일 거래량 분포)
          {source && (
            <span style={styles.newsTimestamp}>
              {" "}
              {source === "binance" ? "· Binance 15분봉" : "· CoinGecko 일봉(대체)"}
            </span>
          )}
        </div>
        <button onClick={fetchProfile} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          갱신
        </button>
      </div>

      {error && (
        <div style={{ ...styles.errorBox, marginBottom: 0 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {loading && !profile && <div style={styles.newsEmpty}>매물대 계산 중…</div>}

      {soprMetrics && (
        <div style={styles.posGrid}>
          <div>
            <div style={styles.posLabel}>근사 SOPR (실현가 대비)</div>
            <div
              style={{
                ...styles.posValue,
                color: soprMetrics.soprApprox >= 1 ? "#6FCB9F" : "#E2604F",
              }}
            >
              {soprMetrics.soprApprox.toFixed(3)}
            </div>
            <div style={styles.posSub}>
              {soprMetrics.soprApprox >= 1 ? "평균적으로 수익권" : "평균적으로 손실권"}
            </div>
          </div>
          <div>
            <div style={styles.posLabel}>근사 실현가격</div>
            <div style={styles.posValue}>{fmtPrice(soprMetrics.realizedPriceApprox)}</div>
            <div style={styles.posSub}>매물대 거래대금 가중평균</div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={styles.posLabel}>수익권 물량 비율(근사)</div>
            <div style={styles.splitBar}>
              <div style={{ ...styles.splitBarLong, width: `${soprMetrics.profitSupplyPct.toFixed(1)}%` }} />
            </div>
            <div style={styles.posSplitRow}>
              <span style={{ color: "#6FCB9F" }}>수익권 {soprMetrics.profitSupplyPct.toFixed(1)}%</span>
              <span style={{ color: "#E2604F" }}>손실권 {(100 - soprMetrics.profitSupplyPct).toFixed(1)}%</span>
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1", ...styles.posNote }}>
            이건 실제 온체인 SOPR(개별 코인 이동 시점 손익)이 아니라, 최근 90일 매물대(거래대금 분포)를
            코스트베이시스로 간주해 근사한 지표입니다. XRP는 계정 기반 원장이라 진짜 SOPR 계산에 필요한
            개별 코인 이동 이력 추적이 원천적으로 불가능하고, Glassnode 등의 유료 서비스가 쓰는 방법론과도
            다릅니다 — 방향성 참고용으로만 봐주세요.
          </div>
        </div>
      )}

      {profile && (
        <>
          <div style={{ ...styles.vpList, marginTop: 14 }}>
            {profile.bins.map((bin, i) => {
              const isPoc = bin.low === profile.pocLow;
              const isCurrent = currentPrice != null && currentPrice >= bin.low && currentPrice < bin.high;
              const widthPct = profile.maxVol > 0 ? (bin.volume / profile.maxVol) * 100 : 0;
              return (
                <div key={i} style={styles.vpRow}>
                  <span style={styles.vpPriceLabel}>{fmtPrice((bin.low + bin.high) / 2)}</span>
                  <div style={styles.vpBarTrack}>
                    <div
                      style={{
                        ...styles.vpBarFill,
                        width: `${Math.max(widthPct, 2)}%`,
                        background: isPoc ? "#E8A33D" : isCurrent ? accent : "#5B9BD5",
                      }}
                    />
                  </div>
                  {isCurrent && <span style={styles.vpCurrentTag}>현재가</span>}
                  {isPoc && !isCurrent && <span style={{ ...styles.vpCurrentTag, color: "#E8A33D" }}>POC</span>}
                </div>
              );
            })}
          </div>
          <div style={{ ...styles.posNote, marginTop: 10 }}>
            막대가 길수록 그 가격대에서 최근 90일간 거래량이 많이 몰렸다는 뜻입니다. 주황색(POC)은 가장
            거래가 몰린 가격대로, 심리적 지지/저항으로 작동하는 경우가 많습니다. 다만 온체인 실제 매수단가
            추적은 아니고, 가격·거래량 데이터로 근사한 참고 지표입니다.
          </div>
        </>
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

function HoldScenarioNarrativePanel() {
  const chartData = HOLD_SCENARIO.points.map((p) => ({
    label: p.label,
    pct: p.pct,
    price: HOLD_SCENARIO.baseline * (1 + p.pct / 100),
  }));

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>참고 시나리오: {HOLD_SCENARIO.title}</div>
      </div>

      <div style={{ ...styles.posNote, marginBottom: 4, color: "#5B9BD5" }}>
        ※ 이 시나리오는 실제 검증 대상이 아니라, 가정을 바탕으로 그려본 가상 곡선입니다.
      </div>

      {HOLD_SCENARIO.narrative.map((p, i) => (
        <p key={i} style={styles.holdNarrativeP}>
          {p}
        </p>
      ))}

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#232B27" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#5B6660"
            tick={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9 }}
            axisLine={{ stroke: "#232B27" }}
            tickLine={false}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={50}
          />
          <YAxis
            stroke="#5B6660"
            tick={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10 }}
            domain={["auto", "auto"]}
            tickFormatter={(v) => `$${v.toFixed(2)}`}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || !payload.length) return null;
              const d = payload[0].payload;
              return (
                <div style={styles.tooltip}>
                  <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#8B948E" }}>
                    {label}
                  </div>
                  <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12, color: "#5B9BD5" }}>
                    ${d.price.toFixed(3)} ({d.pct >= 0 ? "+" : ""}
                    {d.pct}%)
                  </div>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="price" stroke="#5B9BD5" strokeWidth={2} dot={{ r: 3, fill: "#5B9BD5" }} />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ ...styles.posNote, marginTop: 10 }}>
        기준가 ${HOLD_SCENARIO.baseline} (2026-09-03 XRP 기준). 이 곡선은 가정이 전부 그대로 실현된다는
        전제의 참고용 그림이며, 위 "시나리오 대결"처럼 실제 가격과 자동 비교·검증되지는 않습니다.
      </div>
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

  // ---- 시간대 가중 자기강화 점수 (예측 정확도 기록과 같은 룰) ----
  // "예측한 시점" = SCENARIO_BASELINE_DATE, 거기서부터 각 체크포인트까지의 경과시간으로 가중치를 매김.
  // 코인별로 방향(상승/하락) 적중 여부를 판정해서, 적중이면 그 시간대 가중치, 틀리면 -7점.
  const baselineMs = new Date(SCENARIO_BASELINE_DATE + "T00:00:00Z").getTime();
  const scenarioScores = useMemo(() => {
    const scores = {};
    Object.keys(SCENARIOS).forEach((sKey) => {
      let total = 0;
      let hit = 0;
      let miss = 0;
      passedCheckpoints.forEach((cpDate) => {
        const horizonHours = Math.max(
          0.01,
          (new Date(cpDate + "T00:00:00Z").getTime() - baselineMs) / (60 * 60 * 1000)
        );
        const weight = getHorizonWeight(horizonHours);
        Object.entries(SCENARIO_COINS).forEach(([coinKey, coinMeta]) => {
          const actual = actuals[`${coinKey}:${cpDate}`];
          if (actual == null) return;
          const predictedPct = SCENARIOS[sKey].checkpoints[cpDate][coinKey];
          const actualPct = ((actual - coinMeta.baseline) / coinMeta.baseline) * 100;
          if (Math.abs(predictedPct) < 1e-9 || Math.abs(actualPct) < 1e-9) return; // 횡보는 판정 제외
          const isHit = Math.sign(predictedPct) === Math.sign(actualPct);
          total += isHit ? weight : -7;
          if (isHit) hit += 1;
          else miss += 1;
        });
      });
      scores[sKey] = { total, hit, miss };
    });
    return scores;
  }, [passedCheckpoints, actuals, baselineMs]);

  // ---- 자기강화 블렌드 예측 ----
  // 지금까지 지난 체크포인트들의 평균 오차로 시나리오별 가중치를 매기고(오차가 작을수록 가중치 큼),
  // 아직 안 지난 체크포인트는 이 가중치로 두 시나리오를 섞은 블렌드 예측가를 보여줌.
  // 체크포인트가 실측될 때마다 가중치가 갱신되므로, 더 잘 맞춰온 시나리오 쪽으로 예측이 스스로 기움.
  const scenarioWeights = useMemo(() => {
    const avgErrByScenario = {};
    Object.keys(SCENARIOS).forEach((key) => {
      const errs = passedCheckpoints
        .map((cp) => computeErrorForCheckpoint(key, cp))
        .filter((e) => e != null);
      avgErrByScenario[key] = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
    });

    const validEntries = Object.entries(avgErrByScenario).filter(([, e]) => e != null);
    if (validEntries.length === 0) {
      // 아직 검증된 데이터가 없으면 균등 가중치
      const equal = 1 / Object.keys(SCENARIOS).length;
      return Object.fromEntries(Object.keys(SCENARIOS).map((k) => [k, equal]));
    }

    // 가중치 ∝ 1/오차 (오차 0에 가까운 경우를 대비해 아주 작은 값 더함)
    const inv = {};
    let sum = 0;
    Object.keys(SCENARIOS).forEach((key) => {
      const e = avgErrByScenario[key];
      const w = e != null ? 1 / (e + 0.01) : 0;
      inv[key] = w;
      sum += w;
    });
    const weights = {};
    Object.keys(SCENARIOS).forEach((key) => {
      weights[key] = sum > 0 ? inv[key] / sum : 1 / Object.keys(SCENARIOS).length;
    });
    return weights;
  }, [passedCheckpoints, actuals]);

  const futureCheckpoints = checkpointDates.filter((d) => !passedCheckpoints.includes(d));

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>시나리오 대결: 김광석 vs 컨센서스</div>
        <button onClick={evaluate} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          평가
        </button>
      </div>

      <div style={{ ...styles.newsEmpty, marginBottom: 10 }}>
        {Object.entries(SCENARIOS).map(([key, s], i) => (
          <span key={key}>
            {i > 0 && " · "}
            <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>
          </span>
        ))}
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
              {Object.entries(SCENARIOS).map(([key, s]) => (
                <th key={key} style={{ ...styles.th, textAlign: "right", color: s.color }}>
                  {s.label.split(" ")[0]} 오차
                </th>
              ))}
              <th style={{ ...styles.th, textAlign: "right" }}>우세</th>
            </tr>
          </thead>
          <tbody>
            {passedCheckpoints.map((cpDate, i) => {
              const errors = Object.keys(SCENARIOS).map((key) => ({
                key,
                err: computeErrorForCheckpoint(key, cpDate),
              }));
              const valid = errors.filter((e) => e.err != null);
              const winnerEntry =
                valid.length === 0 ? null : valid.reduce((a, b) => (a.err < b.err ? a : b));
              return (
                <tr key={cpDate} style={i % 2 === 1 ? styles.trAlt : undefined}>
                  <td style={styles.td}>{cpDate}</td>
                  {errors.map(({ key, err }) => (
                    <td key={key} style={{ ...styles.td, textAlign: "right" }}>
                      {err != null ? `${err.toFixed(1)}%` : "대기"}
                    </td>
                  ))}
                  <td
                    style={{
                      ...styles.td,
                      textAlign: "right",
                      color: winnerEntry ? SCENARIOS[winnerEntry.key].color : "#8B948E",
                      fontWeight: 600,
                    }}
                  >
                    {winnerEntry ? SCENARIOS[winnerEntry.key].label.split(" ")[0] : "-"}
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

      {passedCheckpoints.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #232B27" }}>
          <div style={styles.tableTitle}>시간대 가중 점수 (예측 정확도 기록과 같은 룰)</div>
          <div style={styles.posGrid}>
            {Object.entries(SCENARIOS).map(([key, s]) => (
              <div key={key}>
                <div style={{ ...styles.posLabel, color: s.color }}>{s.label.split(" ")[0]}</div>
                <div
                  style={{
                    ...styles.posValue,
                    color: scenarioScores[key].total >= 0 ? "#6FCB9F" : "#E2604F",
                  }}
                >
                  {scenarioScores[key].total >= 0 ? "+" : ""}
                  {scenarioScores[key].total}점
                </div>
                <div style={styles.posSub}>
                  적중 {scenarioScores[key].hit}건 / 미적중 {scenarioScores[key].miss}건
                </div>
              </div>
            ))}
          </div>
          <div style={{ ...styles.posNote, marginTop: 8 }}>
            {SCENARIO_BASELINE_DATE}(예측 시점) 기준 각 체크포인트까지의 경과시간에 시간대 가중치(1h:1점 ·
            2h:2점 · 3h:3점, 이후 2배가 될 때마다 +1점, 최대 30점)를 적용합니다. 코인·체크포인트별로
            방향(상승/하락) 적중 시 가중치만큼 +점, 틀리면 -7점입니다.
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #232B27" }}>
        <div style={styles.tableTitle}>자기강화 블렌드 예측</div>
        <div style={styles.posNote}>
          지금까지 적중률(오차 역수)로 가중치를 매김:{" "}
          {Object.entries(SCENARIOS).map(([key, s], i) => (
            <span key={key}>
              {i > 0 && " / "}
              <span style={{ color: s.color, fontWeight: 600 }}>
                {s.label.split(" ")[0]} {(scenarioWeights[key] * 100).toFixed(0)}%
              </span>
            </span>
          ))}
        </div>

        {futureCheckpoints.length === 0 ? (
          <div style={{ ...styles.newsEmpty, marginTop: 8 }}>모든 체크포인트가 이미 지났습니다.</div>
        ) : (
          <table style={{ ...styles.table, marginTop: 10 }}>
            <thead>
              <tr>
                <th style={styles.th}>체크포인트</th>
                {Object.keys(SCENARIO_COINS).map((coinKey) => (
                  <th key={coinKey} style={{ ...styles.th, textAlign: "right" }}>
                    {coinKey}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {futureCheckpoints.map((cpDate, i) => (
                <tr key={cpDate} style={i % 2 === 1 ? styles.trAlt : undefined}>
                  <td style={styles.td}>{cpDate}</td>
                  {Object.entries(SCENARIO_COINS).map(([coinKey, coinMeta]) => {
                    let blendedPct = 0;
                    Object.keys(SCENARIOS).forEach((sKey) => {
                      const pct = SCENARIOS[sKey].checkpoints[cpDate]?.[coinKey] ?? 0;
                      blendedPct += pct * scenarioWeights[sKey];
                    });
                    const blendedPrice = coinMeta.baseline * (1 + blendedPct / 100);
                    return (
                      <td key={coinKey} style={{ ...styles.td, textAlign: "right" }}>
                        {fmtPrice(blendedPrice)}
                        <span
                          style={{
                            color: blendedPct >= 0 ? "#6FCB9F" : "#E2604F",
                            fontSize: 10,
                            marginLeft: 4,
                          }}
                        >
                          ({blendedPct >= 0 ? "+" : ""}
                          {blendedPct.toFixed(1)}%)
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ ...styles.posNote, marginTop: 8 }}>
          체크포인트가 하나씩 실측될 때마다 가중치가 자동으로 갱신되어, 지금까지 더 잘 맞춰온 시나리오 쪽으로
          다음 예측이 스스로 기울어집니다. 검증 데이터가 아직 없을 땐 두 시나리오를 50:50으로 섞어서
          보여줍니다.
        </div>
      </div>
    </section>
  );
}

function CheckpointSummaryPanel() {
  const [actuals, setActuals] = useState({});
  const [loading, setLoading] = useState(false);

  const checkpointDates = Object.keys(SCENARIOS.kim.checkpoints).sort();
  const today = new Date();
  const passedCheckpoints = checkpointDates.filter((d) => new Date(d + "T23:59:59") <= today);
  const baselineMs = new Date(SCENARIO_BASELINE_DATE + "T00:00:00Z").getTime();

  const fetchActuals = async () => {
    setLoading(true);
    try {
      const next = {};
      for (const coinKey of Object.keys(SCENARIO_COINS)) {
        if (supabase) {
          const { data } = await supabase.from("scenario_actuals").select("*").eq("coin", coinKey);
          (data || []).forEach((row) => {
            next[`${coinKey}:${row.checkpoint_date}`] = Number(row.actual_price);
          });
        }
      }
      setActuals(next);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActuals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (passedCheckpoints.length === 0) return null;

  const rows = [];
  passedCheckpoints.forEach((cpDate) => {
    const horizonHours = Math.max(
      0.01,
      (new Date(cpDate + "T00:00:00Z").getTime() - baselineMs) / (60 * 60 * 1000)
    );
    const weight = getHorizonWeight(horizonHours);
    Object.entries(SCENARIO_COINS).forEach(([coinKey, coinMeta]) => {
      const actual = actuals[`${coinKey}:${cpDate}`];
      if (actual == null) return;
      const actualPct = ((actual - coinMeta.baseline) / coinMeta.baseline) * 100;
      const perScenario = Object.entries(SCENARIOS).map(([sKey, s]) => {
        const predictedPct = s.checkpoints[cpDate][coinKey];
        const target = coinMeta.baseline * (1 + predictedPct / 100);
        const errPct = (Math.abs(actual - target) / target) * 100;
        const isHit =
          Math.abs(predictedPct) >= 1e-9 &&
          Math.abs(actualPct) >= 1e-9 &&
          Math.sign(predictedPct) === Math.sign(actualPct);
        const points = Math.abs(predictedPct) < 1e-9 || Math.abs(actualPct) < 1e-9 ? null : isHit ? weight : -7;
        return { key: sKey, label: s.label.split(" ")[0], color: s.color, target, errPct, isHit, points };
      });
      rows.push({ cpDate, coinKey, actual, actualPct, weight, perScenario });
    });
  });

  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>체크포인트 결과 요약</div>
        <button onClick={fetchActuals} style={styles.newsBtn} disabled={loading}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          갱신
        </button>
      </div>

      <div style={styles.posNote}>
        지난 체크포인트마다 어느 시나리오가 더 맞았는지 코인별로 정리했습니다. 다음 시나리오를 조정하고
        싶으실 때, 이 내용을 그대로 캡처하거나 복사해서 Claude에게 보여주시면 바로 상의할 수 있어요.
      </div>

      {passedCheckpoints.map((cpDate) => {
        const cpRows = rows.filter((r) => r.cpDate === cpDate);
        if (cpRows.length === 0) return null;
        return (
          <div key={cpDate} style={{ marginTop: 14 }}>
            <div style={{ ...styles.posLabel, color: "#EDEAE3", fontSize: 12, marginBottom: 6 }}>
              {cpDate} (가중치 {cpRows[0].weight}점)
            </div>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>코인</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>실제 변화율</th>
                  {Object.entries(SCENARIOS).map(([key, s]) => (
                    <th key={key} style={{ ...styles.th, textAlign: "right", color: s.color }}>
                      {s.label.split(" ")[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cpRows.map((r, i) => (
                  <tr key={r.coinKey} style={i % 2 === 1 ? styles.trAlt : undefined}>
                    <td style={styles.td}>{r.coinKey}</td>
                    <td
                      style={{
                        ...styles.td,
                        textAlign: "right",
                        color: r.actualPct >= 0 ? "#6FCB9F" : "#E2604F",
                      }}
                    >
                      {r.actualPct >= 0 ? "+" : ""}
                      {r.actualPct.toFixed(1)}%
                    </td>
                    {r.perScenario.map((s) => (
                      <td key={s.key} style={{ ...styles.td, textAlign: "right" }}>
                        {s.points == null ? (
                          <span style={{ color: "#5B6660" }}>횡보</span>
                        ) : (
                          <span style={{ color: s.isHit ? "#6FCB9F" : "#E2604F" }}>
                            {s.isHit ? "적중" : "빗나감"} ({s.points >= 0 ? "+" : ""}
                            {s.points})
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
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

function GarlinghouseTimelinePanel() {
  return (
    <section style={styles.newsCard}>
      <div style={styles.newsHeader}>
        <div style={styles.tableTitle}>갈링하우스(Ripple CEO) 발언 타임라인</div>
      </div>
      <div style={styles.timelineList}>
        {GARLINGHOUSE_TIMELINE.map((item, i) => (
          <div key={i} style={styles.timelineRow}>
            <div style={styles.timelineDotCol}>
              <div style={styles.timelineDot} />
              {i < GARLINGHOUSE_TIMELINE.length - 1 && <div style={styles.timelineLine} />}
            </div>
            <div style={styles.timelineContent}>
              <div style={styles.timelineDate}>
                {item.date} <span style={styles.timelinePeriod}>· {item.period}</span>
              </div>
              <div style={styles.timelineText}>{item.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ ...styles.posNote, marginTop: 10 }}>
        공개된 인터뷰·SNS·보도자료를 바탕으로 정리한 고정 데이터입니다 (실시간 갱신 아님). 원문 그대로의
        인용이 아니라 요약이며, 최신 발언은 별도로 추가해드릴 수 있습니다.
      </div>
    </section>
  );
}

const PREDICTION_MARKET_QUERY = {
  XRP: "XRP",
  FLR: "Flare",
};

function PredictionMarketPanel({ assetKey }) {
  const [markets, setMarkets] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  const queryTerm = PREDICTION_MARKET_QUERY[assetKey] || assetKey;

  const fetchMarkets = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/polymarket?q=${encodeURIComponent(queryTerm)}`;
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
        <div style={styles.tableTitle}>예측시장 전망 (Polymarket) · {queryTerm}</div>
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
          버튼을 눌러 Polymarket에서 실제 베팅이 걸린 {queryTerm} 관련 예측시장을 가져옵니다. 확률은
          애널리스트 의견이 아니라 실제 돈을 건 트레이더들의 집단 예측입니다.
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/news?asset=${encodeURIComponent(assetKey)}`, {
        signal: controller.signal,
      });
      const parsed = await response.json();
      if (!response.ok || parsed.error) throw new Error(parsed.error || `뉴스 조회에 실패했습니다 (${response.status})`);
      setNews(parsed);
      setFetchedAt(new Date());
    } catch (e) {
      if (e.name === "AbortError") {
        setError("응답이 너무 오래 걸려서 중단했습니다. 다시 시도해주세요.");
      } else {
        setError(e.message || "뉴스를 불러오지 못했습니다");
      }
    } finally {
      clearTimeout(timeoutId);
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
        <div style={styles.gaugeRow}>
          <div style={{ ...styles.gaugeScore, color: scoreColor(news.score) }}>{news.score}</div>
          {fetchedAt && (
            <span style={styles.newsTimestamp}>
              {fetchedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 조회
            </span>
          )}
        </div>
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
  vpList: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  vpRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 16,
  },
  vpPriceLabel: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 9,
    color: "#5B6660",
    width: 64,
    flexShrink: 0,
    textAlign: "right",
  },
  vpBarTrack: {
    flex: 1,
    height: 10,
    background: "#0E1210",
    borderRadius: 2,
    overflow: "hidden",
  },
  vpBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  vpCurrentTag: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 8,
    color: "#EDEAE3",
    flexShrink: 0,
  },
  holdNarrativeP: {
    fontSize: 13,
    lineHeight: 1.7,
    color: "#C7CCC8",
    margin: "0 0 10px 0",
  },
  timelineList: {
    display: "flex",
    flexDirection: "column",
  },
  timelineRow: {
    display: "flex",
    gap: 10,
  },
  timelineDotCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: 10,
    flexShrink: 0,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#5B9BD5",
    marginTop: 4,
    flexShrink: 0,
  },
  timelineLine: {
    width: 1,
    flex: 1,
    background: "#232B27",
    marginTop: 2,
  },
  timelineContent: {
    paddingBottom: 14,
  },
  timelineDate: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    color: "#5B9BD5",
    marginBottom: 4,
  },
  timelinePeriod: {
    color: "#5B6660",
  },
  timelineText: {
    fontSize: 12.5,
    lineHeight: 1.6,
    color: "#C7CCC8",
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
