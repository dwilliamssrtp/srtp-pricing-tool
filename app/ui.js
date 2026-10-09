/* =====================================================================
   SRTP Pricing Tool v7 — UI layer
   ===================================================================== */
import {
  PIPE, PIPE_ORDER, MATERIALS, BRAID, XBRAIDS, LONGS, COUPLING_BY_NAME,
  TEMPS, API_NOMINAL, REEL_SP, REEL_HUB, REEL_T, PITCH_LADDER, SERVICE_LIFE,
  SPOOL_PIPE, SPOOL_SP, SPOOL_HUB, SPOOL_T
} from "./data.js?v=20261009-1405";
import { solve, solveSpool, matKey } from "./engine.js?v=20261009-1405";
import * as DB from "./db.js?v=20261009-1405";
import { initPages } from "./pages.js?v=20261009-1405";
import * as PARTSUI from "./partsui.js?v=20261009-1405";
import * as QUOTESUI from "./quotesui.js?v=20261009-1405";

/* The active price book and its prices, filled in at sign-in. */
let BOOK = null;
let SHEET_ROWS = [];              // full price sheet for the current book, incl. unpriced
let PRICES = { polymer: {}, braid: {}, coupling: {} };
let ME = null;                 // the signed-in profile
let BOOKS = [];                // all books this user may see
let CURRENT_DESIGN = null;     // {id,name,client} when a saved design is open
let PAGES = null;              // top-level page controller, created at boot
const BUILD = "20261009-1405";           // stamped by bump.ps1 so a deploy is identifiable

/* ---------- formatting helpers ---------- */
const f = (v, d=2) => (v === null || v === undefined || v === "" || Number.isNaN(v))
  ? "—" : Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
const f0 = v => f(v,0), f3 = v => f(v,3), f4 = v => f(v,4);
const money = (v,d=2) => (v===null||v===undefined||Number.isNaN(v)) ? "—" : "$"+f(v,d);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const pct = (v,d=1) => (v===null||v===undefined||Number.isNaN(v)) ? "—" : f(v*100,d)+"%";

/* tbl(headers, rows) — rows are arrays of {v, n, cls, span} or plain values. */
function tbl(head, rows, opts={}) {
  const h = head ? "<thead><tr>" + head.map(x => {
    const o = (typeof x === "object") ? x : {t:x};
    return `<th${o.n?' class="n"':''}${o.span?` colspan="${o.span}"`:""}>${esc(o.t)}</th>`;
  }).join("") + "</tr></thead>" : "";
  const b = "<tbody>" + rows.map(r => {
    if (r === "-") return `<tr><td colspan="${head?head.length:9}" style="padding:0;border-left:0;border-right:0"></td></tr>`;
    if (r && r.group) return `<tr class="grp2"><td colspan="${head?head.length:9}">${esc(r.group)}</td></tr>`;
    const cls = r && r.cls ? ` class="${r.cls}"` : "";
    const cells = (r && r.cells ? r.cells : r);
    return `<tr${cls}>` + cells.map(c => {
      const o = (c !== null && typeof c === "object") ? c : {v:c};
      const k = [o.n ? "n" : "", o.k ? "k" : "", o.cls || ""].filter(Boolean).join(" ");
      return `<td${k?` class="${k}"`:""}${o.span?` colspan="${o.span}"`:""}>${o.raw ? o.v : esc(o.v)}</td>`;
    }).join("") + "</tr>";
  }).join("") + "</tbody>";
  return `<div class="tw"><table${opts.cls?` class="${opts.cls}"`:""}>${h}${b}</table></div>`;
}
const tiles = arr => arr.map(t =>
  `<div class="tile${t.cls?" "+t.cls:""}"><em>${esc(t.k)}</em><b>${t.raw?t.v:esc(t.v)}</b>${t.s?`<s>${esc(t.s)}</s>`:""}</div>`
).join("");

/* =====================================================================
   state
   ===================================================================== */
const DEFAULTS = {
  client:"Test", lengthFt:1000, sizeKey:"2.875 DH", psi:3000, degF:221,
  service:"Oil ", sour:"Sweet", color:"White", years:20, app:"Flowline",
  xbraid:"TN 15-3 (4 Ends Up - Xbraids)", pitch:2.30, passes:1,
  longs:"TN 15-3 (6 Ends Up - Longs)", longsQty:40,
  tBraid:"KN 15-1 (4 EndsUp - Xbraids)", tPitch:8, tPasses:1,
  colorPct:0.03, margin:0.50,
  reelSP:144, reelHub:108, reelT:80,
  priceBookId:null
};
const SPOOL_DEFAULTS = {
  sizeKey:"4.5", psi:3000, lengthFt:25500, sp:144, hub:120, t:92,
  wtPerFt:4.36, packing:0.886973
};
let I = { ...DEFAULTS }, S = { ...SPOOL_DEFAULTS }, R = null, SR = null, TAB = "TDS";

const LS = "srtp-pricing-v7";
function save(){ try{ localStorage.setItem(LS, JSON.stringify({I,S,TAB})); }catch(e){} }
function load(){
  try{ const d = JSON.parse(localStorage.getItem(LS)||"null");
    if(d){ I={...DEFAULTS,...d.I}; S={...SPOOL_DEFAULTS,...d.S}; TAB=d.TAB||TAB; } }catch(e){}
}

/* =====================================================================
   input section  (Inputs!A1:C17)
   ===================================================================== */
function field(label, key, kind, extra={}) {
  const id = "in_"+key, v = I[key];
  let ctl;
  if (kind === "select") {
    ctl = `<select id="${id}" data-k="${key}">` + extra.opts.map(o => {
      const [val,txt] = Array.isArray(o) ? o : [o,o];
      return `<option value="${esc(val)}"${String(val)===String(v)?" selected":""}>${esc(txt)}</option>`;
    }).join("") + `</select>`;
  } else {
    ctl = `<input id="${id}" data-k="${key}" type="number" value="${v}"${
      extra.step!==undefined?` step="${extra.step}"`:""}${extra.min!==undefined?` min="${extra.min}"`:""}>`;
  }
  return `<label for="${id}">${label}</label>${ctl}<div class="u">${extra.unit||""}</div>`;
}
/* A read-only read-out. It is written once with an id, then refreshed in place by
   updateDerived() — never by re-rendering the grid, which would destroy the control
   the user is typing in and reset their caret. */
const derived = (label, id, val, unit="") =>
  `<label>${esc(label)}</label><div class="derived" id="${id}" title="${esc(val)}">${esc(val)}</div><div class="u">${esc(unit)}</div>`;

function derivedValues(r) { return {
  d_lengthM:   f0(r.lengthM),
  d_bar:       f0(r.bar),
  d_degC:      f0(r.degC),
  d_hs:        r.h2s + " | " + r.co2,
  d_coupling:  r.couplingName || "no coupling tabulated",
  d_minPitch:  f(r.minPitch),
  d_maxLongs:  f0(r.maxLongs),
  d_longsPred: f(r.longsPrediction, 1),
  d_minD:      f(r.minD, 1) + "D"
};}
function updateDerived(r) {
  const v = derivedValues(r);
  for (const id in v) {
    const e = document.getElementById(id);
    if (e) { e.textContent = v[id]; e.title = v[id]; }
  }
  const g = document.getElementById("grp24t");
  if (g) g.innerHTML = "24-Tensile layer " +
    (I.app === "24-Tensile" ? "" : "&mdash; inactive, Application is " + esc(I.app));
}

function renderInputs() {
  const r = R;
  document.getElementById("inputGrid").innerHTML = [
    `<div class="grp">Project information &mdash; design date ${new Date().toLocaleDateString()}</div>`,
    `<label for="in_client">Client Name</label>
     <input id="in_client" data-k="client" type="text" value="${esc(I.client)}" style="grid-column:2/-1">`,
    field("Application Request","lengthFt","num",{unit:"ft",min:1}),
    derived(" ","d_lengthM",f0(r.lengthM), "m"),
    field("SRTP Pipe Size","sizeKey","select",{opts:PIPE_ORDER,unit:"in"}),
    field("Pipe Pressure","psi","num",{unit:"psi",min:1}),
    derived(" ","d_bar",f0(r.bar), "bar"),
    field("Pipe Temp","degF","select",{opts:TEMPS,unit:"°F"}),
    derived(" ","d_degC",f0(r.degC), "°C"),
    field("Service (fluid)","service","select",{opts:[["Oil ","Oil"],["Water","Water"],["Gas","Gas"]]}),
    field("Service (sour)","sour","select",{opts:["Sweet","Sour"]}),
    derived(" ","d_hs", r.h2s+" | "+r.co2),
    field("Application","app","select",{opts:["Flowline","24-Tensile","Downhole","LPG"]}),
    field("Jacket Color","color","select",{opts:["White","Yellow"]}),
    field("Years of Service","years","select",{opts:SERVICE_LIFE,unit:"yr"}),
    derived("Select Coupling Size","d_coupling", r.couplingName || "no coupling tabulated"),

    `<div class="grp">Reinforcement</div>`,
    field("X-braid (hoop)","xbraid","select",{opts:XBRAIDS}),
    field("Pitch","pitch","select",{opts:PITCH_LADDER,unit:"in"}),
    derived("Minimum pitch (braid width × 12)","d_minPitch", f(r.minPitch), "in"),
    field("Number of Passes","passes","select",{opts:[1,2,3]}),
    field("Longs (longitudinal)","longs","select",{opts:LONGS}),
    field("Longs Qty / Reel","longsQty","num",{min:1,unit:"ea"}),
    derived("Max longs that fit","d_maxLongs", f0(r.maxLongs), "ea"),
    derived("Longs prediction (Inputs!B52)","d_longsPred", f(r.longsPrediction,1), "ea"),

    `<div class="grp" id="grp24t">24-Tensile layer ${I.app==="24-Tensile"?"":"&mdash; inactive, Application is "+esc(I.app)}</div>`,
    field("Tensile braid","tBraid","select",{opts:XBRAIDS}),
    field("Tensile pitch","tPitch","num",{step:0.5,min:0.5,unit:"in"}),
    field("Tensile passes","tPasses","select",{opts:[1,2,3]}),

    `<div class="grp">Reel (MDS1!D28:I28)</div>`,
    field("Spool flange OD &mdash; SP","reelSP","select",{opts:REEL_SP,unit:"in"}),
    field("Hub diameter &mdash; HD","reelHub","select",{opts:REEL_HUB,unit:"in"}),
    field("Traverse &mdash; T","reelT","select",{opts:REEL_T,unit:"in"}),
    derived("Min bend ratio (HD / jacket OD)","d_minD", f(r.minD,1)+"D"),

    `<div class="grp">Commercial</div>`,
    field("Color masterbatch %","colorPct","num",{step:0.005,min:0,unit:"frac"}),
    field("Target margin","margin","num",{step:0.01,min:0,unit:"frac"}),
  ].join("");
}

/* =====================================================================
   display section
   ===================================================================== */
function renderDisplay() {
  const r = R;
  document.getElementById("hdkpi").innerHTML = [
    ["Cost $/ft", money(r.costPerFt)],
    ["Sell $/ft", money(r.sellPerFt)],
    ["lb/ft", f3(r.weightPerFt)],
    ["Burst", f0(r.burstTotal)+" psi"],
    ["Reels", f0(r.nReels)]
  ].map(([k,v]) => `<div><em>${k}</em><b>${v}</b></div>`).join("");

  document.getElementById("prodName").textContent = r.productName;

  document.getElementById("headTiles").innerHTML = tiles([
    { k:"Cost ($/ft)",            v:money(r.costPerFt),  cls:"big", s:"Inputs!G5" },
    { k:"50% Target Price ($/ft)",v:money(r.targetPrice),           s:"Inputs!H5" },
    { k:"Target Price ($/m)",     v:money(r.targetPriceM),          s:"Inputs!H6" },
    { k:"Weight (lbs/ft)",        v:f3(r.weightPerFt),              s:"Inputs!G6" },
    { k:"ID (in)",                v:f(r.linerID),                   s:"Inputs!G7" },
    { k:"OD (in)",                v:f(r.jacketOD),                  s:"Inputs!G8" },
    { k:"Wall (in)",              v:f3(r.jacketThk),                s:"Inputs!G9" },
    { k:"RTP Specific Gravity",   v:f3(r.rtpSG),                    s:"Inputs!G10" },
    { k:`Sell @ ${pct(r.margin,0)} margin`, v:money(r.sellPerFt)+"/ft", s:money(r.sellPerM)+"/m" },
    { k:"Project price",          v:money(r.projectPrice,0),        s:f0(r.lengthFt)+" ft · cost "+money(r.projectCost,0) }
  ]);

  document.getElementById("dispTiles").innerHTML = tiles([
    { k:"Burst strength",            v:f0(r.burstTotal)+" psi", cls:r.burstTotal>=r.targetBurstR?"ok":"bad", s:"Inputs!E21" },
    { k:"Target burst design (.67 SF)", v:f0(r.targetBurstR)+" psi", s:"Inputs!A21" },
    { k:"SF added",                  v:f0(r.sfAdded)+" psi", cls:r.sfAdded>=0?"ok":"bad", s:pct(r.sfAddedPct)+" of MAOP" },
    { k:"Min burst (API)",           v:f0(r.minBurst)+" psi", s:(r.xbraid||"").slice(0,2)==="KN"?"MAOP × 2.31":"MAOP × 2.00" },
    { k:"FAT min burst (no SF)",     v:f0(r.shortBurst)+" psi", s:"Inputs!B73" },
    { k:"Field hydrotest",           v:f0(r.hydroP)+" psi", s:"MAOP × "+f(r.hydroFactor,2) },
    { k:"Aramco +400",               v:f0(r.aramco400)+" psi", s:"Inputs!B74" },
    { k:"Braid angle",               v:f(r.braidAngle,2)+"°", s:"Inputs!C56" },
    { k:"Tensile strength",          v:f0(r.tensileStrength)+" lbs", s:"Inputs!G11" },
    { k:"Strain/weight ratio",       v:pct(r.strainRatio), cls:r.strainRatio<0.35?"ok":"bad", s:"target < 35%" },
    { k:"Coupling fibre load",       v:pct(r.fiberRatio), cls:r.fiberRatio<0.30?"ok":"bad", s:"target ≤ 30%" },
    { k:"Reel capacity",             v:f0(r.lenFinished)+" ft", s:f0(r.nReels)+" reel(s) · max "+f0(r.reelMax)+" ft" }
  ]);

  const vd = (txt, good) => ({ v:`<span class="${good?"ok":"bad"}">${esc(txt)}</span>`, raw:true });
  document.getElementById("checksTbl").innerHTML = tbl(["Check","Value","Verdict","Cell"], [
    ["Target Burst Design Pressure (.67 SF)", {v:f0(r.targetBurstR)+" psi",n:1},
      vd(r.burstTotal>=r.targetBurstR?"Met":"Short", r.burstTotal>=r.targetBurstR), {v:"A21",cls:"ref"}],
    ["Burst Strength achieved", {v:f0(r.burstTotal)+" psi",n:1}, {v:""}, {v:"E21",cls:"ref"}],
    ["SF added over target", {v:f0(r.sfAdded)+" psi",n:1},
      vd(r.sfAdded>=0?"Positive":"Negative", r.sfAdded>=0), {v:"A24",cls:"ref"}],
    ["Recommended min SF gap (11%)", {v:f0(r.recMinSF)+" psi",n:1}, {v:""}, {v:"F31",cls:"ref"}],
    ["Coupling Selection (fibre vs backer yield)", {v:pct(r.fiberRatio),n:1},
      vd(r.couplingVerdict, r.couplingVerdict==="Good"), {v:"C119",cls:"ref"}],
    ["Downhole Use (adds suspended weight)", {v:pct(r.dhRatio),n:1},
      vd(r.dhVerdict, r.dhVerdict==="Good"), {v:"C129",cls:"ref"}],
    ["Long Term Strain/Weight Ratio", {v:pct(r.strainRatio),n:1},
      vd(r.strainVerdict, r.strainRatio<0.35), {v:"G21",cls:"ref"}],
    ["Target Ratio (load on fibres / comp. yield)", {v:pct(r.fiberRatio),n:1},
      vd(r.fiberRatio<0.30?"≤30%":">30%", r.fiberRatio<0.30), {v:"B21",cls:"ref"}],
    ["Longs fitted vs max that fit", {v:`${f0(r.longsQty)} / ${f0(r.maxLongs)}`,n:1},
      vd(r.longsQty<=r.maxLongs?"Fits":"Over", r.longsQty<=r.maxLongs), {v:"G106",cls:"ref"}],
    ["Pitch vs minimum", {v:`${f(r.pitch)}" / ${f(r.minPitch)}"`,n:1},
      vd(r.pitch>=r.minPitch?"OK":"Too tight", r.pitch>=r.minPitch), {v:"F82",cls:"ref"}],
    ["Reel min bend ratio (≥20D)", {v:f(r.minD,1)+"D",n:1},
      vd(r.minD>=20?"OK":"Too tight", r.minD>=20), {v:"G27",cls:"ref"}],
    ["Coupling pressure rating", {v:f0(r.couplingMaxP)+" psi",n:1},
      vd(r.psi<=r.couplingMaxP?"OK":"Exceeded", r.psi<=r.couplingMaxP), {v:"B12",cls:"ref"}]
  ]);

  const L = (n,w,p,c) => [, {v:f4(w),n:1}, {v:money(p,3),n:1}, {v:money(c,4),n:1},
                          {v:money(c*r.lengthFt,0),n:1}];
  document.getElementById("costTbl").innerHTML = tbl(
    ["Layer","lbs/ft","$/lb","$/ft",{t:"Project $",n:1}], [
    {group:"Base tube — Inputs!A34:I38"},
    L(r.base[0].name, r.base[0].wt, r.base[0].price, r.base[0].cost),
    L(r.base[1].name, r.base[1].wt, r.base[1].price, r.base[1].cost),
    L(r.base[2].name, r.base[2].wt, r.base[2].price, r.base[2].cost),
    {group:"Reinforcement — Inputs!A47:I50"},
    L(r.longsName, r.longsWt, r.longsPrice, r.longsCost),
    L(r.xbraid + ` · ${r.passes} pass | ${f(r.pitch)} pitch`, r.xWt, r.xPrice, r.xCost),
    ...(r.is24T ? [L("24-Tensile · "+r.tBraid, r.tWt, r.tPrice, r.tCost)] : []),
    {group:"Jacket — Inputs!A41:I44"},
    L(r.jacket, r.jacketWt, r.jacketPrice, r.jacketCost),
    L(r.colorMB, r.colorWt, r.colorPrice, r.colorCost),
    {cls:"tot", cells:["Total", {v:f4(r.weightPerFt),n:1}, {v:"",n:1},
      {v:money(r.costPerFt,4),n:1}, {v:money(r.projectCost,0),n:1}]},
    {cls:"tot", cells:[`Sell @ ${pct(r.margin,0)} margin`, {v:"",n:1}, {v:"",n:1},
      {v:money(r.sellPerFt,4),n:1}, {v:money(r.projectPrice,0),n:1}]}
  ]);

  document.getElementById("warns").innerHTML = r.warnings.length
    ? r.warnings.map(w => `<li>${esc(w)}</li>`).join("")
    : `<li style="background:color-mix(in srgb,var(--ok) 12%,var(--card));border-color:color-mix(in srgb,var(--ok) 45%,var(--line));border-left-color:var(--ok)">All design checks pass.</li>`;
}

/* =====================================================================
   sheet renderers
   ===================================================================== */
const SHEETS = ["TDS","MDS","MDS (2)","CDS","MDS1","WO","Materials","Trace"];

function renderTabs() {
  document.getElementById("tabs").innerHTML = SHEETS.map(s =>
    `<button role="tab" data-tab="${esc(s)}" aria-selected="${s===TAB}">${esc(s)}</button>`).join("");
}

function sheetTDS(r) {
  const h = tbl(null, [
    [{v:"Application",k:1},{v:r.app},{v:"SRTP Pipe Size",k:1},
     {v:`${r.sizeKey} (in) | ${f(r.jacketOD)} OD | ${f(r.linerID)} ID | ${f3(r.weightPerFt)} lbs/ft`,span:3}],
    [{v:"Design Pressure",k:1},{v:f0(r.psi)+" psi"},{v:"Design Temperature",k:1},
     {v:`${f0(r.degC)}°C | ${f0(r.degF)}°F`,span:3}],
    [{v:"Burst Pressure",k:1},{v:f0(r.targetBurstR)+" psi"},{v:`${f0(r.years)} Years of Service`,k:1},
     {v:`${r.sour} ${r.service.trim()} | ${r.h2s} | ${r.co2}`,span:3}],
    [{v:"Field HydroTest Pressure",k:1},{v:f0(r.hydroP)+" psi"},{v:"Length",k:1},
     {v:`${f0(r.lengthFt)} ft | ${f0(r.lengthM)} m`,span:3}],
    [{v:"Project",k:1},{v:r.client||"—",span:5}]
  ]);
  const layer = (n, name, wt, price) => [
    {v:n,n:1}, ,{v:f4(wt)+" lbs/ft",n:1},
    {v:f0(Math.ceil(wt*r.lengthFt))+" lbs",n:1},{v:money(price,3),n:1}];
  const body = tbl(["#","Layer / Material",{t:"Theoretical",n:1},{t:"Project Weight",n:1},{t:"Price ($/lb)",n:1}], [
    {group:"1 · Base"},
    layer(1, r.base[0].name, r.base[0].wt, r.base[0].price),
    layer("", r.base[1].name, r.base[1].wt, r.base[1].price),
    layer("", r.base[2].name, r.base[2].wt, r.base[2].price),
    {group:"2 · Longitudinal Reinforcement"},
    layer(2, r.longsName, r.longsWt, r.longsPrice),
    {group:"3 · Hoop Reinforcement"},
    layer(3, r.xbraid, r.xWt, r.xPrice),
    ...(r.is24T ? [{group:"3b · 24-Tensile"}, layer("", r.tBraid, r.tWt, r.tPrice)] : []),
    {group:"4 · Jacket"},
    layer(4, r.jacket, r.jacketWt, r.jacketPrice),
    layer("", r.colorMB, r.colorWt, r.colorPrice),
    {cls:"tot",cells:["","Total",{v:f4(r.weightPerFt)+" lbs/ft",n:1},
      {v:f0(Math.ceil(r.weightPerFt*r.lengthFt))+" lbs",n:1},{v:money(r.costPerFt)+"/ft",n:1}]}
  ]);
  return `<h4>Technical Datasheet &mdash; TDS!B1:F16</h4>${h}<div style="height:14px"></div>${body}`;
}

function mdsBlock(r, fatBurst, reelHub, cellRef) {
  const geo = tbl(["#","Layer",{t:"Weight",n:1},"Oval.",{t:"Thick.",n:1},"Tol.",{t:"ID",n:1},"Tol.",{t:"OD",n:1},"Tol."], [
    {group:"1 · Base Tube"},
    [{v:1,n:1},"Base Tube",{v:"",n:1},"0-5%",{v:f3(r.specWT),n:1},'±0.01"',
     {v:f3(r.linerID),n:1},'±0.01"',{v:f3(r.baseOD),n:1},"Tgt."],
    [{v:"",n:1}, ,{v:f(r.base[0].wt*r.lengthFt,1)+" lbs",n:1},"",
     {v:f3(r.skinThk),n:1},"",{v:f3(r.base[0].id),n:1},"",{v:f3(r.base[0].od),n:1},""],
    [{v:"",n:1}, ,{v:f(r.base[1].wt*r.lengthFt,1)+" lbs",n:1},"",
     {v:f3(r.bondThk),n:1},"",{v:f3(r.base[1].id),n:1},"",{v:f3(r.base[1].od),n:1},""],
    [{v:"",n:1}, ,{v:f(r.base[2].wt*r.lengthFt,1)+" lbs",n:1},"",
     {v:f3(r.backerThk),n:1},"",{v:f3(r.base[2].id),n:1},"",{v:f3(r.baseOD),n:1},""]
  ]);
  const kg = x => `${f(x,2)} (${f(x/2.2,3)})`;
  const br = tbl(["#","Layer",{t:"Nb",n:1},{t:"lbs (kg)",n:1},{t:"Pitch",n:1},"Tol.",{t:"OD",n:1},"Tol."], [
    {group:"2 · Braid"},
    [{v:2,n:1}, ,{v:f0(r.longsQty),n:1},{v:kg(r.longsWtRaw*r.lengthFt),n:1},
     {v:"",n:1},"",{v:"",n:1},""],
    [{v:"",n:1}, ,{v:"Pass 1",n:1},{v:kg(r.xWtPerPass*r.lengthFt),n:1},
     {v:f(r.pitch),n:1},"±0.040in",{v:f3(r.A57),n:1},"Tgt."],
    ...(r.passes>=2?[[{v:"",n:1}, ,{v:"Pass 2",n:1},{v:kg(r.xWtPerPass*r.lengthFt),n:1},
     {v:f(r.pitch2),n:1},"±0.040in",{v:f3(r.A58),n:1},"Tgt."]]:[]),
    ...(r.passes>=3?[[{v:"",n:1}, ,{v:"Pass 3",n:1},{v:kg(r.xWtPerPass*r.lengthFt),n:1},
     {v:f(r.pitch3),n:1},"±0.040in",{v:f3(r.A59),n:1},"Tgt."]]:[]),
    ...(r.is24T?[[{v:"",n:1},"24-Tensile · "+esc(r.tBraid),{v:f0(24),n:1},
     {v:kg(r.tWt*r.lengthFt),n:1},{v:f(r.tPitch),n:1},"±0.040in",{v:"",n:1},""]]:[])
  ]);
  const cv = tbl(["#","Layer",{t:"Weight",n:1},{t:"Min Thick.",n:1},{t:"Thick.",n:1},"Tol.",{t:"OD",n:1},"Tol."], [
    {group:"3 · Cover"},
    [{v:3,n:1}, ,{v:f(r.jacketWt*r.lengthFt,1)+" lbs",n:1},{v:"≥0.07",n:1},
     {v:f4(r.jacketThk),n:1},'±0.01"',{v:f3(r.jacketOD),n:1},'±0.01"'],
    [{v:"",n:1}, ,{v:f(r.colorWt*r.lengthFt,1)+" lbs",n:1},{v:"",n:1},
     {v:"",n:1},"",{v:"",n:1},""]
  ]);
  const minD = r.jacketOD ? reelHub / r.jacketOD : 0;
  const reel = tbl(["#","Reel",{t:"Min D",n:1},"SP",{t:"",n:1},"HD",{t:"",n:1},"T",{t:"",n:1}], [
    [{v:4,n:1},"Reel",{v:f(minD,2),n:1},"SP",{v:f0(r.reelSP),n:1},"HD",{v:f0(reelHub),n:1},"T",{v:f0(r.reelT),n:1}]
  ]);
  const lens = tbl(["Stage","Target length per spool",{t:"ft",n:1},{t:"m",n:1}], [
    ["Base","Target Length of Base per Spool",{v:f0(r.lenBase),n:1},{v:f0(r.lenBase/3.28),n:1}],
    ["Braid","Target Length of Braid per Spool",{v:f0(r.lenBraid),n:1},{v:f0(r.lenBraid/3.28),n:1}],
    ["Cover","Target Length of Finished Product per Spool",{v:f0(r.lenFinished),n:1},{v:f0(r.lenFinished/3.28),n:1}],
    ["","Max reel (ignoring order length)",{v:f0(r.reelMax),n:1},{v:f0(r.reelMax/3.28),n:1}],
    ["","Pipe weight per foot",{v:f3(r.weightPerFt)+" lbs/ft",n:1},{v:"",n:1}],
    {cls:"tot",cells:["","Total spool weight with finished product",{v:f0(r.reelWeight)+" lbs",n:1},
      {v:f0(r.reelWeight/2.2)+" kg",n:1}]},
    {cls:"tot",cells:["","Reels required for the order",{v:f0(r.nReels),n:1},{v:"",n:1}]}
  ]);
  const prnt = tbl(["#","Print — for downhole or LPG, no API logo"], [
    [{v:5,n:1},{v:`<span class="cell">${esc(r.printLine1)}</span>`,raw:true}],
    [{v:"",n:1},{v:`<span class="cell">${esc(r.printLine2)}</span>`,raw:true}],
    [{v:"",n:1},{v:`<span class="cell">${esc(r.printLine3)}</span>`,raw:true}],
    [{v:"",n:1},{v:'<span class="muted">Date code is Year Month Day Hour — 2022010910 — "01" location code Stafford, TX. '
      +'Print increments: length 3 feet, minimum 1/4" print height.</span>',raw:true}]
  ]);
  const head = tbl(null, [
    [{v:"Application",k:1},{v:r.app},{v:"API Nominal Size",k:1},{v:f(r.apiNominal,2)+" in"}],
    [{v:"SRTP Pipe Size",k:1},{v:f0(r.mdsSize)+" in"},{v:"Design Temperature",k:1},{v:f0(r.degC)+"°C / "+f0(r.degF)+"°F"}],
    [{v:"Design Pressure",k:1},{v:f0(r.psi)+" psi / "+f(r.psi/14.5,1)+" bars"},{v:"Service",k:1},{v:r.sour}],
    [{v:"FAT Min Burst Pressure",k:1},{v:f0(fatBurst)+" psi / "+f(fatBurst/14.5,1)+" bars"},
     {v:"Project Length",k:1},{v:f0(r.lengthFt)+" ft ("+f0(r.lengthM)+" m)"}]
  ]);
  return `${head}<div class="two" style="margin-top:14px">
    <div>${geo}<div style="height:12px"></div>${br}</div>
    <div>${cv}<div style="height:12px"></div>${reel}<div style="height:12px"></div>${lens}</div>
  </div><div style="height:14px"></div>${prnt}
  <p class="ref">FAT min burst on this sheet reads <b>${cellRef}</b>.</p>`;
}

function sheetMDS(r)  { return `<h4>Manufacturing Datasheet &mdash; MDS (FAT burst = API minimum)</h4>`
  + mdsBlock(r, r.minBurst, r.reelHub, "Inputs!E27 — MAOP × "+((r.xbraid||"").slice(0,2)==="KN"?"2.31":"2.00")); }
function sheetMDS1(r) { return `<h4>Manufacturing Datasheet &mdash; MDS1 (FAT burst = short-term stress-rupture burst)</h4>`
  + mdsBlock(r, r.shortBurst, r.reelHub, "Inputs!B73 — short-term burst with no safety factor"); }

function sheetMDS2(r) {
  const head = tbl(null, [
    [{v:"Application",k:1},{v:r.app},{v:"SRTP Pipe Size",k:1},
     {v:`${r.sizeKey} (in) | ${f(r.jacketOD)} OD | ${f(r.linerID)} ID | ${f3(r.weightPerFt)} lbs/ft`,span:2}],
    [{v:"Design Pressure",k:1},{v:f0(r.psi)+" psi"},{v:"API Nominal Size",k:1},{v:f(r.apiNominal,2)+" in",span:2}],
    [{v:"Burst Pressure",k:1},{v:f0(r.targetBurstR)+" psi"},{v:"Design Temperature",k:1},
     {v:f0(r.degC)+"°C | "+f0(r.degF)+"°F",span:2}],
    [{v:"Field HydroTest Pressure",k:1},{v:f0(r.hydroP)+" psi"},{v:`${f0(r.years)} Years of Service`,k:1},
     {v:`${r.sour} ${r.service.trim()} | ${r.h2s} | ${r.co2}`,span:2}],
    [{v:"Project",k:1},{v:r.client||"—"},{v:"Length",k:1},
     {v:`${f0(r.lengthFt)} ft | ${f0(r.lengthM)} m`,span:2}]
  ]);
  const base = tbl(["#","Base | Ovality 0-5%",{t:"Wall (in)",n:1},{t:"OD (in) ±0.01",n:1},
                    {t:"ID (in) ±0.01",n:1},{t:"lbs/ft",n:1},{t:"Planned lbs",n:1}], [
    [{v:1,n:1},esc(r.base[0].name)+" | ≥0.025",{v:f3(r.skinThk),n:1},{v:f3(r.base[0].od),n:1},
     {v:f3(r.base[0].id),n:1},{v:f4(r.base[0].wt),n:1},{v:f0(Math.ceil(r.base[0].wt*r.lengthFt)),n:1}],
    [{v:"",n:1}, ,{v:f3(r.bondThk),n:1},{v:f3(r.base[1].od),n:1},
     {v:f3(r.base[1].id),n:1},{v:f4(r.base[1].wt),n:1},{v:f0(Math.ceil(r.base[1].wt*r.lengthFt)),n:1}],
    [{v:"",n:1}, ,{v:f3(r.backerThk),n:1},{v:f3(r.base[2].od),n:1},
     {v:f3(r.base[2].id),n:1},{v:f4(r.base[2].wt),n:1},{v:f0(Math.ceil(r.base[2].wt*r.lengthFt)),n:1}],
    {cls:"tot",cells:[{v:"",n:1},"Base total",{v:f3(r.specWT),n:1},{v:f3(r.baseOD),n:1},{v:"",n:1},
      {v:f4(r.baseWt),n:1},{v:f0(Math.ceil(r.baseWt*r.lengthFt)),n:1}]}
  ]);
  const rows = [[{v:2,n:1}, ,{v:f0(r.longsQty),n:1},{v:"",n:1},{v:"",n:1},
                 {v:f4(r.longsWt),n:1},{v:f0(Math.ceil(r.longsWt*r.lengthFt)),n:1}],
                [{v:"",n:1}, ,{v:"Pass #1",n:1},{v:f(r.pitch),n:1},{v:f3(r.A56),n:1},
                 {v:f4(r.xWt),n:1},{v:f0(Math.ceil(r.xWt*r.lengthFt)),n:1}]];
  if (r.passes>=2) rows.push([{v:"",n:1}, ,{v:"Pass #2",n:1},{v:f(r.pitch2),n:1},{v:f3(r.A57),n:1},{v:"",n:1},{v:"",n:1}]);
  if (r.passes>=3) rows.push([{v:"",n:1}, ,{v:"Pass #3",n:1},{v:f(r.pitch3),n:1},{v:f3(r.A58),n:1},{v:"",n:1},{v:"",n:1}]);
  const braid = tbl(["#","Braid",{t:"Number / Pass",n:1},{t:"Pitch (in) ±0.01",n:1},
                     {t:"OD (in) ±0.01",n:1},{t:"lbs/ft",n:1},{t:"Planned lbs",n:1}], rows);
  const cover = tbl(["#","Cover",{t:"Wall (in)",n:1},{t:"OD (in) ±0.01",n:1},{t:"ID (in) ±0.01",n:1},
                     {t:"lbs/ft",n:1},{t:"Planned lbs",n:1}], [
    [{v:3,n:1}, ,{v:f4(r.jacketThk),n:1},{v:f3(r.jacketOD),n:1},{v:f3(r.jacketID),n:1},
     {v:f4(r.jacketWt),n:1},{v:f0(Math.ceil(r.jacketWt*r.lengthFt)),n:1}],
    [{v:"",n:1}, ,{v:"",n:1},{v:"",n:1},{v:"",n:1},
     {v:f4(r.colorWt),n:1},{v:f0(Math.ceil(r.colorWt*r.lengthFt)),n:1}],
    {cls:"tot",cells:[{v:"",n:1},"Finished product",{v:"",n:1},{v:f3(r.jacketOD),n:1},{v:f3(r.linerID),n:1},
      {v:f3(r.weightPerFt),n:1},{v:f0(Math.ceil(r.weightPerFt*r.lengthFt)),n:1}]}
  ]);
  return `<h4>Manufacturing Datasheet &mdash; MDS (2), formatted layout</h4>${head}
    <div style="height:14px"></div>${base}<div style="height:12px"></div>${braid}
    <div style="height:12px"></div>${cover}
    <p class="ref">The original MDS (2) pulls base-tube IDs from a broken external link
      <span class="cell">'[2]New Design'!E35:E37</span>, which froze them at a 6" design. They are computed
      from the live base-tube stack here.</p>`;
}

function sheetCDS(r) {
  const head = tbl(null, [
    [{v:"Application",k:1},{v:r.app},{v:"Pipe Size",k:1},{v:f0(r.mdsSize)+" in"}],
    [{v:"Design Pressure",k:1},{v:f0(r.psi)+" psi / "+f(r.psi/14.5,1)+" bars"},
     {v:"Design Temperature",k:1},{v:f0(r.degC)+"°C (-30°C) / "+f0(r.degF)+"°F (-22°F)"}],
    [{v:"FAT Burst Pressure",k:1},{v:f0(r.minBurst)+" psi"},{v:"Service, yrs",k:1},{v:f0(r.years)}],
    [{v:"Hydro factor",k:1},{v:f(r.hydroFactor,2)+" × design = "+f0(r.hydroP)+" psi"},
     {v:"Standard",k:1},{v:"API 15S-0020"}]
  ]);
  const cons = tbl(["#","Construction"], [
    [{v:1,n:1},"Base — "+esc((r.liner||"").trim().slice(0,5))+" / "+esc((r.backer||"").trim().slice(0,5))],
    [{v:2,n:1},"Longitudinal Reinforcement — "+((r.longsName||"").slice(0,2)==="KN"?"Para-aramid Fibers":"Copolyamide Fibers")],
    [{v:3,n:1},"Hoop Reinforcement — "+((r.xbraid||"").slice(0,2)==="KN"?"Para-aramid Fibers":"Copolyamide Fibers")],
    [{v:4,n:1},"Jacket — "+esc((r.jacket||"").trim().slice(0,5))]
  ]);
  const par = tbl(["Parameter",{t:"US Unit",n:1},"",{t:"SI Unit",n:1},""], [
    ["Pipe (Nominal Size)",{v:f(r.apiNominal,2),n:1},"in",{v:f(r.apiNominal*25.4,1),n:1},"mm"],
    ["Outer Diameter",{v:f3(r.jacketOD),n:1},"in",{v:f(r.jacketOD*25.4,2),n:1},"mm"],
    ["Internal Diameter",{v:f3(r.linerID),n:1},"in",{v:f(r.linerID*25.4,2),n:1},"mm"],
    ["Weight Empty",{v:f3(r.weightPerFt),n:1},"lbs/ft",{v:f4((r.weightPerFt/2.2)/3.28),n:1},"kg/m"],
    ["Min Bend Radius (operational)",{v:f4(r.minBendFt),n:1},"ft",{v:f4(r.minBendFt/3.28),n:1},"m"],
    ["Flow Coefficient (relative roughness)",{v:"0.00005",n:1},"",{v:"0.00005",n:1},""],
    ["Max Installed Tension Load",{v:f0(r.maxTension),n:1},"lbs",{v:f0(r.maxTension/2.2),n:1},"kg"],
    {group:"Fittings"},
    ["Coupling (selected)",{v:esc(r.couplingName),n:1,span:4}],
    ["Coupling OD (post swage)",{v:f3(r.couplingOD),n:1},"in",{v:f(r.couplingOD*25.4,2),n:1},"mm"],
    ["Coupling insert ID",{v:f3(r.couplingIDIns),n:1},"in",{v:f(r.couplingIDIns*25.4,2),n:1},"mm"],
    ["Stem length in ferrule",{v:f3(r.stemLen),n:1},"in",{v:f(r.stemLen*25.4,2),n:1},"mm"],
    ["Ribs / max pressure",{v:f0(r.couplingRibs),n:1},"ribs",{v:f0(r.couplingMaxP),n:1},"psi"]
  ]);
  return `<h4>Commercial Datasheet &mdash; CDS!A1:H26</h4>${head}
    <div class="two" style="margin-top:14px"><div>${par}</div><div>${cons}
      <p class="ref" style="margin-top:12px">The live sheet's <span class="cell">CDS!E26</span> returns #N/A because it
      looks up the coupling ID by jacket OD against a nominal-size column. Resolved here by coupling selection.</p></div></div>`;
}

function sheetWO(r) {
  return `<h4>Work Order &mdash; WO!A2:I18</h4>` + tbl(null, [
    {group:"Order detail"},
    [{v:"Client",k:1},{v:r.client||"—"},{v:"SRTP Size",k:1},{v:r.sizeKey+" in"}],
    [{v:"Project #",k:1},{v:"R&D"},{v:"Project Length",k:1},{v:f0(r.lengthFt)+" ft ("+f0(r.lengthM)+" m)"}],
    [{v:"SO #",k:1},{v:"—"},{v:"Product",k:1},{v:r.productName}],
    {group:"Application details"},
    [{v:"Application",k:1},{v:r.app},{v:"Design Pressure",k:1},{v:f0(r.psi)+" psi ("+f0(r.psi/14.5)+" bars)"}],
    [{v:"SRTP Size (MDS)",k:1},{v:f0(r.mdsSize)+" in"},{v:"Design Temperature",k:1},
     {v:f0(r.degC)+"°C ("+f0(r.degC*9/5+32)+"°F)"}],
    [{v:"Service",k:1},{v:r.sour+" "+r.service.trim()},{v:"Coupling",k:1},{v:r.couplingName||"—"}],
    {group:"Reel details"},
    [{v:"Reel Size",k:1},{v:`SP ${f0(r.reelSP)} · HD ${f0(r.reelHub)} · T ${f0(r.reelT)}`},
     {v:"Min bend",k:1},{v:f(r.minD,1)+"D"}],
    [{v:"Length Per Reel",k:1},{v:f0(r.lenBraid)+" ft"},{v:"Number of Reels",k:1},{v:f0(r.nReels)}],
    [{v:"Weight per reel",k:1},{v:f0(r.reelWeight)+" lbs ("+f0(r.reelWeight/2.2)+" kg)"},
     {v:"Total order weight",k:1},{v:f0(r.projectWeight)+" lbs"}],
    {group:"Commercial"},
    [{v:"Cost",k:1},{v:money(r.costPerFt)+"/ft · "+money(r.projectCost,0)+" total"},
     {v:"Price @ "+pct(r.margin,0),k:1},{v:money(r.sellPerFt)+"/ft · "+money(r.projectPrice,0)+" total"}]
  ]);
}

function sheetMaterials(r) {
  // Prices come from the loaded price book, not from the source.
  const PP = (PRICES.polymer || {}), PB = (PRICES.braid || {});
  const live = tbl(["Material",{t:"SG",n:1},{t:"$/lb",n:1},{t:"Comp. yield (psi)",n:1},
                    "Acronym","Alt. designation","In this design"],
    Object.keys(MATERIALS).map(k => {
      const m = MATERIALS[k];
      const used = [matKey(r.liner),matKey(r.bond),matKey(r.backer),matKey(r.jacket),matKey(r.colorMB)].includes(k);
      const p = PP[k];
      return { cls: used ? "tot" : "", cells:[
        k, {v:f(m.sg),n:1},
        {v: p === undefined ? '<span class="bad">no price</span>' : money(p,3), n:1, raw: p === undefined},
        {v:m.comp?f0(m.comp):"—",n:1}, , esc(m.alt||"—"),
        {v:used?'<span class="ok">● used</span>':"",raw:true}]};
    }));
  const br = tbl(["Braid","Type",{t:"lbs/ft per end",n:1},{t:"Width (in)",n:1},
                  {t:"Strength (lbs)",n:1},{t:"$/lb",n:1},{t:"OD (in)",n:1},"In this design"],
    Object.keys(BRAID).map(k => {
      const b = BRAID[k], p = PB[k];
      const used = [r.xbraid,r.longsName,(r.is24T?r.tBraid:null)].includes(k);
      return { cls: used ? "tot":"", cells:[, , {v:f(b.wt,5),n:1}, {v:f(b.w),n:1},
        {v:f0(b.str),n:1},
        {v: p === undefined ? '<span class="bad">no price</span>' : money(p), n:1, raw: p === undefined},
        {v:f4(b.od),n:1},
        {v:used?'<span class="ok">● used</span>':"",raw:true}]};
    }));
  const cp = tbl(["Coupling",{t:"Insert",n:1},{t:"Stem (in)",n:1},{t:"Ribs",n:1},
                  {t:"OD post swage",n:1},{t:"Insert ID",n:1},{t:"Max psi",n:1},"In this design"],
    Object.keys(COUPLING_BY_NAME).map(k => {
      const c = COUPLING_BY_NAME[k], used = k === r.couplingName;
      return { cls: used ? "tot":"", cells:[, {v:f(c.insert),n:1}, {v:f3(c.stem),n:1}, {v:f0(c.ribs),n:1},
        {v:f3(c.odPost),n:1}, {v:f3(c.idIns),n:1}, {v:f0(c.maxP),n:1},
        {v:used?'<span class="ok">● selected</span>':"",raw:true}]};
    }));
  const sup = tbl(["Material","Supplier","Underlying product","To our spec"], [
    ["PPS","Celanese","Fortron","Yes"],["PPS","Solvay","Ryton","Yes"],
    ["PVDF","Arkema","Kynar","No"],["PVDF","Solvay","—","No"],
    ["Nylon Liner","Ascend","HF75","Yes"],["Nylon Liner","Technor Apex","Not as good","Yes"],
    ["PP","M Holland","Braskem TI","No"],["PP","Nexeo","Braskem TI","No"],["PP","Borouge","Direct","No"],
    ["PERT","Dow","Type 2","No"],["PERT","Borouge","Type 2","No"],
    ["Tie Layers","Mitsui","Admer","No"],["Tie Layers","M Holland","Lotader via SK Plastics","No"],
    ["Nylon Backer","Ascend","—","Yes"],
    ["Aramid Fiber","Beaver Manufacturing","Teijin Twaron / Kolon para-aramid","Yes"],
    ["Aramid Fiber","Beaver Manufacturing","Teijin Technora","Yes"],
    ["Color Concentrate","Penn Color","Custom white or yellow blend","Yes"],
    ["Color Concentrate","Badger","Secondary, worse supplier","No"],
    ["Talc Filled Jacket PP","Washington Penn","Custom blend","Yes"],
    ["Talc Filled Jacket PP","RTS","Under review","Yes"]
  ]);
  const pipeT = tbl(["Nominal","Jacket OD","ID","Liner ID","Spec WT","Skin","Bond","Backer","Label","Selected"],
    PIPE_ORDER.map(k => { const p = PIPE[k], used = k === r.sizeKey;
      return { cls:used?"tot":"", cells:[, {v:p.O===null?"—":f3(p.O),n:1}, {v:p.P===null?"—":f3(p.P),n:1},
        {v:f3(p.Q),n:1}, {v:p.R===null?"—":f4(p.R),n:1}, {v:p.V===null?"—":f3(p.V),n:1},
        {v:p.W===null?"—":f3(p.W),n:1}, {v:p.X===null?"—":f4(p.X),n:1}, ,
        {v:used?'<span class="ok">●</span>':"",raw:true}]};
    }));
  return `<h4>Polymer price book &mdash; ${esc(BOOK ? BOOK.name : "none loaded")}</h4>${live}
    <p class="ref">Prices are served from Supabase, not from this page's source &mdash; that is what lets the
      repository be public. Switch books in the header; only an admin can change a figure.
      ${BOOK ? `Book <b>${esc(BOOK.name)}</b>, status <b>${esc(BOOK.status)}</b>, effective
      ${esc(BOOK.effective_from)}, ${BOOK.itemCount} items.` : ""}</p>
    <h4>Braid master &mdash; Inputs!N29:V41</h4>${br}
    <h4>Coupling master &mdash; Inputs!M49:T71</h4>${cp}
    <h4>Pipe size master &mdash; Inputs!N8:X24</h4>${pipeT}
    <h4>Approved suppliers &mdash; Materials!V23:X53</h4>${sup}`;
}

function sheetTrace(r) {
  const row = (cell, label, val) => [{v:cell,cls:"ref"}, , {v:val,n:1}];
  const t = (title, rows) => `<h4>${title}</h4>` + tbl(["Cell","Quantity",{t:"Value",n:1}], rows);
  return [
    t("Material selection — Inputs!A35:A43", [
      row("A35","Liner (service × temp × sweet/sour)", matKey(r.liner)),
      row("A36","Bonding (from liner)", matKey(r.bond)),
      row("A37","Backer (temp)", matKey(r.backer)),
      row("A42","Jacket (temp)", matKey(r.jacket)),
      row("A43","Color masterbatch", matKey(r.colorMB)),
      row("B31","Braid family recommended at temp", r.braidFamily),
      row("B81","Yarn type of the selected X-braid", r.yarnType)
    ]),
    t("Geometry — Inputs!C35:D42, A56:A59", [
      row("E35","Liner ID", f3(r.linerID)+" in"),
      row("C35","Skin thickness", f3(r.skinThk)+" in"),
      row("C36","Bond thickness", f3(r.bondThk)+" in"),
      row("C37","Backer thickness", f4(r.backerThk)+" in"),
      row("C38","Base-tube spec wall", f3(r.specWT)+" in"),
      row("D38 / A56","Base tube (liner) OD", f3(r.baseOD)+" in"),
      row("A57","OD after pass 1", f3(r.A57)+" in"),
      row("A58","OD after pass 2", f3(r.A58)+" in"),
      row("A59","OD after pass 3", f3(r.A59)+" in"),
      row("E42","Jacket ID (= OD after the last pass)", f3(r.jacketID)+" in"),
      row("D42","Jacket OD", f3(r.jacketOD)+" in"),
      row("C42","Jacket wall", f4(r.jacketThk)+" in")
    ]),
    t("Braid — Inputs!B76, C56, A47:I50", [
      row("C56","Braid angle", f(r.braidAngle,4)+"°"),
      row("B76","Pitch length per foot", f(r.pitchLenPerFt,4)+" in"),
      row("F57","Pass-2 pitch", f(r.pitch2)+" in"),
      row("H58","Pass-3 pitch", f(r.pitch3)+" in"),
      row("D48","X-braid weight per pass", f(r.xWtPerPass,6)+" lbs/ft"),
      row("G48","X-braid weight, "+r.passes+" pass(es)", f4(r.xWt)+" lbs/ft"),
      row("G49","Longs weight", f4(r.longsWt)+" lbs/ft"),
      row("F82","Minimum pitch for this braid width", f(r.minPitch)+" in")
    ]),
    t("Stress rupture — Inputs!A78:B101", [
      row("B82","Slope (yarn × temperature)", f(r.slope,5)),
      row("C84","Service hours", f0(r.hours)),
      row("B83","log reference pressure", f(r.logRefP,6)),
      row("B84",r.years+"-year pressure", f0(r.refPressure)+" psi"),
      row("B87","Y intercept, log(bar)", f(r.yIntercept,6)),
      row("B88","Y intercept in PSI", f0(r.yInterceptP)+" psi"),
      row("B92","log short-term burst", f(r.logShort,6)),
      row("B93","Short-term burst (FAT min, no SF)", f0(r.shortBurst)+" psi"),
      row("B94 / A21","Target burst at 0.67 SF", f0(r.targetBurst)+" psi"),
      row("B95","Aramco (/0.8)", f0(r.aramco)+" psi"),
      row("B74","Aramco + 400", f0(r.aramco400)+" psi"),
      row("B98","1,000 hr pressure", f0(r.p1000)+" psi"),
      row("B99","Aramco factor (0.54 SF)", f0(r.aramcoFactor)+" psi"),
      row("B100","Hydrotest factor", f(r.hydroFactor,2)),
      row("B101","Hydrotest pressure", f0(r.hydroP)+" psi")
    ]),
    t("Burst from braid — Inputs!A69:F70", [
      row("F70","X-braid yarn yield", f0(r.yarnYield)+" lbs"),
      row("B70","Pass 1 burst", f0(r.burst1)+" psi"),
      row("C70","Pass 2 burst", f0(r.burst2)+" psi"),
      row("D70","Pass 3 burst", f0(r.burst3)+" psi"),
      row("E21","Burst used ("+r.passes+" pass)", f0(r.burstTotal)+" psi"),
      row("E27","API minimum burst", f0(r.minBurst)+" psi"),
      row("A24","SF added over target", f0(r.sfAdded)+" psi"),
      row("F31","Recommended min SF gap", f0(r.recMinSF)+" psi")
    ]),
    t("Coupling retention — Inputs!A103:C129", [
      row("B12","Coupling selected", r.couplingName||"—"),
      row("C103","Tensile load at hydrotest", f0(r.tensileAtHydro)+" lbs"),
      row("C104","Backer compressive yield", (r.compYield?f0(r.compYield):"—")+" psi"),
      row("C106","Stem length in ferrule", f3(r.stemLen)+" in"),
      row("C107","Liner OD circumference", f4(r.linerCircum)+" in"),
      row("C108","Longs width", f3(r.longsWidth)+" in"),
      row("C109","Strength of each long", f0(r.longsStr)+" lbs"),
      row("C110","Yarns to carry the load", f(r.yarnsNeeded,2)),
      row("C111","Yarns with half in tension", f0(r.yarnsNeeded2)),
      row("C115","Fibre area under coupling", f3(r.fiberArea)+" in²"),
      row("C116","PSI load on fibres", f0(r.fiberPSI)+" psi"),
      row("C118","Load / compressive yield", pct(r.fiberRatio)),
      row("C119","Verdict", r.couplingVerdict),
      row("C120","Pressure capacity from longs", f0(r.longsPressureCap)+" psi"),
      row("G13","Coupling min retention", f0(r.couplingMinRet)+" lbs"),
      row("G14","Coupling target retention", f0(r.couplingTgtRet)+" lbs"),
      row("G106","Max longs that fit", f0(r.maxLongs)),
      row("B52","Longs prediction", f(r.longsPrediction,2))
    ]),
    t("Downhole — Inputs!A121:C129", [
      row("C123","Suspended pipe weight", f0(r.dhSuspended)+" lbs"),
      row("C124","Total tensile load", f0(r.dhTotalLoad)+" lbs"),
      row("C125","Yarns to carry it", f(r.dhYarns,2)),
      row("C126","With half in tension", f(r.dhYarns2,2)),
      row("C127","PSI load on fibres", f0(r.dhFiberPSI)+" psi"),
      row("C128","Load / compressive yield", pct(r.dhRatio)),
      row("C129","Downhole verdict", r.dhVerdict)
    ]),
    t("Reel wrap build-up — MDS1!K3:M47", [
      row("E28","Spool flange OD (SP)", f0(r.reelSP)+" in"),
      row("G28","Hub diameter (HD)", f0(r.reelHub)+" in"),
      row("I28","Traverse (T)", f0(r.reelT)+" in"),
      row("G27","Min bend ratio", f(r.minD,2)+"D"),
      row("F37","Finished length per spool", f0(r.lenFinished)+" ft"),
      row("F34","Braid length per spool", f0(r.lenBraid)+" ft"),
      row("F31","Base length per spool", f0(r.lenBase)+" ft"),
      row("I37","Max reel capacity", f0(r.reelMax)+" ft"),
      row("F39","Total spool weight", f0(r.reelWeight)+" lbs")
    ]) + `<div class="scroll" style="margin-top:10px">` + tbl(
      ["Wrap",{t:"OD Total (in)",n:1},{t:"Added (ft)",n:1},{t:"Cumulative (ft)",n:1},{t:"Cumulative (m)",n:1}],
      r.wraps.map(w => ({ cls: (w.odTotal <= r.reelSP) ? "" : "", cells:[
        {v:f0(w.n),n:1},{v:f0(w.odTotal),n:1},{v:w.addFt?f0(w.addFt):"—",n:1},
        {v:f0(w.lenFt),n:1},{v:f0(w.lenFt/3.28),n:1}]}))) + `</div>`
  ].join("");
}

function renderPanel() {
  const r = R, p = document.getElementById("panel");
  p.innerHTML = ({
    "TDS": sheetTDS, "MDS": sheetMDS, "MDS (2)": sheetMDS2, "CDS": sheetCDS,
    "MDS1": sheetMDS1, "WO": sheetWO, "Materials": sheetMaterials,
    "Trace": sheetTrace
  }[TAB] || sheetTDS)(r);
}

/* =====================================================================
   Spool Calculator (separate)
   ===================================================================== */
function sfield(label, key, kind, extra={}) {
  const id = "sp_"+key, v = S[key];
  const ctl = kind === "select"
    ? `<select id="${id}" data-sk="${key}">` + extra.opts.map(o =>
        `<option value="${esc(o)}"${String(o)===String(v)?" selected":""}>${esc(o)}</option>`).join("") + `</select>`
    : `<input id="${id}" data-sk="${key}" type="number" value="${v}"${extra.step?` step="${extra.step}"`:""}>`;
  return `<label for="${id}">${label}</label>${ctl}<div class="u">${extra.unit||""}</div>`;
}
function renderSpoolGrid() {
  const r = SR;
  document.getElementById("spoolGrid").innerHTML = [
    `<div class="grp">Pipe</div>`,
    sfield("SRTP Pipe Size","sizeKey","select",{opts:Object.keys(SPOOL_PIPE),unit:"in"}),
    `<label>OD</label><div class="derived" id="d_sod">${f3(r.od)}</div><div class="u">±0.01"</div>`,
    `<label>ID</label><div class="derived" id="d_sid">${f3(r.id)}</div><div class="u">in</div>`,
    sfield("Design Pressure","psi","num",{unit:"psi"}),
    sfield("Project Length","lengthFt","num",{unit:"ft"}),
    `<label> </label><div class="derived" id="d_slenM">${f0(r.lengthM)}</div><div class="u">m</div>`,
    `<div class="grp">Reel hardware</div>`,
    sfield("Spool flange OD &mdash; SP","sp","select",{opts:SPOOL_SP,unit:"in"}),
    sfield("Hub diameter &mdash; HD","hub","select",{opts:SPOOL_HUB,unit:"in"}),
    sfield("Traverse &mdash; T","t","select",{opts:SPOOL_T,unit:"in"}),
    `<label>Min D (HD / OD)</label><div class="derived" id="d_sminD">${f(r.minD,2)}D</div><div class="u">≥20D</div>`,
    `<div class="grp">Factors</div>`,
    sfield("Pipe weight per foot","wtPerFt","num",{step:0.01,unit:"lbs/ft"}),
    sfield("Packing efficiency","packing","num",{step:0.001,unit:"frac"})
  ].join("");
}

function updateSpoolDerived(r) {
  const v = { d_sod:f3(r.od), d_sid:f3(r.id), d_slenM:f0(r.lengthM), d_sminD:f(r.minD,2)+"D" };
  for (const id in v) { const e = document.getElementById(id); if (e) e.textContent = v[id]; }
}

function renderSpoolOutputs(r) {
  document.getElementById("spoolTiles").innerHTML = tiles([
    { k:"Target length per spool", v:f0(r.target)+" ft", cls:"big", s:f0(r.targetM)+" m" },
    { k:"Max reel", v:f0(r.maxReelFt)+" ft", s:f0(r.maxReelM)+" m" },
    { k:"One wrap less", v:f0(r.oneLessFt)+" ft", s:f0(r.oneLessM)+" m" },
    { k:"With packing "+pct(r.packing), v:f0(r.derated)+" ft", s:f0(r.deratedM)+" m" },
    { k:"Reels for the order", v:f0(r.nReels), s:f0(r.lengthFt)+" ft order" },
    { k:"Spool weight", v:f0(r.spoolWeight)+" lbs", s:f0(r.spoolWeight/2.2)+" kg" },
    { k:"Min bend ratio", v:f(r.minD,1)+"D", cls:r.minD>=20?"ok":"bad", s:"hub / pipe OD" },
    { k:"Hydro (MAOP×1.25)", v:f0(r.hydro)+" psi", s:"AD8" },
    { k:"Burst, Technora", v:f0(r.burstTN)+" psi", s:"MAOP × 1.84" },
    { k:"Burst, Twaron", v:f0(r.burstKN)+" psi", s:"MAOP × 2.19" }
  ]);
  document.getElementById("spoolWarns").innerHTML = r.warnings.map(w => `<li>${esc(w)}</li>`).join("");

}


/* =====================================================================
   Pricing tab — the master pricing sheet.
   Read-only for viewers and estimators; editable for admins, which is
   what the RLS policies allow. A blank price means "not priced yet" and
   is kept distinct from zero.
   ===================================================================== */
const KIND_LABEL = {
  polymer:"Polymers & compounds", braid:"Braid & longs",
  coupling:"Couplings, flanges & splices", reel:"Reels", support:"Support items"
};
const KIND_ORDER = ["polymer","braid","coupling","reel","support"];

function sheetPricing() {
  const admin = ME && ME.role === "admin";
  const usedKeys = new Set([
    matKey(R.liner), matKey(R.bond), matKey(R.backer), matKey(R.jacket), matKey(R.colorMB),
    R.xbraid, R.longsName, (R.is24T ? R.tBraid : null), R.couplingName
  ].filter(Boolean));

  const books = BOOKS.map(b =>
    `<option value="${esc(b.id)}"${BOOK && b.id === BOOK.id ? " selected":""}>${
      esc(b.name)} — ${esc(b.status)}</option>`).join("");

  const header = `
    <div class="savebar">
      <select id="pbPick" title="Price book to view or edit">${books}</select>
      ${admin ? `
        <button id="pbCopy">Duplicate as draft</button>
        ${BOOK && BOOK.status !== "active" ? `<button class="pri" id="pbActivate">Make active</button>` : ""}
      ` : ""}
      <span id="pbStatus"></span>
    </div>
    <p class="ref">${BOOK ? `<b>${esc(BOOK.name)}</b> · ${esc(BOOK.status)} · effective ${esc(BOOK.effective_from)}
      · ${SHEET_ROWS.length} items, ${SHEET_ROWS.filter(i=>i.price!=null).length} priced.` : ""}
      ${admin ? "Edit a price and it saves when you leave the box. Blank means not priced yet, which the engine reports rather than costing as zero."
              : "Only an administrator can change prices."}</p>`;

  const section = kind => {
    const rows = SHEET_ROWS.filter(i => i.kind === kind);
    if (!rows.length && !admin) return "";
    const body = rows.map(i => {
      const used = usedKeys.has(i.item_key);
      const priceCell = admin
        ? `<input class="pbPrice" data-id="${esc(i.id)}" type="number" step="0.0001" min="0"
             value="${i.price == null ? "" : i.price}" placeholder="not set"
             style="width:100px;text-align:right">`
        : (i.price == null ? `<span class="wn">not set</span>` : money(i.price, 4));
      return { cls: used ? "tot" : "", cells: [
        i.label || i.item_key,
        { v: `<span class="ref">${esc(i.item_key)}</span>`, raw:true },
        { v: priceCell, n:1, raw:true },
        i.unit,
        i.source_note || "—",
        { v: used ? '<span class="ok">● in this design</span>' : "", raw:true },
        { v: admin ? `<button data-rm="${esc(i.id)}" title="Remove this item">×</button>` : "", raw:true }
      ]};
    });
    const addRow = admin ? `
      <div class="savebar" style="margin:8px 0 0">
        <input class="pbNewKey"   data-kind="${kind}" placeholder="Item key (must match the engine)" style="flex:1 1 240px">
        <input class="pbNewLabel" data-kind="${kind}" placeholder="Display label" style="flex:1 1 160px">
        <input class="pbNewPrice" data-kind="${kind}" type="number" step="0.0001" placeholder="price" style="width:100px">
        <button data-add="${kind}">Add</button>
      </div>` : "";
    return `<h4>${esc(KIND_LABEL[kind])}</h4>` + tbl(
      ["Item","Key",{t:"Price",n:1},"Unit","Note","","",], body) + addRow;
  };

  return header + KIND_ORDER.map(section).join("") + `
    <p class="ref" style="margin-top:20px">Polymer and braid prices drive the $/ft cost build-up.
    The part costs below feed quoting.</p>`
    + PARTSUI.partsSection()
    + PARTSUI.speedsSection()
    + PARTSUI.settingsSection();
}

async function reloadSheet() {
  if (!BOOK) { SHEET_ROWS = []; return; }
  try { SHEET_ROWS = await DB.loadPriceSheet(BOOK.id); }
  catch (err) { SHEET_ROWS = []; }
}

function pbStatus(msg, bad) {
  const el = document.getElementById("pbStatus");
  if (!el) return;
  el.textContent = msg; el.className = bad ? "bad" : "ok";
  if (!bad) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3000);
}

/* Save a price on blur, not on keystroke, so typing is never interrupted. */
document.addEventListener("change", async e => {
  const box = e.target.closest(".pbPrice");
  if (!box) return;
  try {
    await DB.setItemPrice(box.dataset.id, box.value === "" ? null : box.value);
    const row = SHEET_ROWS.find(i => i.id === box.dataset.id);
    if (row) row.price = box.value === "" ? null : Number(box.value);
    await useBook(BOOK.id);          // re-cost the design against the new figure
    pbStatus("Saved.");
  } catch (err) { pbStatus(err.message, true); }
});

document.addEventListener("click", async e => {
  const add = e.target.closest("[data-add]");
  const rm  = e.target.closest("[data-rm]");
  const cp  = e.target.closest("#pbCopy");
  const act = e.target.closest("#pbActivate");

  if (add) {
    const kind = add.dataset.add;
    const q = s => document.querySelector(`.${s}[data-kind="${kind}"]`);
    const key = q("pbNewKey").value.trim();
    if (!key) { pbStatus("An item key is required.", true); return; }
    try {
      await DB.addItem(BOOK.id, { kind, item_key: key,
        label: q("pbNewLabel").value.trim(), price: q("pbNewPrice").value });
      await useBook(BOOK.id);
      pbStatus(`Added ${key}.`);
    } catch (err) { pbStatus(err.message, true); }
  }

  if (rm) {
    if (!confirm("Remove this item from the price book?")) return;
    try { await DB.removeItem(rm.dataset.rm); await useBook(BOOK.id); pbStatus("Removed."); }
    catch (err) { pbStatus(err.message, true); }
  }

  if (cp) {
    const name = prompt("Name for the new draft book:",
                        `${BOOK.name} (revised ${new Date().toISOString().slice(0,10)})`);
    if (!name) return;
    try {
      const b = await DB.copyPriceBook(BOOK.id, name, new Date().toISOString().slice(0,10));
      BOOKS = await DB.listPriceBooks();
      await useBook(b.id);
      pbStatus(`Created "${name}" as a draft.`);
    } catch (err) { pbStatus(err.message, true); }
  }

  if (act) {
    if (!confirm(`Make "${BOOK.name}" the active price book? Every new costing will use it.`)) return;
    try {
      await DB.activatePriceBook(BOOK.id);
      BOOKS = await DB.listPriceBooks();
      await useBook(BOOK.id);
      pbStatus("Activated.");
    } catch (err) { pbStatus(err.message, true); }
  }
});

document.addEventListener("change", async e => {
  if (e.target.id !== "pbPick") return;
  await useBook(e.target.value);
});


/* =====================================================================
   Users tab — admin only.
   Role and activation are ordinary table writes guarded by RLS. Creating
   and deleting accounts goes through the admin-users Edge Function,
   because only it holds the service-role key.
   ===================================================================== */
let USERS = [];

function sheetUsers() {
  if (!ME || ME.role !== "admin")
    return `<h4>Users</h4><p class="ref">Only an administrator can manage accounts.
      You are signed in as <b>${esc(ME ? ME.role : "?")}</b>.</p>`;

  const rows = USERS.map(u => {
    const self = ME && u.id === ME.id;
    return { cls: self ? "tot" : "", cells: [
      u.full_name || "—",
      u.email,
      { v: `<select class="usrRole" data-id="${esc(u.id)}"${self ? " disabled" : ""}>` +
           ["viewer","estimator","admin"].map(r =>
             `<option value="${r}"${u.role===r?" selected":""}>${r}</option>`).join("") +
           `</select>`, raw:true },
      { v: u.is_active
            ? `<span class="ok">active</span>`
            : `<span class="wn">pending</span>`, raw:true },
      { v: self ? `<span class="ref">you</span>` : `
          <button data-act="${esc(u.id)}" data-to="${u.is_active ? "off" : "on"}">${
            u.is_active ? "Deactivate" : "Activate"}</button>
          <button data-pw="${esc(u.id)}">Reset password</button>
          <button data-delu="${esc(u.id)}">Delete</button>`, raw:true }
    ]};
  });

  return `<h4>Team accounts</h4>` +
    tbl(["Name","Email","Role","Status","Actions"], rows) + `
    <p class="ref">A role change saves immediately. <b>viewer</b> reads designs and prices,
      <b>estimator</b> can also save designs, <b>admin</b> can additionally change prices and
      manage accounts. You cannot change your own role or delete yourself, and the last active
      administrator cannot be removed.</p>

    <h4>Add an account</h4>
    <div class="savebar">
      <input id="nuName"  placeholder="Full name" style="flex:1 1 150px">
      <input id="nuEmail" type="email" placeholder="Email" style="flex:1 1 200px">
      <input id="nuPass"  type="text" placeholder="Temporary password (min 10)" style="flex:1 1 200px">
      <select id="nuRole">
        <option value="viewer">viewer</option>
        <option value="estimator" selected>estimator</option>
        <option value="admin">admin</option>
      </select>
      <button class="pri" id="nuAdd">Create</button>
      <span id="usrStatus"></span>
    </div>
    <p class="ref">The account works immediately &mdash; no confirmation email. Give the person
      the temporary password and have them change it. Creating accounts runs in a server-side
      function that holds the privileged key; the browser never sees it.</p>`;
}

async function reloadUsers() {
  if (!ME || ME.role !== "admin") { USERS = []; return; }
  try { USERS = await DB.listProfiles(); } catch (err) { USERS = []; }
}

function usrStatus(msg, bad) {
  const el = document.getElementById("usrStatus");
  if (!el) { if (bad) alert(msg); return; }
  el.textContent = msg; el.className = bad ? "bad" : "ok";
  if (!bad) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3500);
}

document.addEventListener("change", async e => {
  const sel = e.target.closest(".usrRole");
  if (!sel) return;
  try {
    await DB.setProfile(sel.dataset.id, { role: sel.value });
    await reloadUsers(); if (PAGES) PAGES.refresh();
    usrStatus("Role updated.");
  } catch (err) { usrStatus(err.message, true); }
});

document.addEventListener("click", async e => {
  const act = e.target.closest("[data-act]");
  const pw  = e.target.closest("[data-pw]");
  const del = e.target.closest("[data-delu]");
  const add = e.target.closest("#nuAdd");

  if (act) {
    try {
      await DB.setProfile(act.dataset.act, { is_active: act.dataset.to === "on" });
      await reloadUsers(); if (PAGES) PAGES.refresh();
      usrStatus(act.dataset.to === "on" ? "Activated." : "Deactivated.");
    } catch (err) { usrStatus(err.message, true); }
  }

  if (pw) {
    const p = prompt("New password for this account (at least 10 characters):");
    if (!p) return;
    try { await DB.resetPassword(pw.dataset.pw, p); usrStatus("Password reset."); }
    catch (err) { usrStatus(err.message, true); }
  }

  if (del) {
    const u = USERS.find(x => x.id === del.dataset.delu);
    if (!confirm(`Delete the account for ${u ? u.email : "this user"}? This cannot be undone. `
               + `Any designs they saved are kept and reassigned to you.`)) return;
    try { await DB.deleteUser(del.dataset.delu); await reloadUsers(); if (PAGES) PAGES.refresh();
          usrStatus("Account deleted."); }
    catch (err) { usrStatus(err.message, true); }
  }

  if (add) {
    const name  = document.getElementById("nuName").value.trim();
    const email = document.getElementById("nuEmail").value.trim();
    const pass  = document.getElementById("nuPass").value;
    const role  = document.getElementById("nuRole").value;
    if (!email || !pass) { usrStatus("Email and a temporary password are required.", true); return; }
    try {
      await DB.createUser(email, pass, role, name);
      await reloadUsers(); if (PAGES) PAGES.refresh();
      usrStatus(`Created ${email} as ${role}.`);
    } catch (err) { usrStatus(err.message, true); }
  }
});

/* =====================================================================
   wiring
   ===================================================================== */
/* recalc({rebuild}) — rebuild:true re-creates the input controls (boot, reset).
   Plain recalc() leaves every control untouched and only refreshes read-outs and
   the sheets below, so typing is never interrupted. */
function recalc(opts = {}) {
  R  = solve({ ...I, prices: PRICES, priceBookName: BOOK ? BOOK.name : null });
  SR = solveSpool(S);
  if (opts.rebuild) { renderInputs(); renderSpoolGrid(); renderTabs(); }
  updateDerived(R);
  updateSpoolDerived(SR);
  renderDisplay();
  renderPanel();
  renderSpoolOutputs(SR);
  save();
}

/* A number field is blank or half-typed ("", "-", "3.") for a keystroke or two.
   Keep the last good value for the engine but leave the box alone. */
function readNum(el, current) {
  if (el.value.trim() === "") return current;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : current;
}
const NUMERIC_I = new Set(["lengthFt","psi","degF","years","passes","longsQty","pitch",
  "colorPct","margin","reelSP","reelHub","reelT","tPitch","tPasses"]);

document.addEventListener("input", e => {
  const k = e.target.dataset.k, sk = e.target.dataset.sk;
  if (k) {
    I[k] = (e.target.type === "number" || NUMERIC_I.has(k)) ? readNum(e.target, I[k]) : e.target.value;
    recalc();
  } else if (sk) {
    S[sk] = (sk === "sizeKey") ? e.target.value : readNum(e.target, S[sk]);
    recalc();
  }
});
document.getElementById("tabs").addEventListener("click", e => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  TAB = b.dataset.tab; renderTabs(); renderPanel(); save();
});
document.getElementById("priceBasis").addEventListener("change", async e => {
  await useBook(e.target.value);
});
document.getElementById("resetBtn").addEventListener("click", () => {
  I = { ...DEFAULTS, priceBookId: I.priceBookId };
  S = { ...SPOOL_DEFAULTS };
  CURRENT_DESIGN = null;
  recalc({rebuild:true});
});
document.getElementById("themeBtn").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : cur === "light" ? "dark"
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", next);
  try{ localStorage.setItem(LS+"-theme", next); }catch(e){}
});

/* =====================================================================
   price book + designs
   ===================================================================== */
async function useBook(bookId) {
  BOOK = await DB.loadPriceBook(bookId || null);
  PRICES = BOOK.prices;
  I.priceBookId = BOOK.id;
  await reloadSheet();
  await reloadUsers();
  await PARTSUI.load(BOOK.id);
  await QUOTESUI.loadRefs(BOOK.id);
  const sel = document.getElementById("priceBasis");
  if (sel) sel.value = BOOK.id;
  if (PAGES) PAGES.refresh();   // keep the pricing page in step with the book
  recalc();
}

function renderBookPicker() {
  const sel = document.getElementById("priceBasis");
  sel.innerHTML = BOOKS.map(b =>
    `<option value="${esc(b.id)}"${BOOK && b.id === BOOK.id ? " selected" : ""}>${
      esc(b.name)}${b.status === "active" ? " (active)" : ` (${esc(b.status)})`}</option>`).join("");
}

async function refreshDesignList() {
  const host = document.getElementById("designList");
  if (!host) return;
  try {
    const rows = await DB.listDesigns();
    if (!rows.length) { host.innerHTML = `<p class="muted" style="margin:0">No saved designs yet.</p>`; return; }
    host.innerHTML = tbl(["Name","Client",{t:"$/ft",n:1},{t:"lb/ft",n:1},{t:"Burst",n:1},"Updated",""],
      rows.map(d => [
        d.name, ,
        {v: d.summary?.costPerFt != null ? money(d.summary.costPerFt) : "—", n:1},
        {v: d.summary?.weightPerFt != null ? f3(d.summary.weightPerFt) : "—", n:1},
        {v: d.summary?.burst != null ? f0(d.summary.burst) + " psi" : "—", n:1},
        new Date(d.updated_at).toLocaleDateString(),
        {v:`<button data-open="${esc(d.id)}">Open</button> <button data-del="${esc(d.id)}">Delete</button>`, raw:true}
      ]));
  } catch (err) { host.innerHTML = `<p class="bad" style="margin:0">${esc(err.message)}</p>`; }
}

async function openDesign(id) {
  const d = await DB.loadDesign(id);
  I = { ...DEFAULTS, ...d.inputs };
  CURRENT_DESIGN = { id: d.id, name: d.name, client: d.client };
  if (d.price_book_id && (!BOOK || d.price_book_id !== BOOK.id)) {
    try { await useBook(d.price_book_id); } catch (_) {}
  }
  recalc({ rebuild: true });
  document.getElementById("designName").value = d.name;
  document.getElementById("designClient").value = d.client || "";
  setStatus(`Opened "${d.name}".`);
}

async function doSave() {
  const name   = document.getElementById("designName").value.trim();
  const client = document.getElementById("designClient").value.trim();
  if (!name) { setStatus("Give the design a name first.", true); return; }
  const summary = {
    costPerFt: R.costPerFt, weightPerFt: R.weightPerFt, burst: R.burstTotal,
    sizeKey: R.sizeKey, psi: R.psi, degF: R.degF, sour: R.sour, app: R.app,
    sellPerFt: R.sellPerFt, lengthFt: R.lengthFt
  };
  try {
    const saved = await DB.saveDesign({
      id: CURRENT_DESIGN?.id, name, client, inputs: I, summary,
      priceBookId: BOOK ? BOOK.id : null
    });
    CURRENT_DESIGN = { id: saved.id, name: saved.name, client: saved.client };
    setStatus(`Saved "${saved.name}".`);
    refreshDesignList();
    // The Quotes page keeps its own copy of the design list; refresh it so a
    // newly saved design can be quoted without reloading the site.
    await QUOTESUI.reloadDesigns();
    if (PAGES) PAGES.refresh();
  } catch (err) { setStatus(err.message, true); }
}

function setStatus(msg, bad) {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = bad ? "bad" : "ok";
  if (!bad) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 4000);
}

document.addEventListener("click", async e => {
  const open = e.target.closest("[data-open]"), del = e.target.closest("[data-del]");
  if (open) { try { await openDesign(open.dataset.open); } catch (err) { setStatus(err.message, true); } }
  if (del) {
    if (!confirm("Delete this design? This cannot be undone.")) return;
    try { await DB.deleteDesign(del.dataset.del);
          if (CURRENT_DESIGN?.id === del.dataset.del) CURRENT_DESIGN = null;
          refreshDesignList();
          await QUOTESUI.reloadDesigns();
          if (PAGES) PAGES.refresh();
          setStatus("Deleted."); }
    catch (err) { setStatus(err.message, true); }
  }
});
document.getElementById("saveBtn").addEventListener("click", doSave);
document.getElementById("newBtn").addEventListener("click", () => {
  CURRENT_DESIGN = null;
  document.getElementById("designName").value = "";
  document.getElementById("designClient").value = "";
  setStatus("Started a new design. Saving will create a new record.");
});

/* =====================================================================
   boot — nothing renders until there is a session with an active profile
   ===================================================================== */
const $ = id => document.getElementById(id);

function showGate(view, msg, bad) {
  $("gate").hidden = view !== "signin" && view !== "pending";
  $("app").hidden  = view !== "app";
  $("signinForm").hidden = view !== "signin";
  $("pendingBox").hidden = view !== "pending";
  const m = $("signinMsg");
  if (m) { m.textContent = msg || ""; m.className = bad ? "bad" : "muted"; }
}

async function enterApp(profile) {
  ME = profile;
  // The build id is shown so a stale cached copy is identifiable at a glance.
  $("whoami").textContent = `${profile.full_name || profile.email} · ${profile.role} · ${BUILD}`;
  BOOKS = await DB.listPriceBooks();
  renderBookPicker();
  await useBook(I.priceBookId && BOOKS.some(b => b.id === I.priceBookId) ? I.priceBookId : null);
  renderBookPicker();
  showGate("app");

  // The parts UI borrows this module's formatters so the look stays consistent.
  PARTSUI.init({
    tbl, esc, money, f0,
    isAdmin: () => ME && ME.role === "admin",
    bookId:  () => BOOK && BOOK.id,
    refresh: () => { if (PAGES) PAGES.refresh(); }
  });

  QUOTESUI.init({
    tbl, esc, money, f0, f, tiles,
    isAdmin: () => ME && ME.role === "admin",
    bookId:  () => BOOK && BOOK.id,
    prices:  () => PRICES,
    refresh: () => { if (PAGES) PAGES.refresh(); }
  });
  // loadRefs already ran inside useBook() above.
  await QUOTESUI.loadList();

  PAGES = initPages({
    pricingHTML: sheetPricing, usersHTML: sheetUsers,
    quotesHTML:  QUOTESUI.quotesHTML, archiveHTML: QUOTESUI.archiveHTML
  });
  PAGES.showUsers(profile.role === "admin");
  PAGES.restore();

  recalc({ rebuild: true });
  refreshDesignList();
}

async function boot() {
  load();
  try { const th = localStorage.getItem(LS + "-theme");
        if (th) document.documentElement.setAttribute("data-theme", th); } catch (e) {}

  const session = await DB.currentSession();
  if (!session) { showGate("signin"); return; }
  try {
    const profile = await DB.currentProfile();
    if (!profile || !profile.is_active) { showGate("pending"); return; }
    await enterApp(profile);
  } catch (err) { showGate("signin", err.message, true); }
}

$("signinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("signinBtn");
  btn.disabled = true; showGate("signin", "Signing in…");
  try {
    await DB.signIn($("email").value.trim(), $("password").value);
    const profile = await DB.currentProfile();
    if (!profile || !profile.is_active) { showGate("pending"); return; }
    await enterApp(profile);
  } catch (err) {
    showGate("signin", err.message || "Could not sign in.", true);
  } finally { btn.disabled = false; }
});

for (const id of ["signoutBtn", "pendingSignout"]) {
  const b = $(id);
  if (b) b.addEventListener("click", async () => { await DB.signOut(); location.reload(); });
}

boot();
