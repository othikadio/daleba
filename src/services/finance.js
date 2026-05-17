/**
 * DALEBA — Module Finance (Scaffolding Points 21-26, 28)
 * Flux financiers, analyse technique, paper trading, audit salon
 */

// ─── POINT 21 — FLUX FINANCIERS ───────────────────────────────────────────────

/**
 * Récupère les données boursières d'un symbole (Yahoo Finance, sans auth)
 */
async function getStockData(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 DALEBA/1.0' },
  });
  if (!res.ok) throw new Error(`Yahoo Finance [${res.status}]: ${symbol}`);
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`Pas de données pour ${symbol}`);

  const closes = result.indicators?.quote?.[0]?.close || [];
  const timestamps = result.timestamp || [];
  const meta = result.meta || {};

  return {
    symbol,
    currency: meta.currency,
    currentPrice: meta.regularMarketPrice,
    previousClose: meta.previousClose,
    change: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2),
    history: timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: closes[i],
    })).filter(h => h.close != null),
  };
}

/**
 * Récupère les données crypto (CoinGecko, free tier)
 */
async function getCryptoData(symbol) {
  const coinId = symbol.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko [${res.status}]: ${symbol}`);
  const data = await res.json();

  return {
    id: data.id,
    name: data.name,
    symbol: data.symbol?.toUpperCase(),
    currentPrice: data.market_data?.current_price?.usd,
    priceChange24h: data.market_data?.price_change_percentage_24h,
    marketCap: data.market_data?.market_cap?.usd,
    ath: data.market_data?.ath?.usd,
    atl: data.market_data?.atl?.usd,
  };
}

// ─── POINT 22 — ANALYSE TECHNIQUE ─────────────────────────────────────────────

function calculateSMA(prices, period) {
  const result = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

function calculateRSI(prices, period = 14) {
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map(c => Math.max(c, 0));
  const losses = changes.map(c => Math.max(-c, 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;

  const rsi = [];
  for (let i = period; i < prices.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(+(100 - 100 / (1 + rs)).toFixed(2));
  }
  return rsi;
}

function calculateMACD(prices, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  function ema(data, period) {
    const k = 2 / (period + 1);
    let emaVal = data[0];
    return data.map(v => (emaVal = v * k + emaVal * (1 - k)));
  }

  const emaShort = ema(prices, shortPeriod);
  const emaLong = ema(prices, longPeriod);
  const macdLine = emaShort.map((v, i) => +(v - emaLong[i]).toFixed(4));
  const signalLine = ema(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) => +(v - signalLine[i]).toFixed(4));

  return { macdLine, signalLine, histogram };
}

function calculateBollingerBands(prices, period = 20) {
  const result = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const middle = slice.reduce((a, b) => a + b) / period;
    const variance = slice.reduce((a, b) => a + (b - middle) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    result.push({
      upper: +(middle + 2 * std).toFixed(4),
      middle: +middle.toFixed(4),
      lower: +(middle - 2 * std).toFixed(4),
    });
  }
  return result;
}

// ─── POINT 23 — SENTIMENT MARCHÉ ──────────────────────────────────────────────

async function getMarketSentiment(query) {
  // Analyse basique via Fear & Greed Index (CNN) — endpoint public
  try {
    const url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
    const res = await fetch(url, { headers: { 'User-Agent': 'DALEBA/1.0' } });
    let fearGreed = null;
    if (res.ok) {
      const data = await res.json();
      fearGreed = data.fear_and_greed?.score;
    }

    const score = fearGreed ? (fearGreed - 50) / 50 : 0; // -1 to 1
    const sentiment = score > 0.2 ? 'bullish' : score < -0.2 ? 'bearish' : 'neutral';

    return {
      query,
      score: +score.toFixed(3),
      sentiment,
      fearGreedIndex: fearGreed,
      sources: ['CNN Fear & Greed Index'],
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return { query, score: 0, sentiment: 'neutral', error: err.message };
  }
}

// ─── POINT 24 — PAPER TRADING ─────────────────────────────────────────────────

const portfolios = new Map();

function createPortfolio(userId, initialCash = 10000) {
  if (portfolios.has(userId)) return portfolios.get(userId);
  const portfolio = {
    userId,
    cash: initialCash,
    initialCash,
    positions: {},
    trades: [],
    createdAt: new Date().toISOString(),
  };
  portfolios.set(userId, portfolio);
  return portfolio;
}

async function buyStock(userId, symbol, quantity) {
  const portfolio = portfolios.get(userId);
  if (!portfolio) throw new Error(`Portfolio inexistant pour ${userId}`);

  const data = await getStockData(symbol);
  const price = data.currentPrice;
  const total = price * quantity;

  if (portfolio.cash < total) throw new Error(`Fonds insuffisants: ${portfolio.cash.toFixed(2)}$ disponible`);

  portfolio.cash -= total;
  portfolio.positions[symbol] = portfolio.positions[symbol] || { quantity: 0, avgCost: 0 };
  const pos = portfolio.positions[symbol];
  const prevTotal = pos.quantity * pos.avgCost;
  pos.quantity += quantity;
  pos.avgCost = (prevTotal + total) / pos.quantity;

  const trade = { type: 'buy', symbol, quantity, price, total, timestamp: new Date().toISOString() };
  portfolio.trades.push(trade);

  return { success: true, trade, balance: portfolio.cash };
}

async function sellStock(userId, symbol, quantity) {
  const portfolio = portfolios.get(userId);
  if (!portfolio) throw new Error(`Portfolio inexistant pour ${userId}`);

  const pos = portfolio.positions[symbol];
  if (!pos || pos.quantity < quantity) throw new Error(`Position insuffisante: ${pos?.quantity || 0} ${symbol}`);

  const data = await getStockData(symbol);
  const price = data.currentPrice;
  const total = price * quantity;
  const pnl = (price - pos.avgCost) * quantity;

  pos.quantity -= quantity;
  if (pos.quantity === 0) delete portfolio.positions[symbol];
  portfolio.cash += total;

  const trade = { type: 'sell', symbol, quantity, price, total, pnl: +pnl.toFixed(2), timestamp: new Date().toISOString() };
  portfolio.trades.push(trade);

  return { success: true, trade, pnl: +pnl.toFixed(2), balance: portfolio.cash };
}

async function getPortfolio(userId) {
  const portfolio = portfolios.get(userId);
  if (!portfolio) return null;

  // Calcul P&L live
  let totalValue = portfolio.cash;
  const positions = [];

  for (const [symbol, pos] of Object.entries(portfolio.positions)) {
    try {
      const data = await getStockData(symbol);
      const currentValue = pos.quantity * data.currentPrice;
      const pnl = currentValue - pos.quantity * pos.avgCost;
      positions.push({
        symbol,
        quantity: pos.quantity,
        avgCost: +pos.avgCost.toFixed(2),
        currentPrice: data.currentPrice,
        currentValue: +currentValue.toFixed(2),
        pnl: +pnl.toFixed(2),
        pnlPct: +((pnl / (pos.quantity * pos.avgCost)) * 100).toFixed(2),
      });
      totalValue += currentValue;
    } catch {
      positions.push({ symbol, quantity: pos.quantity, avgCost: pos.avgCost, currentPrice: null, error: 'Prix indisponible' });
    }
  }

  return {
    userId,
    cash: +portfolio.cash.toFixed(2),
    initialCash: portfolio.initialCash,
    totalValue: +totalValue.toFixed(2),
    totalPnl: +(totalValue - portfolio.initialCash).toFixed(2),
    totalPnlPct: +((totalValue - portfolio.initialCash) / portfolio.initialCash * 100).toFixed(2),
    positions,
    tradesCount: portfolio.trades.length,
  };
}

// ─── POINT 28 — AUDIT FINANCIER KADIO COIFFURE ────────────────────────────────

async function getWeeklyFinancialReport(tenantId = 'kadio') {
  // Tente de collecter les données depuis les appointments et Stripe
  const report = {
    tenantId,
    period: {
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
    },
    revenue: { total: 0, byService: {}, currency: 'CAD' },
    appointments: { total: 0, completed: 0, cancelled: 0, noShow: 0, noShowRate: 0 },
    topServices: [],
    projection: { month: 0, method: 'weekly_average_x4' },
    generatedAt: new Date().toISOString(),
  };

  try {
    const { getAllAppointments } = require('./appointments');
    const appts = await getAllAppointments(tenantId).catch(() => []);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekAppts = appts.filter(a => new Date(a.created_at || a.date).getTime() >= weekAgo);

    report.appointments.total = weekAppts.length;
    report.appointments.completed = weekAppts.filter(a => a.status === 'completed').length;
    report.appointments.cancelled = weekAppts.filter(a => a.status === 'cancelled').length;
    report.appointments.noShow = weekAppts.filter(a => a.status === 'no_show').length;
    report.appointments.noShowRate = weekAppts.length
      ? +(report.appointments.noShow / weekAppts.length * 100).toFixed(1) : 0;

    for (const a of weekAppts.filter(a => a.status === 'completed')) {
      const price = parseFloat(a.price || a.amount || 0);
      const service = a.service || a.service_name || 'Autre';
      report.revenue.total += price;
      report.revenue.byService[service] = (report.revenue.byService[service] || 0) + price;
    }

    report.topServices = Object.entries(report.revenue.byService)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([service, revenue]) => ({ service, revenue: +revenue.toFixed(2) }));

    report.projection.month = +(report.revenue.total * 4).toFixed(2);
  } catch (err) {
    report.error = err.message;
  }

  return report;
}

module.exports = {
  // Flux
  getStockData,
  getCryptoData,
  // Analyse technique
  calculateRSI,
  calculateMACD,
  calculateSMA,
  calculateBollingerBands,
  // Sentiment
  getMarketSentiment,
  // Paper Trading
  portfolios,
  createPortfolio,
  buyStock,
  sellStock,
  getPortfolio,
  // Audit
  getWeeklyFinancialReport,
};
