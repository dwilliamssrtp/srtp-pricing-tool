import {
  PIPE, MATERIALS, BRAID, COUPLING_BY_NAME, COUPLING_HI, COUPLING_LO,
  COUPLING_OD_POST, CDS_FITTINGS, SERVICES, LINER_SWEET, LINER_SOUR,
  BOND_BY_LINER, BACKER_SWEET, BACKER_SOUR, JACKET_SWEET, JACKET_SOUR,
  BRAID_FAMILY_BY_TEMP, API_NOMINAL, LPG_CODES, SPOOL_PIPE
} from "./data.js?v=20261009-1536";

/* =====================================================================
   SRTP Pricing Tool v7 — calculation engine
   Mirrors the Inputs sheet formula chain. Cell addresses in comments are
   the authoritative source for each line.

   Prices are INJECTED, not held here: solve(inp) reads inp.prices, shaped
   { polymer: {name: $/lb}, braid: {name: $/lb} }, loaded from Supabase.
   A missing price is reported as a warning, never silently costed as zero.
   ===================================================================== */

/* ---- Excel-equivalent rounding --------------------------------------- */
const EPS = 1e-10;
const rUp   = (x, d=0) => { const m = Math.pow(10, d); return Math.ceil(x * m - EPS) / m; };
const rDown = (x, d=0) => { const m = Math.pow(10, d); return Math.floor(x * m + EPS) / m; };
const rnd   = (x, d=0) => { const m = Math.pow(10, d); return Math.round((x * m).toFixed(6) * 1) / m; };
const DEG = 57.3;        // the sheet's degree constant for ATAN/TAN
const DEG2 = 57.2958;    // the sheet's degree constant inside SIN()

/* Approximate VLOOKUP over an ascending [key, value] list. */
function vlookupApprox(key, pairs) {
  let hit = null;
  for (const [k, v] of pairs) { if (k <= key + EPS) hit = v; else break; }
  return hit;
}
export const matKey = n => (n || "").trim();
function mat(name, prices) {
  const k = matKey(name);
  const m = MATERIALS[k];
  if (!m) return { sg:0, cost:0, comp:null, acr:"", missing:true, noPrice:true, name:k };
  const p = prices && prices.polymer ? prices.polymer[k] : undefined;
  return { ...m, cost: p === undefined ? 0 : p, noPrice: p === undefined, name:k, missing:false };
}
/* Braid price, same contract as mat(): absent is reported, not zeroed. */
function braidPrice(name, prices) {
  const p = prices && prices.braid ? prices.braid[name] : undefined;
  return p === undefined ? null : p;
}
/* annulus weight, lbs/ft: ((pi(OD/2)^2 - pi(ID/2)^2)/144) * 62.43 * SG * pct */
const annulusWt = (od, id, sg, pct=1) =>
  rUp(((Math.PI * Math.pow(od/2,2) - Math.PI * Math.pow(id/2,2)) / 144) * 62.43 * sg * pct, 4);

/* =====================================================================
   solve(inp) — the whole workbook from one input object.
   ===================================================================== */
export function solve(inp) {
  const o = {}, warn = [];
  const pb = inp.prices || null;          // { polymer:{}, braid:{} } from Supabase
  o.priceBookName = inp.priceBookName || null;
  const missingPrices = [];

  /* ---------------- 1. inputs & unit conversions (Inputs!A1:D11) ------ */
  o.client   = inp.client;                                  // B2
  o.lengthFt = inp.lengthFt;                                // B4
  o.lengthM  = rUp(inp.lengthFt / 3.28, 0);                 // D4
  o.sizeKey  = inp.sizeKey;                                 // B5
  o.psi      = inp.psi;                                     // B6
  o.bar      = rUp(inp.psi * 0.0689475729, 0);              // D6
  o.degF     = inp.degF;                                    // B7
  o.degC     = rDown((inp.degF - 32) * (5/9), 0);           // D7
  o.service  = inp.service;                                 // B8
  o.sour     = inp.sour;                                    // B9  "Sweet" | "Sour"
  o.h2s      = inp.sour === "Sweet" ? "<200ppm H2S" : ">200ppm H2S";  // C9
  o.co2      = inp.sour === "Sweet" ? "<7% CO2"     : ">7% CO2";      // D9
  o.color    = inp.color;                                   // B10
  o.years    = inp.years;                                   // B11
  o.app      = inp.app;                                     // D8

  const P = PIPE[o.sizeKey] || {};
  const nz = v => (v === null || v === undefined ? 0 : v);

  /* ---------------- 2. material selection (Inputs!A35:A43, B27:C31) --- */
  const si = Math.max(0, SERVICES.indexOf(o.service));
  const linerTbl  = o.sour === "Sweet" ? LINER_SWEET  : LINER_SOUR;
  o.liner  = (linerTbl[o.degF] || [])[si] || "";                         // A35
  o.bond   = BOND_BY_LINER[matKey(o.liner)] || "";                       // A36
  o.backer = (o.sour === "Sweet" ? BACKER_SWEET : BACKER_SOUR)[o.degF];  // A37
  o.jacket = (o.sour === "Sweet" ? JACKET_SWEET : JACKET_SOUR)[o.degF];  // A42
  o.colorMB = o.color === "White" ? "PPMBUVWH - White Color Concentrate"
                                  : "PPMBUVYL - Yellow LPG";             // A43
  o.braidFamily = BRAID_FAMILY_BY_TEMP[o.degF];                          // B31
  [o.liner,o.backer,o.jacket].forEach(m => {
    if (matKey(m) === "Select 196°F")
      warn.push(`No ${o.sour.toLowerCase()}-service grade is tabulated at ${o.degF}°F — the sheet returns "Select 196°F". Move the design temperature to 196°F.`);
  });

  /* ---------------- 3. base tube (Inputs!A34:J38) --------------------- */
  const mL = mat(o.liner, pb), mB = mat(o.bond, pb), mK = mat(o.backer, pb);
  o.skinThk   = nz(P.V);                      // C35
  o.bondThk   = nz(P.W);                      // C36
  o.backerThk = nz(P.X);                      // C37
  o.specWT    = nz(P.R);                      // C38
  o.linerID   = nz(P.Q);                      // E35
  if (P.V === null || P.V === undefined)
    warn.push(`Inputs!N8:X24 carries no skin/bond/backer thickness for "${o.sizeKey}", so the base-tube layers compute as zero.`);

  o.base = [
    { name:mL.name, sg:mL.sg, thk:o.skinThk,   id:o.linerID,                                  od:o.linerID + 2*o.skinThk,                             price:mL.cost },
    { name:mB.name, sg:mB.sg, thk:o.bondThk,   id:o.linerID + 2*o.skinThk,                    od:o.linerID + 2*o.skinThk + 2*o.bondThk,               price:mB.cost },
    { name:mK.name, sg:mK.sg, thk:o.backerThk, id:o.linerID + 2*o.skinThk + 2*o.bondThk,      od:o.linerID + 2*o.skinThk + 2*o.bondThk + 2*o.backerThk, price:mK.cost }
  ];
  o.base.forEach(L => { L.wt = annulusWt(L.od, L.id, L.sg); L.cost = L.wt * L.price; });
  o.baseWt   = o.base.reduce((s,L)=>s+L.wt,   0);            // G38
  o.baseCost = o.base.reduce((s,L)=>s+L.cost, 0);            // I38
  o.baseOD   = o.linerID + 2*o.specWT;                       // D38 — liner OD from spec WT

  /* ---------------- 4. braid geometry (Inputs!A55:H59, A76) ----------- */
  o.xbraid = inp.xbraid; o.pitch = inp.pitch; o.passes = inp.passes;   // A14,B14,C14
  o.longsName = inp.longs; o.longsQty = inp.longsQty;                  // A15,B15
  const BX = BRAID[o.xbraid] || {}, BL = BRAID[o.longsName] || {};

  o.A56 = o.baseOD;                                                    // A56
  o.A57 = o.A56 + 2*0.03;                                              // A57 — +1 braid layer
  o.A58 = o.A57 + 2*0.03;                                              // A58
  o.A59 = o.A58 + 2*0.03;                                              // A59
  o.braidAngle = Math.atan((Math.PI * o.A56) / o.pitch) * DEG;         // C56
  o.pitch2 = rDown((Math.PI * o.A57) / Math.tan(o.braidAngle/DEG), 2); // F57
  o.pitch3 = rDown((Math.PI * o.A58) / Math.tan(o.braidAngle/DEG), 2); // H58
  o.pitchLenPerFt = Math.sqrt(Math.pow(o.A56*Math.PI,2) + Math.pow(o.pitch,2)) * (12/o.pitch); // B76
  o.minPitch = nz(BX.w) * 12;                                          // F82 / F24
  if (o.pitch < o.minPitch - EPS)
    warn.push(`Pitch ${o.pitch.toFixed(2)}" is below the ${o.minPitch.toFixed(2)}" minimum for a ${nz(BX.w)}" wide braid (Inputs!F82).`);

  /* ---------------- 5. jacket (Inputs!A41:J44) ----------------------- */
  const mJ = mat(o.jacket, pb), mC = mat(o.colorMB, pb);
  o.jacketOD = nz(P.O);                                                        // D42
  o.jacketID = [o.A57, o.A58, o.A59][o.passes - 1];                            // E42
  o.jacketThk = (o.jacketOD - o.jacketID) / 2;                                 // C42
  o.colorPct = inp.colorPct;                                                   // F43
  o.jacketPct = 1 - o.colorPct;                                                // F42
  o.jacketWt = annulusWt(o.jacketOD, o.jacketID, mJ.sg, o.jacketPct);          // G42
  o.colorWt  = annulusWt(o.jacketOD, o.jacketID, mC.sg, o.colorPct);           // G43
  o.jacketCost = o.jacketWt * mJ.cost;                                         // I42
  o.colorCost  = o.colorWt  * mC.cost;                                         // I43
  o.jacketTotWt   = o.jacketWt + o.colorWt;                                    // G44
  o.jacketTotCost = o.jacketCost + o.colorCost;                                // I44
  o.jacketPrice = mJ.cost; o.colorPrice = mC.cost;
  o.jacketSG = mJ.sg; o.colorSG = mC.sg;
  if (P.O === null || P.O === undefined)
    warn.push(`Inputs!N8:U24 carries no jacket OD for "${o.sizeKey}" (the sheet reads column O), so jacket thickness is negative/zero.`);
  if (o.jacketThk < 0.07)
    warn.push(`Jacket wall ${o.jacketThk.toFixed(3)}" is below the 0.07" minimum printed on the MDS.`);

  /* ---------------- 6. braid weight & cost (Inputs!A47:J50) ---------- */
  o.ends = 24;                                                         // C48
  o.xWtPerPass = (nz(BX.wt) * o.ends * o.pitchLenPerFt) / 12;           // D48
  o.xWt   = rUp(o.xWtPerPass * o.passes, 4);                            // G48
  o.xPrice = braidPrice(o.xbraid, pb);
  if (o.xPrice === null) missingPrices.push(o.xbraid);
  o.xCost = o.xWt * nz(o.xPrice);                                       // I48
  o.longsWtRaw = nz(BL.wt) * o.longsQty;                                // D49
  o.longsWt   = rUp(o.longsWtRaw, 4);                                   // G49
  o.longsPrice = braidPrice(o.longsName, pb);
  if (o.longsPrice === null) missingPrices.push(o.longsName);
  o.longsCost = o.longsWt * nz(o.longsPrice);                           // I49
  o.braidWt   = o.xWt + o.longsWt;                                      // G50
  o.braidCost = o.xCost + o.longsCost;                                  // I50

  /* ---------------- 7. totals (Inputs!G53:J53) ---------------------- */
  o.totWt   = o.braidWt + o.jacketTotWt + o.baseWt;                     // G53
  o.totCost = o.braidCost + o.jacketTotCost + o.baseCost;               // I53
  o.rtpSG = (o.base.reduce((s,L)=>s + (L.wt/o.totWt)*L.sg, 0))          // J38
          + (o.jacketWt/o.totWt)*mJ.sg + (o.colorWt/o.totWt)*mC.sg      // J44
          + (o.xWt/o.totWt)*1.25 + (o.longsWt/o.totWt)*1.25;            // J50 (braid SG = 1.25)

  /* ---------------- 8. stress rupture (Inputs!A78:B101) ------------- */
  o.yarnType = BX.type || "";                                           // B81
  if (o.degC <= 65) {
    o.slope = o.yarnType === "Twaron (KN)" ? 0.03539 : null;            // B82
    if (o.slope === null) warn.push("At ≤65°C the stress-rupture slope requires a Twaron (KN) X-braid — the sheet returns \"WRONG BRAID USE TN\".");
  } else {
    o.slope = o.yarnType === "Technora (TN)" ? 0.0242 : null;
    if (o.slope === null) warn.push("Above 65°C the stress-rupture slope requires a Technora (TN) X-braid (Inputs!B82).");
  }
  const sl = o.slope || 0.0242;
  o.hours        = o.years * 365 * 24;                                  // C84
  o.logRefP      = 2.5951 - sl * Math.log10(o.hours);                   // B83
  o.refPressure  = Math.pow(10, o.logRefP) * 14.5;                      // B84
  o.yIntercept   = Math.log10(o.psi / 14.5) + sl * Math.log10(o.hours); // B87
  o.yInterceptP  = Math.pow(10, o.yIntercept) * 14.5;                   // B88
  o.logShort     = o.yIntercept - sl * Math.log10(0.03);                // B92
  o.shortBurst   = Math.pow(10, o.logShort) * 14.5;                     // B93  FAT min burst
  o.targetBurst  = o.shortBurst / 0.67;                                 // B94  design target
  o.aramco       = o.targetBurst / 0.8;                                 // B95
  o.aramco400    = o.aramco + 400;                                      // B74
  o.log1000      = o.yIntercept - sl * Math.log10(1000);                // B97
  o.p1000        = Math.pow(10, o.log1000) * 14.5;                      // B98
  o.aramcoFactor = o.p1000 / 0.54;                                      // B99
  o.hydroFactor  = o.service === "Gas" ? 1.5 : 1.3;                     // B100
  o.hydroP       = o.psi * o.hydroFactor;                               // B101
  o.targetBurstR = rUp(o.targetBurst, 0);                               // A21
  o.sfRatio      = o.targetBurstR / o.psi;                              // A22

  /* ---------------- 9. achieved burst (Inputs!A69:F70, E21) --------- */
  o.yarnYield = nz(BX.str);                                             // F70
  const burstOf = (dia, pitch, angle) =>
    (2 * 24 * o.yarnYield * Math.sin(angle/DEG2)) / (dia * pitch);
  o.burst1 = burstOf(o.A56, o.pitch,  o.braidAngle);                    // B70
  o.burst2 = burstOf(o.A57, o.pitch2, o.braidAngle);                    // C70
  o.burst3 = burstOf(o.A58, o.pitch3, o.braidAngle);                    // D70
  o.burstTotal = [o.burst1, o.burst1+o.burst2, o.burst1+o.burst2+o.burst3][o.passes-1]; // E21
  o.minBurst = (o.xbraid||"").slice(0,2) === "KN" ? o.psi*2.31 : o.psi*2;  // E27
  o.sfAdded  = o.burstTotal - o.targetBurstR;                           // A24
  o.sfAddedPct = o.sfAdded / o.psi;                                     // AX8
  o.recPct   = 0.11;                                                    // E31
  o.recMinSF = ((o.minBurst * o.recPct) + o.minBurst) - o.targetBurstR; // F31

  /* ---------------- 10. longs / tensile (Inputs!E74:H74, F21) ------- */
  o.longsStr   = nz(BL.str);                                            // C109
  o.longsWidth = nz(BL.w);                                              // C108
  o.force      = Math.PI * Math.pow(o.linerID/2, 2) * o.psi;            // E74
  o.longsStrength = o.longsQty * o.longsStr;                            // F74
  o.strainRatio   = o.longsStrength ? o.force / o.longsStrength : 0;     // F21
  o.strainVerdict = o.strainRatio < 0.35 ? "Good" : "Needs More Longs";  // G21

  /* ---------------- 11. 24-Tensile layer (Inputs!A61:J66) ----------- */
  o.is24T = o.app === "24-Tensile";
  o.tBraid = inp.tBraid; o.tPitch = inp.tPitch; o.tPasses = inp.tPasses;
  const BT = BRAID[o.tBraid] || {};
  o.tLinerOD  = o.jacketID;                                             // A64 (= A57/58/59)
  o.tPitchLen = Math.sqrt(Math.pow(o.A57*Math.PI,2) + Math.pow(o.tPitch,2)) * (12/o.tPitch); // A66
  o.tAngle    = Math.atan((Math.PI * o.tLinerOD) / o.tPitch) * DEG;     // C64
  o.tApplied  = nz(BT.str) * 24;                                        // E64
  o.tVector   = o.tApplied / Math.atan(o.tAngle);                       // F64
  o.tWt       = (nz(BT.wt) * 24 * o.tPitchLen) / 12;                    // G64
  o.tPrice    = braidPrice(o.tBraid, pb);
  o.tCost     = o.tWt * nz(o.tPrice);                                   // I64
  o.tensileStrength = (o.is24T ? o.tVector : 0) + o.longsStrength;      // G11

  /* ---------------- 12. headline cost (Inputs!F4:H6, G4) ----------- */
  o.costPerFt   = (o.is24T ? o.tCost : 0) + o.totCost;                  // G5
  o.weightPerFt = rUp((o.is24T ? o.tWt : 0) + o.totWt, 3);              // G6
  o.targetPrice = o.costPerFt / 0.5;                                    // H5
  o.targetPriceM = o.targetPrice * 3.28;                                // H6
  o.margin = inp.margin;
  o.sellPerFt = o.margin < 1 ? o.costPerFt / (1 - o.margin) : o.costPerFt;
  o.sellPerM  = o.sellPerFt * 3.28;
  o.projectCost  = o.costPerFt  * o.lengthFt;
  o.projectPrice = o.sellPerFt  * o.lengthFt;
  o.projectWeight = o.weightPerFt * o.lengthFt;
  o.productName = `OD:${o.sizeKey}in ID:${o.linerID}in ${o.psi}psi ${o.degF}°F L${matKey(o.liner)} J${matKey(o.jacket)}`; // G4
  o.idArea = Math.PI * o.linerID;                                       // G12 (sheet uses pi*ID)

  /* ---------------- 13. couplings (Inputs!A105:C129, B12) ---------- */
  o.couplingName = (o.psi > 750 ? COUPLING_HI : COUPLING_LO)[o.sizeKey] || "";   // B12
  const CP = COUPLING_BY_NAME[o.couplingName] || {};
  o.couplingOD  = (o.psi > 750 ? COUPLING_OD_POST.hi : COUPLING_OD_POST.lo)[o.sizeKey];
  o.couplingIDIns = nz(CP.idIns);
  o.couplingRibs  = nz(CP.ribs);
  o.couplingMaxP  = nz(CP.maxP);
  o.stemLen     = nz(CP.stem);                                          // C106
  o.linerCircum = o.A56 * Math.PI;                                      // C107
  o.tensileAtHydro = (Math.pow(o.linerID/2,2) * Math.PI) * o.psi * o.hydroFactor; // C103
  o.compYield   = mK.comp;                                              // C104 / C117
  const cy = o.compYield || 900;
  o.yarnsNeeded  = o.longsStr ? o.tensileAtHydro / o.longsStr : 0;      // C110
  o.yarnsNeeded2 = rUp(o.yarnsNeeded * 2, 0);                           // C111
  o.fiberArea    = o.longsQty * o.longsWidth * o.stemLen;               // C115
  o.fiberPSI     = o.fiberArea ? o.tensileAtHydro / o.fiberArea : 0;    // C116
  o.fiberRatio   = o.fiberPSI / cy;                                     // C118 / B21
  o.couplingVerdict = o.fiberRatio >= 0.30 ? "Slips" : "Good";          // C119
  o.longsPressureCap = (o.longsQty * o.longsStr) / (Math.PI * Math.pow(o.linerID/2,2)); // C120
  o.longsPrediction  = (o.stemLen && o.longsWidth)
      ? o.tensileAtHydro / o.stemLen / o.longsWidth / (0.3 * cy) : 0;    // B52
  o.maxLongs = o.longsWidth ? rUp((o.baseOD * Math.PI) / o.longsWidth, 0) : 0; // D24 / G106
  o.couplingMinRet = o.idArea * o.shortBurst;                           // G13
  o.couplingTgtRet = o.idArea * o.targetBurstR;                         // G14
  /* downhole */
  o.dhSuspended  = o.lengthFt * o.totWt;                                // C123
  o.dhTotalLoad  = o.tensileAtHydro + o.dhSuspended;                    // C124
  o.dhYarns      = o.longsStr ? o.dhTotalLoad / o.longsStr : 0;         // C125
  o.dhYarns2     = o.dhYarns * 2;                                       // C126
  o.dhFiberPSI   = o.fiberArea ? o.dhTotalLoad / o.fiberArea : 0;       // C127
  o.dhRatio      = o.dhFiberPSI / cy;                                   // C128
  o.dhVerdict    = o.dhRatio >= 0.30 ? "Slips" : "Good";                // C129
  if (o.longsQty > o.maxLongs)
    warn.push(`${o.longsQty} longs exceeds the ${o.maxLongs} that fit the ${o.baseOD.toFixed(2)}" liner circumference (Inputs!G106).`);
  if (o.psi > o.couplingMaxP && o.couplingMaxP)
    warn.push(`Design pressure ${o.psi} psi exceeds the ${o.couplingMaxP} psi rating of the ${o.couplingName} coupling.`);
  if (o.couplingVerdict === "Slips")
    warn.push(`Coupling retention: fibre load is ${(o.fiberRatio*100).toFixed(1)}% of the ${cy} psi backer compressive yield (target ≤30%) — the sheet reports "Slips".`);

  /* ---------------- 14. API nominal & print (MDS1!I3, B43:B45) ----- */
  o.apiNominal = (o.app === "Downhole" || o.app === "LPG")
    ? o.jacketOD : vlookupApprox(o.linerID, API_NOMINAL);               // I3
  o.mdsSize = (o.app === "Downhole") ? o.apiNominal : rnd(o.jacketOD, 0); // D3
  if (o.app === "LPG") {
    const lp = LPG_CODES[o.jacketOD];
    o.printLine1 = lp
      ? `${o.psi === 1200 ? "FP-Flex" : "FP-Flex"} ${lp[0]} ${lp[2]||""} OD ${o.jacketOD}in - ID ${o.linerID}in`.replace(/\s+/g," ")
      : `CGH LPG-Flex OD ${o.jacketOD}in - ID ${o.linerID}in`;
    o.printLine3 = "LPG, Propane, Butane Use only CGH LPG-Flex Couplings - XXXXXXXXX01 (Date Code & Footage)";
  } else {
    o.printLine1 = (o.app === "Flowline" ? "15S-0020 - " : "")
      + `${o.apiNominal}'' Nominal - ${rnd(o.linerID,2)}'' ID - ${rnd(o.jacketOD,2)}'' OD`;
    o.printLine3 = `${o.sour} Environment Only - Use SRTP® couplings only - XXXXXXXXX01 (Date Code & Footage)`;
  }
  o.printLine2 = `MAOP: ${o.psi}psi (${rUp(o.psi/14.5,1)}bars) - DT: ${o.degC}°C (${rUp(o.degC*9/5+32,0)}°F)`;

  /* ---------------- 15. reel / wrap model (MDS1!K3:M47, F31:F39) --- */
  o.reelSP = inp.reelSP; o.reelHub = inp.reelHub; o.reelT = inp.reelT;
  o.wraps = [];
  if (o.jacketOD > 0) {
    let prevL = rDown(o.reelHub + o.jacketOD * 2, 0);                   // L4
    let cum   = ((o.reelHub * Math.PI) * (o.reelT / o.jacketOD)) / 12;   // M4
    o.wraps.push({ n:1, odTotal:prevL, lenFt:cum });
    for (let n = 2; n <= 44; n++) {
      const addFt = ((prevL * Math.PI) * (o.reelT / o.jacketOD)) / 12;   // M5..
      cum += addFt;
      prevL = rDown(prevL + o.jacketOD * 2, 0);                          // L5..
      o.wraps.push({ n, odTotal:prevL, lenFt:cum, addFt });
    }
  }
  const wrapPairs = o.wraps.map(w => [w.odTotal, w.lenFt]);
  o.reelCapacity = o.wraps.length ? vlookupApprox(o.reelSP, wrapPairs) : 0;   // VLOOKUP(E28,...)
  o.reelMax      = rUp(o.reelCapacity || 0, 0);                              // I37
  o.lenFinished  = Math.min(o.reelCapacity || 0, o.lengthFt);                // F37
  o.lenBraid     = o.lenFinished * 1.01;                                     // F34
  o.lenBase      = o.lenBraid + 10;                                          // F31
  o.reelWeight   = o.lenFinished * o.weightPerFt;                            // F39
  o.minD         = o.jacketOD ? o.reelHub / o.jacketOD : 0;                  // G27
  o.nReels       = o.lenBraid ? rUp(o.lengthFt / o.lenBraid, 0) : 0;          // WO!C18
  if (o.minD && o.minD < 20)
    warn.push(`Reel hub/OD ratio is ${o.minD.toFixed(1)}D — below the ≥20D minimum bend on the Reels sheet.`);

  /* ---------------- 16. CDS derived (CDS!E16:E26) ------------------- */
  o.minBendFt = 30 * o.jacketOD / 12;                                   // E20
  o.maxTension = o.tensileStrength * 0.4;                               // E22
  o.roughness = 0.00005;                                                // E21
  const fit = CDS_FITTINGS.find(r => r[0] === o.sizeKey);
  o.fitOD = fit ? fit[1] : null; o.fitID = fit ? fit[2] : null;

  // Missing prices must never read as a free material.
  [mL,mB,mK,mJ,mC].forEach(m => { if (m.noPrice && !m.missing) missingPrices.push(m.name); });
  if (missingPrices.length)
    warn.push("No price in the active price book for: " + [...new Set(missingPrices)].join(", ") +
              ". Those layers are costed at zero, so the total is understated.");
  o.missingPrices = [...new Set(missingPrices)];
  o.warnings = warn;
  return o;
}

/* =====================================================================
   solveSpool(s) — Spool Calculator sheet, deliberately standalone.
   ===================================================================== */
export function solveSpool(s) {
  const r = {}, warn = [];
  const P = SPOOL_PIPE[s.sizeKey] || {};
  r.sizeKey = s.sizeKey;
  r.od = P.od || 0;                      // C3
  r.id = P.id || 0;                      // C4
  r.psi = s.psi;                         // C5
  r.lengthFt = s.lengthFt;               // C6
  r.lengthM  = rnd(s.lengthFt / 3.28, 0);
  r.sp = s.sp; r.hub = s.hub; r.t = s.t; // B10 / C10 / E10
  r.wtPerFt = s.wtPerFt;                 // F14
  r.packing = s.packing;                 // I13

  r.minD = r.od ? r.hub / r.od : 0;      // D10 = C10/C3
  r.wraps = [];
  if (r.od > 0) {
    let prevL = rDown(r.hub + r.od * 2, 0);                   // L7
    let cum   = ((r.hub * Math.PI) * (r.t / r.od)) / 12;      // M7
    r.wraps.push({ n:1, odTotal:prevL, lenFt:cum, addFt:cum });
    for (let n = 2; n <= 44; n++) {
      const addFt = ((prevL * Math.PI) * (r.t / r.od)) / 12;  // M8..
      cum += addFt;
      prevL = rDown(prevL + r.od * 2, 0);                     // L8..
      r.wraps.push({ n, odTotal:prevL, lenFt:cum, addFt });
    }
  }
  const pairs = r.wraps.map(w => [w.odTotal, w.lenFt]);
  r.capacity     = vlookupApprox(r.sp, pairs) || 0;                       // VLOOKUP(B10,...)
  r.target       = Math.min(r.capacity, r.lengthFt);                      // F13
  r.targetM      = r.target / 3.28;                                       // F12
  r.derated      = r.target * r.packing;                                  // H13
  r.deratedM     = r.derated / 3.28;                                      // H11
  r.maxReelFt    = rUp(r.capacity, 0);                                    // E17
  r.maxReelM     = r.maxReelFt / 3.28;                                    // E18
  r.oneLessFt    = rUp(vlookupApprox(r.sp - r.od, pairs) || 0, 0);        // E19
  r.oneLessM     = r.oneLessFt / 3.28;                                    // E20
  r.spoolWeight  = r.target * r.wtPerFt;                                  // F15
  r.nReels       = r.target ? rUp(r.lengthFt / r.target, 0) : 0;
  r.burstTN      = r.psi * 1.84;                                          // AE11
  r.burstKN      = r.psi * 2.19;                                          // AE12
  r.hydro        = r.psi * 1.25;                                          // AD8

  if (r.minD && r.minD < 20) warn.push(`Hub/OD ratio is ${r.minD.toFixed(1)}D — below the ≥20D minimum bend.`);
  if (r.capacity < r.lengthFt) warn.push(`One reel holds ${Math.round(r.capacity).toLocaleString()} ft — the ${r.lengthFt.toLocaleString()} ft order needs ${r.nReels} reels.`);
  r.warnings = warn;
  return r;
}
