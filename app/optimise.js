/* =====================================================================
   Cheapest braid configuration for a given pipe duty.

   Brute force would be ~270,000 solves (7 braids x 144 pitches x 3 passes
   x 6 longs x ~15 quantities), which is far too slow to run on a
   keystroke. It collapses because the constraints are separable:

     * Burst depends on the X-braid, pitch and pass count, and NOT on the
       longs. For a fixed braid and pass count, burst falls as pitch
       grows, so the cheapest pitch that still passes is the LARGEST one
       that passes — found by scanning the ladder downward and stopping
       at the first pass.
     * Longs carry tension and coupling retention, neither of which
       depends on pitch. Both improve monotonically with more longs, so
       the cheapest quantity is the smallest that satisfies them.
     * The yarn family is fixed by temperature (the stress-rupture slope
       is only defined for Twaron at or below 65 C and Technora above
       it), which removes most of the braid list immediately.

   That leaves a few thousand solves, which runs in well under a second.
   ===================================================================== */

import { XBRAIDS, LONGS, PITCH_LADDER, BRAID } from "./data.js?v=20261015-1550";
import { solve, requiredYarnType } from "./engine.js?v=20261015-1550";

/* What "works" means, split the way the workbook actually behaves.

   HARD rules disqualify a design. SOFT ones are reported but do not:
   v7's own shipped 2.875in / 3000psi configuration breaks two of them,
   running a 2.30in pitch against its stated 2.40in minimum and 40 longs
   against a circumference that fits 38. Those figures are printed on the
   sheet as information, not enforced, so treating them as hard would
   reject the very design the business ships. The optimiser still prefers
   a configuration with no soft warnings over a cheaper one with them. */
export function designRules(r) {
  const yarn = t => (String(t || "").match(/\(([^)]+)\)/) || [, ""])[1] || "—";
  return [
    { label: "Yarn family", hard: true, fmt: "text",
      ok: r.slope !== null, got: yarn(r.yarnType), need: yarn(r.reqYarnType),
      msg: "yarn family wrong for the temperature" },
    { label: "Longs family", hard: true, fmt: "text",
      ok: r.longsFamilyOK !== false, got: yarn(r.longsYarnType), need: yarn(r.reqYarnType),
      msg: "longs yarn family wrong for the temperature" },
    { label: "Design burst (0.67 SF)", hard: true, fmt: "int", unit: "psi", cmp: "≥",
      ok: r.burstTotal >= r.targetBurstR, got: r.burstTotal, need: r.targetBurstR,
      msg: "below the 0.67 SF design burst" },
    { label: "API minimum burst", hard: true, fmt: "int", unit: "psi", cmp: "≥",
      ok: r.burstTotal >= r.minBurst, got: r.burstTotal, need: r.minBurst,
      msg: "below the API minimum burst" },
    { label: "Longs strain", hard: true, fmt: "pct", cmp: "<",
      ok: r.strainRatio < 0.35, got: r.strainRatio, need: 0.35,
      msg: "longs strain ratio at or above 35%" },
    { label: "Coupling retention", hard: true, fmt: "pct", cmp: "<",
      ok: r.fiberRatio < 0.30, got: r.fiberRatio, need: 0.30,
      msg: "coupling retention at or above 30%" },
    { label: "Jacket wall", hard: true, fmt: "in", unit: "in", cmp: "≥",
      ok: !(r.jacketThk < 0.07), got: r.jacketThk, need: 0.07,
      msg: "jacket wall below the 0.07 in minimum" },
    { label: "Base layer walls", hard: true, fmt: "in", unit: "in", cmp: ">",
      ok: !(r.minBaseThk <= 0), got: r.minBaseThk, need: 0,
      msg: "a base layer wall is zero or negative" },
    { label: "Pitch vs braid width", hard: false, fmt: "in", unit: "in", cmp: "≥",
      ok: !(r.pitch < r.minPitch - 1e-9), got: r.pitch, need: r.minPitch,
      msg: "pitch under the braid-width minimum" },
    { label: "Braid angle", hard: false, fmt: "deg", cmp: "≥",
      ok: !(r.braidAngle < 57.3), got: r.braidAngle, need: 57.3,
      msg: "braid angle under 57.3 deg" },
    { label: "Longs fit circumference", hard: false, fmt: "int", unit: "ea", cmp: "≤",
      ok: !(r.longsQty > r.maxLongs), got: r.longsQty, need: r.maxLongs,
      msg: "more longs than the circumference fits" }
  ];
}

export function checkDesign(r) {
  const hard = [], soft = [];
  for (const d of designRules(r)) if (!d.ok) (d.hard ? hard : soft).push(d.msg);
  return { ok: hard.length === 0, hard, soft, clean: hard.length === 0 && soft.length === 0 };
}

/* Smallest longs count that satisfies tension and coupling retention.
   Both ratios fall as the count rises, so this walks up in fours. */
function minLongs(base, longsName, prices) {
  const probe = q => solve({ ...base, longs: longsName, longsQty: q, prices });
  const first = probe(4);
  if (!first.longsStr) return null;                       // no such longs
  /* Longs go on in four equal quadrants (Inputs!A114), so the count is a
     multiple of four. Both hard limits fall as the count rises - strain is
     force / (qty x strength) and retention is load / (qty x width x stem) -
     so the smallest count that satisfies them is the one to take.

     The search used to stop at the circumference fit, which made the
     optimiser report "nothing passes" for duties that work perfectly well
     with more longs on. The fit is a SOFT rule precisely because exceeding
     it is normal: v7's own shipped design runs 40 where 38 fit. So the
     search runs the whole ladder and lets checkDesign raise the warning. */
  const fit = Math.max(4, Math.ceil((first.maxLongs || 0) / 4) * 4);
  const CEILING = 200;                      // LONGS_LADDER tops out here
  const holds = r => r.strainRatio < 0.35 && r.fiberRatio < 0.30;

  const top = probe(CEILING);
  if (!holds(top)) {
    /* Even a full ladder will not hold it. Hand back the fullest arrangement
       so the caller can report HOW it misses rather than just saying no. */
    return { qty: CEILING, solved: top, feasible: false };
  }
  let lo = 1, hi = CEILING / 4;             // counting in quadrant sets of 4
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (holds(probe(mid * 4))) hi = mid; else lo = mid + 1;
  }
  const qty = lo * 4;
  return { qty, solved: probe(qty), feasible: true, overFit: qty > fit };
}

/* Largest pitch that still meets burst for this braid and pass count.
   Scans down from the coarsest pitch and stops at the first that passes,
   because a coarser pitch always uses less yarn. */
function bestPitch(base, xbraid, passes, prices) {
  const w = (BRAID[xbraid] || {}).w || 0;
  const floor = w * 12;                                   // Inputs!F82
  const at = i => solve({ ...base, xbraid, pitch: PITCH_LADDER[i], passes, prices });
  const ok = r => r.burstTotal >= r.targetBurstR && r.burstTotal >= r.minBurst;

  let lo = 0;                                             // first legal pitch
  while (lo < PITCH_LADDER.length && PITCH_LADDER[lo] < floor - 1e-9) lo++;
  if (lo >= PITCH_LADDER.length) return null;

  const finest = at(lo);
  if (finest.slope === null) return null;                 // wrong family, braid is out
  /* Not even the finest legal pitch makes the burst. Hand it back anyway -
     it is the most this braid can do, and the caller reports that rather
     than just saying no. */
  if (!ok(finest)) return { pitch: PITCH_LADDER[lo], passes, solved: finest, short: true };

  /* Burst falls as the pitch grows, so the cheapest pitch that still passes
     is the LARGEST one that passes, and a monotonic sequence can be
     bisected. Walking the ladder cost up to 144 solves per braid and pass
     count - about 1,300 for a 6in design, which was felt on a keystroke. */
  let a = lo, b = PITCH_LADDER.length - 1, bestI = lo, bestR = finest;
  while (a <= b) {
    const mid = (a + b) >> 1;
    const r = at(mid);
    if (ok(r)) { bestI = mid; bestR = r; a = mid + 1; } else b = mid - 1;
  }
  return { pitch: PITCH_LADDER[bestI], passes, solved: bestR };
}

/* ---------------------------------------------------------------------
   optimise(base, prices) -> { best, tried, considered, elapsedMs }
   `base` is the input object without braid choices; everything else on
   it (size, pressure, temperature, service, length) is taken as given.
   --------------------------------------------------------------------- */
/* The optimiser never reaches for 15-2 braid: only 15-1 and 15-3 are stocked
   for it to choose from. 15-2 stays selectable by hand in the Designer, so a
   deliberate choice is still possible — it just will not be proposed. */
const OPTIMISER_SKIPS = /15-2/;

/* Both lists are also cut to the yarn family the temperature allows. The
   braid list was already pruned implicitly, because bestPitch() bails as
   soon as solve() returns a null slope; the LONGS were not, which is how
   Twaron longs were being proposed for a 105 C pipe - they are a third
   cheaper per pound than Technora, so with nothing to stop them they won
   every time. */
const inFamily = (name, degC) =>
  (BRAID[name] || {}).type === requiredYarnType(degC);

export const optimiserBraids = degC =>
  XBRAIDS.filter(b => !OPTIMISER_SKIPS.test(b)
                   && (degC === undefined || inFamily(b, degC)));
export const optimiserLongs = degC =>
  LONGS.filter(b => !OPTIMISER_SKIPS.test(b)
                 && (degC === undefined || inFamily(b, degC)));

export function optimise(base, prices, opts = {}) {
  const t0 = performance.now();
  const maxPasses = opts.maxPasses ?? 3;
  const degC = Math.floor((base.degF - 32) * (5 / 9) + 1e-9);    // engine D7
  let considered = 0, nearest = null;
  const tried = [];

  for (const xbraid of optimiserBraids(degC)) {
    for (let passes = 1; passes <= maxPasses; passes++) {
      const hit = bestPitch(base, xbraid, passes, prices);
      considered++;
      if (!hit) continue;

      for (const longsName of optimiserLongs(degC)) {
        considered++;
        let qty;
        if (hit.short) {
          const probe = solve({ ...base, xbraid, pitch: hit.pitch, passes,
                                longs: longsName, longsQty: 4, prices });
          if (!probe.longsStr) continue;                    // no such longs
          qty = Math.max(4, Math.ceil((probe.maxLongs || 0) / 4) * 4);
        } else {
          const lp = minLongs({ ...base, xbraid, pitch: hit.pitch, passes }, longsName, prices);
          if (!lp) continue;                                // no such longs
          qty = lp.qty;
        }

        const cand = { ...base, xbraid, pitch: hit.pitch, passes,
                       longs: longsName, longsQty: qty };
        const r = solve({ ...cand, prices });
        const chk = checkDesign(r);
        const row = { inputs: cand, costPerFt: r.costPerFt, burst: r.burstTotal,
                      warnings: chk.soft, blockers: chk.hard, clean: chk.clean,
                      angle: r.braidAngle, weight: r.weightPerFt, solved: r };

        if (!chk.ok) {
          // Keep the closest miss so the UI can explain the refusal.
          const closer = !nearest
            || chk.hard.length < nearest.blockers.length
            || (chk.hard.length === nearest.blockers.length
                && r.burstTotal > nearest.burst);
          if (closer) nearest = row;
          continue;
        }
        tried.push(row);
      }
    }
  }

  /* Both rankings come off the same search, so the UI can show what the
     chosen objective costs against the other without searching twice. */
  const byCost   = [...tried].sort(rankCheapest);
  const byPasses = [...tried].sort(rankFewestPasses);
  const byTwo    = tried.filter(t => t.inputs.passes === 2).sort(rankCheapest);
  const objective = ["fewest_passes", "two_pass"].includes(opts.objective)
    ? opts.objective : "cheapest";
  /* If nothing runs in two passes, fall back to the cheapest rather than
     returning nothing; the caller says so in its note. */
  const best = objective === "fewest_passes" ? (byPasses[0] || null)
             : objective === "two_pass"      ? (byTwo[0] || byCost[0] || null)
             : (byCost[0] || null);

  return {
    best, objective,
    cheapest:     byCost[0]   || null,
    fewestPasses: byPasses[0] || null,
    twoPass:      byTwo[0]    || null,
    nearest: best ? null : nearest,
    tried: (objective === "fewest_passes" ? byPasses
          : objective === "two_pass" ? (byTwo.length ? byTwo : byCost)
          : byCost).slice(0, 8),
    considered,
    elapsedMs: Math.round(performance.now() - t0)
  };
}

/* Cheapest: a design with no soft warnings beats one that has them, then the
   cheaper wins. Ranking rather than filtering means a workable-but-flagged
   configuration is still offered when nothing clean exists. */
function rankCheapest(a, b) {
  if (a.clean !== b.clean) return a.clean ? -1 : 1;
  /* Material cost only. Production time is deliberately NOT priced in here:
     the Designer costs the pipe, not the run. The pass count a design needs
     is still visible, and the fewest-passes objective is there for when that
     is what matters. */
  return a.costPerFt - b.costPerFt;
}

/* Fewest passes: easiest to make, cost second. Pass count leads here rather
   than cleanliness, because a one-pass design carrying a soft warning is
   still the simpler thing to run than a clean two-pass one — which is the
   whole point of asking for this objective. Within a pass count, clean wins,
   then cheaper. */
function rankFewestPasses(a, b) {
  if (a.inputs.passes !== b.inputs.passes) return a.inputs.passes - b.inputs.passes;
  if (a.clean !== b.clean) return a.clean ? -1 : 1;
  return a.costPerFt - b.costPerFt;
}
