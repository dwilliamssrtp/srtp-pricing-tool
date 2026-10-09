/* =====================================================================
   Quote engine — pure functions, mirroring the Endeco Profitability
   Review. No I/O: rows and settings in, computed groups and totals out.

   The arithmetic the workbook actually does, which is easy to get wrong:

     manufactured = supplied x (1 + scrap)
     unit price   = unit cost x (1 + markup)      [pipe lines only]
     extended     = unit price x SUPPLIED
     budget       = unit cost  x MANUFACTURED
     margin       = 1 - budget / extended

   Revenue is charged on supplied units but cost on manufactured units, so
   scrap deliberately eats into margin: a 100% markup reports as 47.5%,
   not 50%. That is the workbook's intent, not a rounding error.
   ===================================================================== */

import { labourDays } from "./parts.js?v=20261009-1339";

const n = v => (v === null || v === undefined || Number.isNaN(Number(v)) ? 0 : Number(v));

/* One line's money. `chargeOnSupplied` is what creates the scrap drag. */
export function lineTotals(line, scrapPct) {
  const supplied = n(line.supplied_units);
  const manufactured = line.manufactured_units != null
    ? n(line.manufactured_units)
    : (line.kind === "pipe" ? supplied * (1 + n(scrapPct)) : supplied);
  const price = line.unit_price == null ? null : n(line.unit_price);
  const cost  = line.unit_cost  == null ? null : n(line.unit_cost);
  const extended = price === null ? null : price * supplied;
  const budget   = cost  === null ? null : cost * manufactured;
  const margin   = (extended && extended !== 0 && budget !== null) ? 1 - budget / extended : null;
  return { ...line, supplied, manufactured, price, cost, extended, budget, margin };
}

/* A pipe size and its flange / splice / reel lines. */
export function groupTotals(lines, settings, labourStages) {
  const rows = lines.map(l => lineTotals(l, settings.scrapPct));
  const pipe = rows.find(r => r.kind === "pipe") || null;

  const extended = rows.reduce((s, r) => s + (r.extended ?? 0), 0);
  const budget   = rows.reduce((s, r) => s + (r.budget   ?? 0), 0);

  let labour = null;
  if (pipe && labourStages && labourStages.length) {
    labour = labourDays({
      manufacturedFt: pipe.manufactured,
      stages: labourStages,
      hoursPerDay: settings.hoursPerDay,
      buffer: settings.daysBuffer
    });
  }
  const dayCharge = labour && labour.totalDays !== null
    ? labour.totalDays * n(settings.dayCost) : null;

  return {
    rows, pipe, extended, budget,
    margin: extended ? 1 - budget / extended : null,
    labour, dayCharge,
    /* True margin also carries the production days, as the workbook's K column does. */
    trueMargin: extended ? 1 - (budget + (dayCharge ?? 0)) / extended : null,
    missingCost:  rows.filter(r => r.cost === null).map(r => r.label),
    placeholders: rows.filter(r => r.cost_is_placeholder).map(r => r.label)
  };
}

/* The whole quote. `lines` is every row; groups are split on group_no. */
export function quoteTotals(lines, settings, stagesByGroup = {}) {
  const byGroup = new Map();
  for (const l of lines) {
    const g = l.group_no ?? 1;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(l);
  }
  const groups = [...byGroup.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([no, ls]) => ({
      groupNo: no,
      ...groupTotals(ls.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)), settings, stagesByGroup[no])
    }));

  const extended = groups.reduce((s, g) => s + g.extended, 0);
  const budget   = groups.reduce((s, g) => s + g.budget,   0);
  const dayCharge = groups.reduce((s, g) => s + (g.dayCharge ?? 0), 0);

  return {
    groups, extended, budget, dayCharge,
    margin: extended ? 1 - budget / extended : null,
    trueMargin: extended ? 1 - (budget + dayCharge) / extended : null,
    missingCost:  [...new Set(groups.flatMap(g => g.missingCost))],
    placeholders: [...new Set(groups.flatMap(g => g.placeholders))],
    totalDays: groups.reduce((s, g) => s + (g.labour?.totalDays ?? 0), 0)
  };
}

/* ---------------------------------------------------------------------
   Sales Quote view: the same groups with cost and margin stripped, and
   the lap flange folded into the end-flange unit price, which is what
   the Endeco Sales Quote did (its C13 = D5 + D6).
   --------------------------------------------------------------------- */
export function salesQuoteView(groups) {
  return groups.map(g => {
    const out = [];
    const end = g.rows.find(r => r.kind === "end_flange");
    const lap = g.rows.find(r => r.kind === "lap_flange");
    for (const r of g.rows) {
      if (r.kind === "lap_flange") continue;              // folded into the end flange
      if (r.kind === "end_flange" && lap) {
        const price = (r.price ?? 0) + (lap.price ?? 0);
        out.push({ ...r, price, extended: price * r.supplied, foldedLap: lap.label });
      } else {
        out.push(r);
      }
    }
    void end;
    return { groupNo: g.groupNo, rows: out,
             extended: out.reduce((s, r) => s + (r.extended ?? 0), 0) };
  });
}

/* ---------------------------------------------------------------------
   Repeat-price check. Matches on the exact product signature, so it only
   fires when the pipe is genuinely identical to one this customer was
   quoted before.
   --------------------------------------------------------------------- */
export function priceHistoryNotice(productKey, currentPrice, history) {
  if (!productKey || !history || !history.length) return null;
  const prior = history
    .filter(h => h.product_key === productKey && h.unit_price != null)
    .sort((a, b) => new Date(b.quoted_at) - new Date(a.quoted_at));
  if (!prior.length) return null;

  const last = prior[0];
  const differs = currentPrice != null &&
    Math.abs(Number(last.unit_price) - Number(currentPrice)) > 0.005;
  return {
    lastPrice: Number(last.unit_price),
    lastQuote: last.number,
    lastDate: last.quoted_at,
    count: prior.length,
    differs,
    all: prior.slice(0, 5)
  };
}
