/* =====================================================================
   SRTP Pricing Tool v7 — lookup tables transcribed from the workbook
   Every table below names its source range on the Inputs sheet.
   ===================================================================== */

/* Inputs!N8:X24 — pipe size master table.
   key = N (nominal name, what Inputs!B5 holds)
   O=sizeOD  P=idIn  Q=linerID  R=specWT  S=odAlt  T=odSpec  U=label
   V=skinThk W=bondThk X=backerThk                                      */
const PIPE = {
  "6.8":       { O:6.8,  P:5.6,  Q:5.6,  R:0.405,  S:6.41,  T:null,  U:"",                           V:0.045, W:0.01, X:0.35   },
  "6":         { O:6.23, P:5.08, Q:5.08, R:0.385,  S:5.85,  T:6.23,  U:'6.0" Multi-layer',           V:0.045, W:0.01, X:0.33   },
  "5":         { O:5.18, P:4.31, Q:4.305,R:0.29,   S:4.885, T:5.18,  U:'5.0" Multi-Layer',           V:0.03,  W:0.01, X:0.25   },
  "4.5":       { O:4.65, P:3.83, Q:3.83, R:0.255,  S:4.35,  T:4.65,  U:'4.5" Multi-Layer',           V:0.03,  W:0.01, X:0.215  },
  "4":         { O:4.15, P:3.42, Q:3.42, R:0.23,   S:3.875, T:4.15,  U:'4.0" Multi-Layer',           V:0.025, W:0.01, X:0.195  },
  "3.5":       { O:3.65, P:2.95, Q:2.95, R:0.215,  S:3.55,  T:3.76,  U:'3.5" Multi-Layer',           V:0.025, W:0.01, X:0.18   },
  "3":         { O:3.15, P:2.52, Q:2.52, R:0.1725, S:2.865, T:3.17,  U:'3.0" Multi-Layer',           V:0.025, W:0.01, X:0.1375 },
  "2.875 DH":  { O:2.875,P:2.03, Q:2.03, R:0.23,   S:2.485, T:2.875, U:'2 7/8" Multi-Layer',         V:0.025, W:0.01, X:0.195  },
  "2.375 DH":  { O:2.375,P:1.68, Q:1.68, R:0.18,   S:1.55,  T:2.375, U:'2 3/8" Multi-Layer',         V:null,  W:null, X:null   },
  "2.375":     { O:2.45, P:1.88, Q:1.88, R:0.1525, S:2.185, T:2.375, U:'2 3/8" Multi-Layer',         V:0.02,  W:0.01, X:0.1225 },
  "2.375 LPG": { O:null, P:null, Q:1.68, R:0.2425, S:2.165, T:2.375, U:'2 3/8" Multi-Layer CGH',     V:0.02,  W:0.01, X:0.2125 },
  "2":         { O:null, P:null, Q:1.51, R:0.125,  S:1.76,  T:2.01,  U:'2.0" Multi-Layer',           V:0.02,  W:0.01, X:0.095  },
  "1.75":      { O:1.75, P:1.33, Q:1.22, R:0.165,  S:1.55,  T:1.76,  U:'1.75" Multi-Layer',          V:0.02,  W:0.01, X:0.135  },
  "1.5":       { O:1.5,  P:1.08, Q:1.08, R:0.1,    S:1.28,  T:1.5,   U:'1.5" Solid Wall',            V:0.02,  W:0.01, X:0.07   },
  "1.25":      { O:1.25, P:0.85, Q:0.88, R:0.08,   S:1.04,  T:1.25,  U:'1.25" Solid Wall',           V:0.02,  W:0.01, X:0.05   },
  "1":         { O:1,    P:0.62, Q:0.63, R:null,   S:null,  T:1,     U:'1"  Solid Wall',             V:0.02,  W:0.01, X:-0.03  }
};
const PIPE_ORDER = Object.keys(PIPE);

/* Inputs!AI28:AN38 — polymer master. cost = the live Inputs!J4:J15 price book. */
const MATERIALS = {
  "Nylon - 290":                            { sg:1.13, alt:"Nylon - 290 (Low Temp)",  comp:900,  acr:"PA" },
  "Nylon - 290Z":                           { sg:1.13, alt:"Nylon - 290Z (hi Temp)",  comp:900,  acr:"PA" },
  "PPS":                                    { sg:1.25, alt:"",  comp:null, acr:"PS" },
  "Admer":                                  { sg:0.92, alt:"Admer (Sweet)",  comp:null, acr:""   },
  "Lotader":                                { sg:0.92, alt:"Lotader (Sour)",  comp:null, acr:""   },
  "PERT":                                   { sg:0.95, alt:"",  comp:800,  acr:"PT" },
  "PP":                                     { sg:0.90, alt:"",  comp:1000, acr:"PP" },
  "PPUVHSWHHT - WashPenn PreBlended HT PP": { sg:0.96, alt:"", comp:null, acr:"PP" },
  "PPMBUVWH - White Color Concentrate":     { sg:0.90, alt:"",  comp:null, acr:""   },
  "PPMBUVYL - Yellow LPG":                  { sg:0.90, alt:"",  comp:null, acr:""   },
  "PVDF (Kynar)":                           { sg:1.87, alt:"", comp:null, acr:"PV" }
};


/* Inputs!N29:V41 — braid master.
   O=wtPerFtPerEnd  P=width  Q=strength  S=type  T=code  V=od
   R (cost) is deliberately absent - it comes from the price book. */
const BRAID = {
  "KN 15-1 (4 EndsUp - Xbraids)":  { wt:0.0005,  w:0.16, str:280, type:"Twaron (KN)",   code:"KN", od:0.036,  role:"X" },
  "KN 15-2 (4 Ends Up - Xbraids)": { wt:0.0010,  w:0.18, str:560, type:"Twaron (KN)",   code:"KN", od:0.0405, role:"X" },
  "KN 15-3 (4 Ends Up - Xbraids)": { wt:0.0015,  w:0.20, str:840, type:"Twaron (KN)",   code:"KN", od:0.045,  role:"X" },
  "KN 10-5 (4 EndsUp - Xbraids)":  { wt:0.0017,  w:0.14, str:880, type:"Twaron (KN)",   code:"KN", od:0.0315, role:"X" },
  "TN 15-1 (4 EndsUp - Xbraids)":  { wt:0.0005,  w:0.16, str:280, type:"Technora (TN)", code:"TN", od:0.036,  role:"X" },
  "TN 15-2 (4 Ends Up - Xbraids)": { wt:0.0010,  w:0.18, str:560, type:"Technora (TN)", code:"TN", od:0.0405, role:"X" },
  "TN 15-3 (4 Ends Up - Xbraids)": { wt:0.0015,  w:0.20, str:840, type:"Technora (TN)", code:"TN", od:0.045,  role:"X" },
  "KN 15-2 (4 Ends Up - Longs)":   { wt:0.0010,  w:0.18, str:560, type:"Twaron (KN)",   code:"KN", od:0.045,  role:"L" },
  "KN 15-3 (4 Ends Up - Longs)":   { wt:0.0015,  w:0.20, str:840, type:"Twaron (KN)",   code:"KN", od:0.05,   role:"L" },
  "KN 15-3 (6 Ends Up - Longs)":   { wt:0.00225, w:0.21, str:1260, type:"Twaron (KN)",   code:"KN", od:0.0525, role:"L" },
  "KN 10-5 (6 Ends Up - Longs)":   { wt:0.0025,  w:0.22, str:1320, type:"Twaron (KN)",   code:"KN", od:0.055,  role:"L" },
  "TN 15-3 (4 Ends Up - Longs)":   { wt:0.0015,  w:0.20, str:840, type:"Technora (TN)", code:"TN", od:0.05,   role:"L" },
  "TN 15-3 (6 Ends Up - Longs)":   { wt:0.00225, w:0.21, str:1260, type:"Technora (TN)", code:"TN", od:0.0525, role:"L" }
};
const XBRAIDS = Object.keys(BRAID).filter(k => BRAID[k].role === "X");
const LONGS   = Object.keys(BRAID).filter(k => BRAID[k].role === "L");

/* Inputs!M49:T71 — coupling master, keyed by coupling NAME (the N column),
   because Inputs!C106 does VLOOKUP(couplingName, N49:S71, 3, 0).         */
const COUPLING_BY_NAME = {
  "1.25in - 3 Ribs":  { insert:1.25, stem:4.00,  ribs:3, odPost:1.25,  idIns:0.65,  maxP:750  },
  "1.25in - 5 Ribs":  { insert:1.25, stem:4.75,  ribs:5, odPost:1.25,  idIns:0.65,  maxP:3000 },
  "1.5in - 3 Ribs":   { insert:1.5,  stem:3.95,  ribs:3, odPost:1.49,  idIns:0.87,  maxP:750  },
  "1.75in - 3 Ribs":  { insert:1.75, stem:3.90,  ribs:3, odPost:1.74,  idIns:1.06,  maxP:750  },
  "2in - 4 Ribs":     { insert:2,    stem:4.85,  ribs:4, odPost:1.99,  idIns:1.195, maxP:2500 },
  "2.375in - 4 Ribs": { insert:2.375,stem:4.474, ribs:4, odPost:2.41,  idIns:1.5,   maxP:5000 },
  "2.625in - 5 Ribs": { insert:2.625,stem:5.49,  ribs:5, odPost:2.625, idIns:1.5,   maxP:5000 },
  "2.875in - 5 Ribs": { insert:2.875,stem:5.61,  ribs:5, odPost:2.875, idIns:1.5,   maxP:5000 },
  "3in - 3 Ribs":     { insert:3,    stem:3.974, ribs:3, odPost:3,     idIns:2.12,  maxP:750  },
  "3in - 4 Ribs":     { insert:3,    stem:5.00,  ribs:4, odPost:3,     idIns:2.12,  maxP:3000 },
  "3.5in - 4 Ribs":   { insert:3.5,  stem:6.35,  ribs:4, odPost:3.5,   idIns:2.4,   maxP:750  },
  "3.5in - 8 Ribs":   { insert:3.5,  stem:9.20,  ribs:8, odPost:3.5,   idIns:2.4,   maxP:3000 },
  "4in - 3 Ribs":     { insert:3,    stem:3.974, ribs:3, odPost:3,     idIns:2.12,  maxP:500  },
  "4in - 4 Ribs":     { insert:4,    stem:5.21,  ribs:4, odPost:4,     idIns:2.75,  maxP:750  },
  "4in - 8 Ribs":     { insert:4,    stem:8.50,  ribs:8, odPost:4,     idIns:2.75,  maxP:3000 },
  "4.5in - 4 Ribs":   { insert:4.5,  stem:5.27,  ribs:4, odPost:4.5,   idIns:3.13,  maxP:750  },
  "4.5in - 8 Ribs":   { insert:4.5,  stem:8.50,  ribs:8, odPost:4.5,   idIns:3.13,  maxP:3000 },
  "5in - 4 Ribs":     { insert:5,    stem:4.99,  ribs:4, odPost:5.1,   idIns:3.67,  maxP:750  },
  "5in - 8 Ribs":     { insert:5,    stem:7.75,  ribs:8, odPost:5.1,   idIns:3.67,  maxP:5000 },
  "6in - 5 Ribs":     { insert:6,    stem:6.12,  ribs:5, odPost:6.1,   idIns:4.35,  maxP:750  },
  "6in - 8 Ribs":     { insert:6,    stem:7.75,  ribs:8, odPost:6.1,   idIns:4.35,  maxP:3000 }
};

/* Inputs!M74:T90 — coupling selected when Design Pressure > 750 psi. */
const COUPLING_HI = {
  "6.8":"6in - 8 Ribs", "6":"6in - 8 Ribs", "5":"5in - 8 Ribs", "4.5":"4.5in - 8 Ribs",
  "4":"4in - 8 Ribs", "3.5":"3.5in - 8 Ribs", "3":"3in - 4 Ribs",
  "2.875 DH":"2.875in - 5 Ribs", "2.375 DH":"2.375in - 4 Ribs", "2.375":"2.375in - 4 Ribs",
  "2.375 LPG":"2.375in - 4 Ribs", "2":"2in - 4 Ribs",
  "1.75":"1.75in - 3 Ribs", "1.5":"1.5in - 3 Ribs", "1.25":"1.25in - 5 Ribs", "1":null
};
/* Inputs!M92:T108 — coupling selected when Design Pressure <= 750 psi. */
const COUPLING_LO = {
  "6.8":"6in - 5 Ribs", "6":"6in - 5 Ribs", "5":"5in - 4 Ribs", "4.5":"4.5in - 4 Ribs",
  "4":"4in - 4 Ribs", "3.5":"3.5in - 4 Ribs", "3":"3in - 3 Ribs",
  "2.875 DH":"2.875in - 5 Ribs", "2.375 DH":"2.375in - 4 Ribs", "2.375":"2.375in - 4 Ribs",
  "2.375 LPG":"2.375in - 4 Ribs", "2":"2in - 4 Ribs",
  "1.75":"1.75in - 3 Ribs", "1.5":"1.5in - 3 Ribs", "1.25":"1.25in - 3 Ribs", "1":null
};
/* OD post-swage override tables (M74:R90 / M92:R108) differ from the generic
   table for a few sizes; CDS reads the post-swage OD from the pipe size.    */
const COUPLING_OD_POST = {
  hi:{ "6.8":6.23,"6":6.23,"5":5.18,"4.5":4.65,"4":4,"3.5":3.5,"3":3.15,
       "2.875 DH":2.875,"2.375 DH":2.375,"2.375":2.41,"2.375 LPG":2.41,"2":1.99,
       "1.75":1.75,"1.5":1.5,"1.25":1.25 },
  lo:{ "6.8":6.23,"6":6.23,"5":5.1,"4.5":4.5,"4":4,"3.5":3.5,"3":3.15,
       "2.875 DH":2.875,"2.375 DH":2.41,"2.375":2.41,"2.375 LPG":2.41,"2":1.99,
       "1.75":1.74,"1.5":1.49,"1.25":1.25 }
};

/* CDS!L6:N23 — fittings reference (nominal pipe -> OD post swage, insert ID). */
const CDS_FITTINGS = [
  ["6.8",6.8,4.97],["6",6.23,4.35],["5",5.18,3.67],["4.5",4.65,3.13],["4",4,2.75],
  ["3.5",3.5,2.4],["3",3.15,2.12],["2.875 DH",2.875,1.5],["2.375 DH",2.375,1.5],
  ["2.375",2.41,1.5],["2.375 LPG",2.41,1.5],["2",1.99,1.195],["1.75",1.75,1.06],
  ["1.5",1.5,0.87],["1.25",1.25,0.65],["1",null,null]
];

/* ---- material selection matrices (Inputs!AI1:AP25) -------------------- */
const TEMPS = [150, 185, 196, 221];
const SERVICES = ["Oil ", "Water", "Gas"];           // the Inputs!AJ3:AL3 header order
const LINER_SWEET = {                                 // AI4:AL7
  150:["Nylon - 290","PP","Nylon - 290"],
  185:["Nylon - 290","PP","Nylon - 290"],
  196:["PPS","PPS","PPS"],
  221:["PPS","PPS","PPS"]
};
const LINER_SOUR = {                                  // AM4:AP7
  150:["PPS","PPS","PPS"],
  185:["Select 196°F","Select 196°F","Select 196°F"],
  196:["PPS","PPS","PPS"],
  221:["PPS","PPS","PPS"]
};
const BOND_BY_LINER = {                               // AI10:AJ13
  "Nylon - 290":"Admer", "PPS":"Lotader", "PP":"PP", "Select 196°F":"Select 196°F"
};
const BACKER_SWEET = { 150:"PP", 185:"PP", 196:"PERT", 221:"Nylon - 290Z" };            // AI16:AJ19
const BACKER_SOUR  = { 150:"PERT", 185:"Select 196°F", 196:"PERT", 221:"Nylon - 290Z" }; // AM16:AN19
const JACKET_SWEET = { 150:"PP", 185:"PP", 196:"PP",
                       221:"PPUVHSWHHT - WashPenn PreBlended HT PP" };                  // AI22:AJ25
const JACKET_SOUR  = { 150:"PP", 185:"Select 196°F", 196:"PP",
                       221:"PPUVHSWHHT - WashPenn PreBlended HT PP" };                  // AM22:AN25
const BRAID_FAMILY_BY_TEMP = { 150:"Twaron (KN)", 185:"Technora (TN)",
                               196:"Technora (TN)", 221:"Technora (TN)" };              // AC2:AD5

/* MDS1!O33:P46 — API nominal size from liner ID (approximate VLOOKUP). */
const API_NOMINAL = [
  [0.75,1],[1,1.25],[1.25,1.5],[1.75,2],[2.25,2.5],[2.5,3],
  [3,3.5],[3.5,4],[4,4.5],[4.5,5],[5,5.5],[7.5,8]
];

/* MDS1!O4:Q8 — reel hardware option lists. */
const REEL_SP  = [42,60,96,124,144,174,191];
const REEL_HUB = [30,43,60,72,76,80,84,88,92,96,100,104,108,112,116,120,
                  140,144,148,152,156,158,159,160,172,176,180];
const REEL_T   = [44.5,48,56,80,92];

/* Inputs!AH3:AH146 — the sanctioned braid pitch ladder: 1.15" to 8.30" in 0.05" steps. */
const PITCH_LADDER = (() => { const a=[]; for (let v=1.15; v<=8.3001; v+=0.05) a.push(Math.round(v*100)/100); return a; })();

/* Inputs!AA1:AA10 — service-life ladder. */
const SERVICE_LIFE = [19.5,20,30,40,50,60,70];

/* ---------------- Spool Calculator (own, independent tables) ------------ */
/* Spool Calculator!X7:Z18 */
const SPOOL_PIPE = {
  "6.8":{od:6.8, id:5.6 }, "6":{od:6.23,id:5.08}, "5":{od:5.18,id:4.31},
  "4.5":{od:4.65,id:3.83}, "4":{od:4.15,id:3.42}, "3.5":{od:3.5, id:2.95},
  "3":{od:3.05,id:2.52},   "2.375":{od:2.375,id:1.88}, "1.75":{od:1.75,id:1.33},
  "1.5":{od:1.5,id:1.08},  "1.25":{od:1.25,id:0.85},   "1":{od:1,id:0.62}
};
/* Spool Calculator!O7:Q33 */
const SPOOL_SP  = [42,48,51,54,57,60,84,90,96,124,144,174,180,183,190,191];
const SPOOL_HUB = [34,36,40,42,36,68,72,76,80,84,88,92,96,100,104,108,112,116,120,
                   132,140,144,147,148,152,160,161,162,172,183];
const SPOOL_T   = [48,51,56,80,92,120,132];
/* Spool Calculator!B23:G29 — shipped reel reference rows. */
const SPOOL_REF = [
  ["LP1025, 500psi","SP42-HD30-T48","644 m","521 m","400 m","24"],
  ["LP1050, 500psi","SP54-HD40-T48","455 m","455 m","400 m","28"],
  ["LP1050, 500psi","SP96-HD42-T48","3,103 m","2,865 m","2,800 m","28"],
  ["LP2375, 500psi","SP96-HD68-T56","1,022 m","881 m","800 m","28.6"],
  ["LP1050, 500psi","SP60-HD42-T48","759 m","613 m","400 m","28"]
];
/* Spool Calculator!AD6:AH8 — measured elongation / OD growth at pressure. */
const SPOOL_STRAIN = [
  ["Start",            10,     null, 3.15, null],
  ["MAOP",             10.051, null, 3.16, null],
  ["MAOP x 1.25 (Hydro)",10.0575, null, 3.18, null]
];

/* MDS1!Y14:AB18 — LPG print-code table. */
const LPG_CODES = {
  1.25:["LP1025",500,null], 1.5:["LP1050",1200,"DN25"], 1.75:["LP1075",500,null],
  2.375:["LP2375",500,"DN48"]
};

/* ---------------------------------------------------------------------
   ES module surface. Note what is NOT here: prices. Every $/lb figure
   lives in Supabase (price_book_items) and is injected at runtime, which
   is what lets this repository be public.
   --------------------------------------------------------------------- */
export {
  PIPE, PIPE_ORDER, MATERIALS, BRAID, XBRAIDS, LONGS,
  COUPLING_BY_NAME, COUPLING_HI, COUPLING_LO, COUPLING_OD_POST, CDS_FITTINGS,
  TEMPS, SERVICES, LINER_SWEET, LINER_SOUR, BOND_BY_LINER,
  BACKER_SWEET, BACKER_SOUR, JACKET_SWEET, JACKET_SOUR, BRAID_FAMILY_BY_TEMP,
  API_NOMINAL, REEL_SP, REEL_HUB, REEL_T, PITCH_LADDER, SERVICE_LIFE,
  SPOOL_PIPE, SPOOL_SP, SPOOL_HUB, SPOOL_T, SPOOL_REF, SPOOL_STRAIN, LPG_CODES
};

/* Inputs!AG2:AG45 — longs are fitted in four equal quadrants (Inputs!A114),
   so the quantity steps in fours. The workbook offers this as a ladder, not
   a free number, which is why the input is a dropdown here too. */
export const LONGS_LADDER = (() => { const a=[]; for (let q=4; q<=200; q+=4) a.push(q); return a; })();
