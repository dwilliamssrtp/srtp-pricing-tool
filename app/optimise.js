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

import { XBRAIDS, LONGS, PITCH_LADDER, BRAID } from "./data.js?v=20261013-0923";
import { solve, requiredYarnType } from "./engine.js?v=20261013-0923";

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
     multiple of four. The circumference fit is rounded UP to the next
     multiple rather than down, which is exactly what v7 does: it fits 38
     and ships 40. Going further than that is not a rounding artefact,
     it is overcrowding, so the search stops there. */
  const cap = Math.max(4, Math.ceil((first.maxLongs || 0) / 4) * 4);
  for (let q = 4; q <= cap; q += 4) {
    const r = probe(q);
    if (r.strainRatio < 0.35 && r.fiberRatio < 0.30)
      return { qty: q, solved: r, feasible: true };
  }
  /* Nothing in the fit works. Hand back the fullest arrangement anyway, so
     the caller can report HOW it misses rather than just saying no. At
     4.5in / 2200psi, for instance, retention bottoms out at 30.2% against
     a 30% limit even with the circumference packed. */
  return { qty: cap, solved: probe(cap), feasible: false };
}

/* Largest pitch that still meets burst for this braid and pass count.
   Scans down from the coarsest pitch and stops at the first that passes,
   because a coarser pitch always uses less yarn. */
function bestPitch(base, xbraid, passes, prices) {
  const w = (BRAID[xbraid] || {}).w || 0;
  const floor = w * 12;                                   // Inputs!F82
  for (let i = PITCH_LADDER.length - 1; i >= 0; i--) {
    const pitch = PITCH_LADDER[i];
    if (pitch < floor - 1e-9) break;                      // ladder is ascending
    const r = solve({ ...base, xbraid, pitch, passes, prices });
    if (r.slope === null) return null;                    // wrong family, whole braid is out
    if (r.burstTotal >= r.targetBurstR && r.burstTotal >= r.minBurst)
      return { pitch, passes, solved: r };
  }
  return null;
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
        const lp = minLongs({ ...base, xbraid, pitch: hit.pitch, passes }, longsName, prices);
        considered++;
        if (!lp) continue;                                  // no such longs

        const cand = { ...base, xbraid, pitch: hit.pitch, passes,
                       longs: longsName, longsQty: lp.qty };
        const r = solve({ ...cand, prices });
        const chk = checkDesign(r);
        const row = { inputs: cand, costPerFt: r.costPerFt, burst: r.burstTotal,
                      warnings: chk.soft, blockers: chk.hard, clean: chk.clean,
                      angle: r.braidAngle, weight: r.weightPerFt, solved: r };

        if (!chk.ok) {
          // Keep the closest miss so the UI can explain the refusal.
          if (!nearest || chk.hard.length < nearest.blockers.length
              || (chk.hard.length === nearest.blockers.length
                  && r.costPerFt < nearest.costPerFt)) nearest = row;
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
  const objective = opts.objective === "fewest_passes" ? "fewest_passes" : "cheapest";
  const best = (objective === "fewest_passes" ? byPasses : byCost)[0] || null;

  return {
    best, objective,
    cheapest:     byCost[0]   || null,
    fewestPasses: byPasses[0] || null,
    nearest: best ? null : nearest,
    tried: (objective === "fewest_passes" ? byPasses : byCost).slice(0, 8),
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
