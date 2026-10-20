/* =====================================================================
   Master cost sheet — bought-in parts, line speeds and quote settings.

   The Endeco workbook had the right shape for this on its Cost Sheet
   (Zinc Chromate / PPS / Duplex 2205 x RF / RTJ / Midline, by size) but
   every price cell was blank: costs were typed into each quote by hand.
   So every row here starts UNPRICED, and `cost IS NULL` is deliberately
   distinct from zero. Quoting will report a missing cost rather than
   treat the part as free.
   ===================================================================== */

/* Team Questions H9:Q21 — the one relationship worth keeping from that
   sheet. Its formulas were wrong, but this mapping is not. */
export const RTP_TO_LAP = {
  "6":    { lap:'6"', lapId:'6.95" ID', rtpLabel:'6" RTP',     maxReelFt:918,  lbsPerFt:5.05, reelOdFt:14.5 },
  "5":    { lap:'6"', lapId:'6.75" ID', rtpLabel:'5" RTP',     maxReelFt:1200, lbsPerFt:4.15, reelOdFt:14.5 },
  "4.5":  { lap:'4"', lapId:'5.25" ID', rtpLabel:'4.5" RTP',   maxReelFt:2300, lbsPerFt:3.80, reelOdFt:14.5 },
  "4":    { lap:'4"', lapId:'4.6" ID',  rtpLabel:'4" RTP',     maxReelFt:2600, lbsPerFt:3.45, reelOdFt:14.5 },
  "3.5":  { lap:'3"', lapId:'3.6" ID',  rtpLabel:'3.5" RTP',   maxReelFt:5000, lbsPerFt:1.32, reelOdFt:12 },
  "3":    { lap:'3"', lapId:'3.6" ID',  rtpLabel:'3" RTP',     maxReelFt:5000, lbsPerFt:1.03, reelOdFt:12 },
  "2.375":{ lap:'2"', lapId:'2.46" ID', rtpLabel:'2.375" RTP', maxReelFt:6000, lbsPerFt:0.80, reelOdFt:10 },
  "1.75": { lap:'2"', lapId:'2.46" ID', rtpLabel:'1.75" RTP',  maxReelFt:6500, lbsPerFt:0.44, reelOdFt:10 }
};

/* Team Questions H24:J152, collapsed to bands. The sheet listed every
   25 psi step; the bands are what it actually encodes. */
const ANSI_BANDS = [
  [300, 150], [750, 300], [1500, 600], [2250, 900], [3700, 1500], [6150, 2500]
];
export function ansiClassFor(psi) {
  for (const [limit, cls] of ANSI_BANDS) if (psi <= limit) return cls;
  return null;                       // above 6150 psi the workbook stops
}

/* Team Questions T25:U27 — the connection material decides sour vs sweet. */
export const CONNECTION_MATERIALS = [
  { name: "Carbon Steel, Zinc Chromate-ID/OD",        service: "Sweet", short: "Zinc Chromate" },
  { name: "Carbon Steel, PPS-ID / Zinc Chromate-OD",  service: "Sour",  short: "PPS" },
  { name: "Stainless Steel",                          service: "Sour",  short: "Duplex 2205" }
];
export const serviceForConnection = name =>
  (CONNECTION_MATERIALS.find(m => m.name === name) || {}).service || null;

export const SEALING_TYPES = ["RF", "RTJ", "Midline"];
export const ANSI_CLASSES  = [150, 300, 600, 900, 1500, 2500];

/* The four part lines a pipe group needs, derived rather than typed. */
export function partsForPipe({ rtpSize, psi, connectionMaterial, sealing }) {
  const m = RTP_TO_LAP[String(rtpSize)];
  const cls = ansiClassFor(psi);
  if (!m || !cls) return null;
  const seal = sealing || "RF";
  return {
    ansiClass: cls,
    lap: m.lap, lapId: m.lapId, rtpLabel: m.rtpLabel,
    endFlange: `${m.rtpLabel}, ${m.lap} ANSI ${cls} ${seal} ${connectionMaterial} {Ends Flanges}`,
    lapFlange: `${m.lap} ANSI ${cls}, ${m.lapId} {Lap Flanges}`,
    splice:    `${m.rtpLabel}, ${connectionMaterial} {Splice}`
  };
}

/* The braiders on the floor. 1 and 2 carry one pass per run; 3 carries two
   at once, so it does a 3-pass design in two runs rather than three. */
export const BRAIDERS = [
  { id:1, label:"Braider 1", passesPerRun:1 },
  { id:2, label:"Braider 2", passesPerRun:1 },
  { id:3, label:"Braider 3", passesPerRun:2 }
];
export const braiderById = id =>
  BRAIDERS.find(b => b.id === Number(id)) || BRAIDERS[0];

/* ---------------------------------------------------------------------
   Labour calculator, from the Profitability Review's stage tables.
     day rate ft = ft/min * 60 * 24 * (1/runs) * efficiency
                   * braider multiplier * (hours per day / 24)
     days        = manufactured units / day rate

   A "pass" is going over the same section again, and only the BRAIDER
   does that - the base tube and the cover are extruded once however many
   times the braid is laid. So runs is the design's pass count on the
   braider row and 1 everywhere else, and the per-row passes column no
   longer enters: it described the design, not the line.

   Which braider runs the job decides how many runs those passes take,
   because braider 3 lays two passes at once: 3 passes is 3 runs on
   braider 1 or 2 and 2 runs on braider 3.

   Total is the LONGEST stage plus a buffer, not the sum: the stages run
   on separate lines, so they overlap.
   --------------------------------------------------------------------- */
export function labourDays({ manufacturedFt, stages, hoursPerDay = 24, buffer = 2,
                             braidPasses = 1, braider = 1 }) {
  const perRun = braiderById(braider).passesPerRun;
  const rows = stages.map(s => {
    const isBraid = String(s.stage).toLowerCase().startsWith("braid");
    const runs = isBraid
      ? Math.max(1, Math.ceil((Number(braidPasses) || 1) / perRun))
      : 1;
    const rate = (s.ft_per_min === null || s.ft_per_min === undefined)
      ? null
      : s.ft_per_min * 60 * 24 * (1 / runs) * (s.efficiency ?? 0.8)
        * (s.braider_mult ?? 1) * (hoursPerDay / 24);
    return { ...s, runs, isBraid, dayRateFt: rate,
             days: rate ? manufacturedFt / rate : null };
  });
  const known = rows.filter(r => r.days !== null).map(r => r.days);
  const missing = rows.filter(r => r.days === null).map(r => r.stage);
  const longest = known.length ? Math.max(...known) : null;
  return {
    rows, missing, braidPasses: Number(braidPasses) || 1,
    braider: braiderById(braider), braidRuns: rows.find(r => r.isBraid)?.runs ?? null,
    longestDays: longest,
    totalDays: longest === null ? null : Math.ceil(longest - 1e-9) + buffer
  };
}
