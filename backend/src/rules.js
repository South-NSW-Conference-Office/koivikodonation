// The money rules, in one place: gift limits, the card-fee rule and where a month starts.
// The page has its own copy of the limits (config.js) and the fee rule (feeFor in app.js);
// test/rules.test.js fails if either copy drifts from this file.

// Gift limits per currency, in whole units. PLACEHOLDERS - confirm with Kyle/Kevin (PRD Q5).
export const CURRENCIES = {
  eur: { min: 2, max: 10000 },
  aud: { min: 3, max: 15000 },
  usd: { min: 2, max: 10000 },
};

// "Cover card fees" is a percentage of the gift, rounded to the nearest 0.05,
// with a 0.30 minimum. Values in cents.
export const FEE_STEP = 5;
export const FEE_MIN = 30;

// The fee in cents for a gift in cents. Whole numbers only (the percentage is
// turned into hundredths of a percent first), so a gift that lands exactly
// between two steps rounds the same way here and on the page.
export function feeCents(giftCents, percent) {
  const hundredths = Math.round((Number(percent) || 0) * 100);
  return Math.max(FEE_MIN, Math.round((giftCents * hundredths) / (FEE_STEP * 10000)) * FEE_STEP);
}

// Turns the European Central Bank's daily reference-rate file into "one unit of
// this currency is worth this many euros" for the currencies the page accepts.
// The file lists how much of each currency one euro buys, so each rate is flipped.
export function parseEcbRates(xml) {
  const perEuro = {};
  for (const [, code, rate] of String(xml).matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
    perEuro[code.toLowerCase()] = Number(rate);
  }
  const rates = { eur: 1 };
  for (const code of Object.keys(CURRENCIES)) {
    if (code === 'eur') continue;
    const value = perEuro[code];
    if (!Number.isFinite(value) || value <= 0) throw new Error(`No usable rate for ${code} in the ECB file`);
    rates[code] = Math.round(1e6 / value) / 1e6;
  }
  return rates;
}

// When the current calendar month began where the Foundation is, as a Unix time
// in seconds. "This month" on the counter follows Finnish time, not UTC.
export function monthStartSeconds(now = new Date(), timeZone = 'Europe/Helsinki') {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  // The clock time in that zone, written as if it were UTC.
  const wall = (ms) => {
    const p = Object.fromEntries(format.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  const nowMs = Math.floor(now.getTime() / 1000) * 1000;
  const local = new Date(wall(nowMs));
  const startWall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  let start = startWall - (wall(nowMs) - nowMs);
  start = startWall - (wall(start) - start); // the clocks may have changed since the 1st
  return start / 1000;
}
