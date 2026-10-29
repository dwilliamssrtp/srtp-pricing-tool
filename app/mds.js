/* =====================================================================
   Manufacturing Datasheet — its own page, laid out as a document.

   An MDS is a controlled sheet that goes to the floor, so it behaves
   differently from the rest of the tool:

     * It prints to ONE page. The layout is a fixed document, not a
       responsive dashboard, and the print rules scale it to fit.
     * A saved MDS FREEZES its design. Once issued it must keep saying
       what it said, even after the design or the price book moves on.
       Re-loading the live design is a deliberate click, not automatic.

   The workbook ships two versions that differ in exactly one figure, the
   FAT minimum burst: MDS prints the API minimum (MAOP x 2, or x 2.31 for
   Twaron) and MDS1 prints the short-term stress-rupture burst with no
   safety factor. Rather than keep two near-identical sheets, that is a
   toggle here and the choice is stored with the document.
   ===================================================================== */
import * as DB from "./db.js?v=20261029-1318";
import { solve } from "./engine.js?v=20261029-1318";

let H = null;                     // host helpers from ui.js
let DESIGNS = [], SAVED = [];
let DOC = null;                   // the open document
let VIEW = "sheet";               // sheet | list
let EDIT = false;                 // free-edit mode on the open sheet
let DIRTY = false;                // hand edits made since the last save

export function init(helpers) { H = helpers; }

export async function load() {
  try { [DESIGNS, SAVED] = await Promise.all([DB.listDesigns(), DB.listMds()]); }
  catch (e) { /* surfaced on the page */ }
}
export async function reloadDesigns() {
  try { DESIGNS = await DB.listDesigns(); } catch (e) {}
}

/* A fresh document built from whatever the Designer currently holds. */
export function fromCurrent(inputs, solved, bookId) {
  return {
    id: null, design_id: null,
    doc_number: "", revision: "A",
    title: solved.productName || "Manufacturing Datasheet",
    client: inputs.client || "", project: "",
    base_lead: "", braid_lead: "", cover_lead: "",
    issued_on: new Date().toISOString().slice(0, 10),
    burst_basis: "api", scrap_pct: 0.05, notes: "", overrides: {},
    price_book_id: bookId || null,
    snapshot: { inputs, solved: pick(solved) }
  };
}

/* Only what the sheet prints is frozen; the whole solve object would
   bloat every row for no gain. */
function pick(r) {
  const keys = ["productName","sizeKey","psi","bar","degF","degC","lengthFt","lengthM",
    "sour","service","h2s","co2","years","app","apiNominal","mdsSize",
    "liner","bond","backer","jacket","colorMB","base","baseWt","baseOD","specWT",
    "linerLabel","bondLabel","backerLabel","jacketLabel","colorLabel",
    "skinThk","bondThk","backerThk","linerID","jacketOD","jacketID","jacketThk",
    "jacketWt","colorWt","weightPerFt","xbraid","longsName","longsQty","pitch",
    "pitch2","pitch3","passes","A56","A57","A58","A59","xWt","xWtPerPass","longsWt",
    "longsWtRaw","braidAngle","burstTotal","minBurst","shortBurst","targetBurstR",
    "hydroP","hydroFactor","couplingName","reelSP","reelHub","reelT","minD",
    "lenFinished","lenBraid","lenBase","reelMax","reelWeight","nReels",
    "printLine1","printLine2","printLine3","tensileStrength","is24T","tBraid","tWt","tPitch"];
  const o = {};
  for (const k of keys) if (r[k] !== undefined) o[k] = r[k];
  return o;
}

/* Scrap is stored as a fraction. A document saved before this field existed
   has no value at all, so fall back to the 5% the floor assumes. */
const SCRAP_DEFAULT = 0.05;
function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : SCRAP_DEFAULT;
}

/* ------------------------------------------------------- free edit ----

   Every printed figure on the sheet is computed from the frozen snapshot,
   so a hand correction cannot simply live in the markup: the page is
   regenerated from the model on each refresh and would wipe it. Instead
   each editable cell carries a stable key and the typed text is stored in
   DOC.overrides under that key. Rendering prefers the override; deleting
   the key returns the cell to the computed value.

   Keys are the sheet's own row and column names ("1.2.wall"), so they stay
   meaningful across a save, a reload and a revision. The one case they can
   drift is "Reload design" onto a design with a different number of braid
   passes, since rows 2.3-2.5 only exist for some designs - which is why
   reloading warns when overrides are present.

   An override is user-typed text and is escaped on the way out. A computed
   value is markup this module built (entities, the API monogram) and is
   not, so the two are deliberately not interchangeable below. */

const ovMap = () => (DOC && DOC.overrides && typeof DOC.overrides === "object")
  ? DOC.overrides : {};
const ovHas = k => Object.prototype.hasOwnProperty.call(ovMap(), k);
export const ovCount = () => Object.keys(ovMap()).length;

/* Documents saved before this existed have no map at all. */
function ovEnsure() {
  if (!DOC.overrides || typeof DOC.overrides !== "object") DOC.overrides = {};
  return DOC.overrides;
}

function ov(key, computed) {
  const edited = ovHas(key);
  const body = edited ? H.esc(String(ovMap()[key])) : String(computed);
  if (!EDIT) return edited ? `<span class="ovd">${body}</span>` : body;
  return `<span class="ove${edited ? " ovd" : ""}" data-ov="${H.esc(key)}"`
       + ` contenteditable="true" spellcheck="false">${body}</span>`;
}

export const current = () => DOC;
export const hasDoc  = () => !!DOC;

export function openFromDesigner(inputs, solved, bookId) {
  DOC = fromCurrent(inputs, solved, bookId);
  VIEW = "sheet";
}

/* ==================================================================== */
export function mdsHTML() {
  if (!H) return "";
  if (VIEW === "list") return listView();
  if (!DOC) return emptyView();
  return sheetView();
}

function emptyView() {
  const { esc } = H;
  return `
    <div class="savebar noprint">
      <button id="mdsFromDesigner" class="pri">Build from the current design</button>
      <select id="mdsPickDesign" style="flex:1 1 260px">
        <option value="">— or load a saved design —</option>
        ${DESIGNS.map(d => `<option value="${esc(d.id)}">${esc(d.name)}${
          d.client ? " · " + esc(d.client) : ""}</option>`).join("")}
      </select>
      <button id="mdsSavedList">Saved datasheets (${SAVED.length})</button>
      <span id="mdsStatus"></span>
    </div>
    <p class="ref">An MDS freezes the design it was built from, so an issued sheet keeps saying
      what it said even after the design changes. Pick a design to start.</p>`;
}

function listView() {
  const { tbl, esc } = H;
  const rows = SAVED.map(m => ({ cells: [
    m.doc_number || "—",
    m.revision,
    m.title,
    m.client || "—",
    m.project || "—",
    m.issued_on || "—",
    { v: `<button data-mdsopen="${esc(m.id)}">Open</button>
          <button data-mdsdel="${esc(m.id)}">Delete</button>`, raw: true }
  ]}));
  return `
    <div class="savebar noprint">
      <button id="mdsBackSheet">← Back to the datasheet</button>
      <span class="ref">${SAVED.length} saved</span>
      <span id="mdsStatus"></span>
    </div>`
    + (rows.length
        ? tbl(["Doc number","Rev","Title","Client","Project","Issued",""], rows)
        : `<p class="ref">Nothing saved yet.</p>`);
}

/* -------------------------------------------------------------------- */
function sheetView() {
  const { esc, f, f0, f3, f4 } = H;
  const d = DOC, s = d.snapshot.solved, i = d.snapshot.inputs;
  const fat = d.burst_basis === "api" ? s.minBurst : s.shortBurst;
  const fatLabel = d.burst_basis === "api"
    ? `API minimum · MAOP × ${(s.xbraid || "").slice(0,2) === "KN" ? "2.31" : "2.00"}`
    : "Short-term stress-rupture burst, no safety factor";

  /* Supplied is what the customer gets; manufactured is what the floor runs to
     yield it, and that is the length this sheet is for - the headline length
     and every material quantity in sections 1-3 move with the scrap figure.
     The scrap PERCENTAGE is not printed: the floor is told what to build, not
     the allowance it came from. The reel plan stays on the supplied length,
     because scrap is trimmed off and never ships. */
  const scrapPct = pct(d.scrap_pct);
  const mfgFt    = Math.ceil(s.lengthFt * (1 + scrapPct));

  const nOv = ovCount();
  const ctrl = `
    <div class="savebar noprint">
      <button id="mdsEdit" class="${EDIT ? "pri" : ""}"
        title="Type directly into any figure or wording on the sheet">${
        EDIT ? "&#10003; Free edit on" : "Free edit"}</button>
      ${EDIT || nOv ? `<button id="mdsResetOv"${nOv ? "" : " disabled"}
        title="Discard every hand edit and return the sheet to the design">Reset edits${
        nOv ? ` (${nOv})` : ""}</button>` : ""}
      <button id="mdsReload" title="Replace the frozen snapshot with the live design">Reload design</button>
      <select id="mdsPickDesign" style="flex:1 1 220px">
        <option value="">— load another design —</option>
        ${DESIGNS.map(x => `<option value="${esc(x.id)}">${esc(x.name)}${
          x.client ? " · " + esc(x.client) : ""}</option>`).join("")}
      </select>
      <select id="mdsBasis" title="Which figure prints as the FAT minimum burst">
        <option value="api"${d.burst_basis === "api" ? " selected" : ""}>FAT: API minimum</option>
        <option value="stress_rupture"${d.burst_basis === "stress_rupture" ? " selected" : ""}>FAT: stress rupture</option>
      </select>
      <button class="pri" id="mdsSave">${
        DIRTY ? "Save edits" : d.id ? "Save" : "Save as new"}</button>
      ${d.id ? `<button id="mdsRevise" title="Save as the next revision">New revision</button>` : ""}
      <button id="mdsPrint">Print</button>
      <button id="mdsSavedList">Saved (${SAVED.length})</button>
      <span id="mdsStatus"></span>
    </div>

    <div class="savebar noprint">
      <label class="ref">Doc no <input class="mdsf" data-f="doc_number" value="${esc(d.doc_number)}" style="width:130px"></label>
      <label class="ref">Rev <input class="mdsf" data-f="revision" value="${esc(d.revision)}" style="width:48px"></label>
      <label class="ref">Project <input class="mdsf" data-f="project" value="${esc(d.project || "")}" style="width:150px"></label>
      <label class="ref">Client <input class="mdsf" data-f="client" value="${esc(d.client || "")}" style="width:140px"></label>
      <label class="ref">Issued <input class="mdsf" data-f="issued_on" type="date" value="${esc(d.issued_on || "")}"></label>
      <label class="ref" title="Expected scrap, added to the supplied length to give the length actually built">Scrap %
        <input class="mdsf" data-f="scrap_pct" type="number" step="0.5" min="0" max="99"
          value="${f(scrapPct * 100, 2)}" style="width:68px;text-align:right"></label>
      <label class="ref">Baseline <input class="mdsf" data-f="base_lead" value="${esc(d.base_lead || "")}" style="width:104px"></label>
      <label class="ref">Braidline <input class="mdsf" data-f="braid_lead" value="${esc(d.braid_lead || "")}" style="width:104px"></label>
      <label class="ref">Coverline <input class="mdsf" data-f="cover_lead" value="${esc(d.cover_lead || "")}" style="width:104px"></label>
    </div>
    ${EDIT ? `<p class="ref noprint editnote">Free edit is on. Click any figure or wording
      on the sheet and type over it. An edited cell stays marked, emptying one restores
      the computed value, and the edits are kept with the document — so they survive a
      reload of the design and <b>Reset edits</b> is the way back to what it solves to.</p>`
    : nOv ? `<p class="ref noprint editnote">${nOv} cell${nOv === 1 ? "" : "s"} on this
      sheet ${nOv === 1 ? "is a hand edit" : "are hand edits"}, not what the design
      solves to.</p>` : ""}`;

  /* The row name is editable too: a hand-corrected material callout is the
     single most common reason to reach for this. */
  const layer = (n, name, cells) =>
    `<tr><td class="mn">${n}</td><td class="ml">${ov(n + ".name", esc(name))}</td>${cells}</tr>`;
  const td = (v, cls) => `<td${cls ? ` class="${cls}"` : ""}>${v}</td>`;
  /* One editable cell, keyed by its row and column so the key survives a save,
     a revision and a reload. */
  const c = (n, col, v) => td(ov(n + "." + col, v));
  const inch = x => f(x) + "&Prime;";

  const base = `
    <table class="mds">
      <thead><tr><th colspan="2">1 &nbsp; ${ov("h.1", "Base tube")}</th>
        <th>Wall, in</th><th>ID, in</th><th>OD, in</th><th>lbs/ft</th><th>Mfg lbs (ref)</th></tr></thead>
      <tbody>
        ${layer("1.1", s.linerLabel || s.liner,
            c("1.1","wall",f3(s.skinThk)) + c("1.1","id",f3(s.base[0].id)) + c("1.1","od",f3(s.base[0].od))
          + c("1.1","lbft",f4(s.base[0].wt)) + c("1.1","mfg",f0(Math.ceil(s.base[0].wt * mfgFt))))}
        ${layer("1.2", s.bondLabel || s.bond,
            c("1.2","wall",f3(s.bondThk)) + c("1.2","id",f3(s.base[1].id)) + c("1.2","od",f3(s.base[1].od))
          + c("1.2","lbft",f4(s.base[1].wt)) + c("1.2","mfg",f0(Math.ceil(s.base[1].wt * mfgFt))))}
        ${layer("1.3", s.backerLabel || s.backer,
            c("1.3","wall",f3(s.backerThk)) + c("1.3","id",f3(s.base[2].id)) + c("1.3","od",f3(s.baseOD))
          + c("1.3","lbft",f4(s.base[2].wt)) + c("1.3","mfg",f0(Math.ceil(s.base[2].wt * mfgFt))))}
        <tr class="tot"><td></td><td class="ml">${ov("1.t.name", "Base tube, ovality 0&ndash;5%")}</td>
          ${c("1.t","wall",f3(s.specWT))}${c("1.t","id",f3(s.linerID))}${c("1.t","od",f3(s.baseOD))}
          ${c("1.t","lbft",f4(s.baseWt))}${c("1.t","mfg",f0(Math.ceil(s.baseWt * mfgFt)))}</tr>
      </tbody>
    </table>`;

  const kg = x => `${f(x, 1)} (${f(x / 2.2, 1)})`;
  const braidRows = [
    layer("2.1", s.longsName,
        c("2.1","n",f0(s.longsQty)) + c("2.1","pitch","&mdash;") + c("2.1","od","&mdash;")
      + c("2.1","lbft",f4(s.longsWt)) + c("2.1","mfg",kg(s.longsWtRaw * mfgFt))),
    layer("2.2", s.xbraid,
        c("2.2","n","Pass 1") + c("2.2","pitch",inch(s.pitch)) + c("2.2","od",f3(s.A57))
      + c("2.2","lbft",f4(s.xWt)) + c("2.2","mfg",kg(s.xWtPerPass * mfgFt)))
  ];
  if (s.passes >= 2) braidRows.push(layer("2.3", s.xbraid,
      c("2.3","n","Pass 2") + c("2.3","pitch",inch(s.pitch2)) + c("2.3","od",f3(s.A58))
    + c("2.3","lbft","") + c("2.3","mfg",kg(s.xWtPerPass * mfgFt))));
  if (s.passes >= 3) braidRows.push(layer("2.4", s.xbraid,
      c("2.4","n","Pass 3") + c("2.4","pitch",inch(s.pitch3)) + c("2.4","od",f3(s.A59))
    + c("2.4","lbft","") + c("2.4","mfg",kg(s.xWtPerPass * mfgFt))));
  if (s.is24T) braidRows.push(layer("2.5", "24-Tensile · " + s.tBraid,
      c("2.5","n","24 ends") + c("2.5","pitch",inch(s.tPitch)) + c("2.5","od","")
    + c("2.5","lbft",f4(s.tWt)) + c("2.5","mfg","")));

  const braid = `
    <table class="mds">
      <thead><tr><th colspan="2">2 &nbsp; ${ov("h.2", "Reinforcement")}</th>
        <th>Number / pass</th><th>Pitch &plusmn;0.040</th><th>OD, in</th><th>lbs/ft</th><th>Mfg lbs (kg)</th></tr></thead>
      <tbody>${braidRows.join("")}</tbody>
    </table>`;

  const cover = `
    <table class="mds">
      <thead><tr><th colspan="2">3 &nbsp; ${ov("h.3", "Cover")}</th>
        <th>Min wall</th><th>Wall, in</th><th>OD, in &plusmn;0.01</th><th>lbs/ft</th><th>Mfg lbs (ref)</th></tr></thead>
      <tbody>
        ${layer("3.1", s.jacketLabel || s.jacket,
            c("3.1","min","&ge;0.070") + c("3.1","wall",f4(s.jacketThk)) + c("3.1","od",f3(s.jacketOD))
          + c("3.1","lbft",f4(s.jacketWt)) + c("3.1","mfg",f0(Math.ceil(s.jacketWt * mfgFt))))}
        ${layer("3.2", s.colorLabel || s.colorMB,
            c("3.2","min","") + c("3.2","wall","") + c("3.2","od","")
          + c("3.2","lbft",f4(s.colorWt)) + c("3.2","mfg",f0(Math.ceil(s.colorWt * mfgFt))))}
        <tr class="tot"><td></td><td class="ml">${ov("3.t.name", "Finished product")}</td>
          ${c("3.t","min","")}${c("3.t","wall",f4(s.jacketThk))}${c("3.t","od",f3(s.jacketOD))}
          ${c("3.t","lbft",f3(s.weightPerFt))}${c("3.t","mfg",f0(Math.ceil(s.weightPerFt * mfgFt)))}</tr>
      </tbody>
    </table>`;

  const reel = `
    <table class="mds">
      <thead><tr><th colspan="2">4 &nbsp; ${ov("h.4", "Reel")}</th>
        <th>SP</th><th>HD</th><th>T</th><th>Min bend</th><th>Per reel</th></tr></thead>
      <tbody>
        <tr><td class="mn">4.1</td><td class="ml">${ov("4.1.name",
            `Reel SP${f0(s.reelSP)}-HD${f0(s.reelHub)}-T${f0(s.reelT)}`)}</td>
          ${c("4.1","sp",f0(s.reelSP))}${c("4.1","hd",f0(s.reelHub))}${c("4.1","t",f0(s.reelT))}
          ${c("4.1","bend",f(s.minD, 1) + "D")}${c("4.1","per",f0(s.lenFinished) + " ft")}</tr>
        <tr><td class="mn">4.2</td><td class="ml">${ov("4.2.name",
            `Target length: base ${f0(s.lenBase)} ft &middot; braid ${f0(s.lenBraid)} ft &middot; finished ${f0(s.lenFinished)} ft`)}</td>
          <td colspan="5">${ov("4.2.per",
            `${f0(s.nReels)} reel(s) &middot; ${f0(s.reelWeight)} lbs each (${f0(s.reelWeight / 2.2)} kg) &middot; max ${f0(s.reelMax)} ft`)}</td>
        </tr>
      </tbody>
    </table>`;

  const print = `
    <table class="mds">
      <thead><tr><th colspan="7">5 &nbsp; ${ov("h.5", "Print legend")}</th></tr></thead>
      <tbody>
        <tr><td class="mn">5.1</td><td class="ml" colspan="6">${apiMark(s)}<span class="cell">${
          ov("5.1", esc(s.printLine1))}</span></td></tr>
        <tr><td class="mn">5.2</td><td class="ml" colspan="6"><span class="cell">${
          ov("5.2", esc(s.printLine2))}</span></td></tr>
        <tr><td class="mn">5.3</td><td class="ml" colspan="6"><span class="cell">${
          ov("5.3", esc(s.printLine3))}</span></td></tr>
        <tr><td class="mn">5.4</td><td class="ml" colspan="6">${ov("5.4",
          `Date code is Year Month Day Hour, e.g. 2022010910, suffix &ldquo;01&rdquo; for Stafford TX. Print every 3 ft, minimum 1/4&Prime; character height.`)}</td></tr>
      </tbody>
    </table>`;

  const kv = (k, key, v) => `<div class="kv"><span>${k}</span><b>${ov(key, v)}</b></div>`;

  return ctrl + `
  <div class="sheetwrap">
    <article class="mdsdoc${EDIT ? " editing" : ""}" id="mdsDoc">
      <header class="mdshead">
        <div>
          <h1>${ov("title", "Manufacturing Datasheet")}</h1>
          <p class="sub">${ov("addr", "Specialty RTP &middot; 11317 Cash Rd, Stafford TX 77477")}</p>
        </div>
        <table class="meta">
          <tr><td>Document</td><th>${esc(d.doc_number || "—")}</th>
              <td>Revision</td><th>${esc(d.revision)}</th></tr>
          <tr><td>Project</td><th>${esc(d.project || "—")}</th>
              <td>Issued</td><th>${esc(d.issued_on || "—")}</th></tr>
          <tr><td>Client</td><th colspan="3">${esc(d.client || "—")}</th></tr>
        </table>
      </header>

      <h2 class="prod">${ov("prod", esc(s.productName))}</h2>

      <!-- Design pressure, temperature, service, hydrotest, service life and
           coupling are deliberately absent: they are design conditions, and
           the pressure and temperature already read off the product title
           immediately above. The MDS carries what the floor builds.
           API nominal stays: it also leads the Designer's headline strip. -->
      <div class="kvrow">
        ${kv("Application", "kv.app", esc(s.app))}
        ${kv("API nominal", "kv.nom", f(s.apiNominal, 2) + " in")}
        ${kv("FAT min burst", "kv.fat", f0(fat) + " psi")}
        ${kv("Length", "kv.len", f0(mfgFt) + " ft / " + f0(mfgFt / 3.28) + " m")}
      </div>
      <p class="basis">${ov("basis",
        `FAT basis: ${esc(fatLabel)}. Burst achieved ${f0(s.burstTotal)} psi at a ${
          f(s.braidAngle, 1)}&deg; braid angle. Tensile ${f0(s.tensileStrength)} lbs.`)}</p>

      ${base}${braid}${cover}${reel}${print}

      ${d.notes ? `<p class="notes"><b>Notes.</b> ${esc(d.notes)}</p>` : ""}

      <footer class="mdsfoot">
        <div><span>Baseline lead</span><b>${esc(d.base_lead || "")}</b></div>
        <div><span>Braidline lead</span><b>${esc(d.braid_lead || "")}</b></div>
        <div><span>Coverline lead</span><b>${esc(d.cover_lead || "")}</b></div>
      </footer>
    </article>
  </div>
  <div class="savebar noprint" style="margin-top:10px">
    <input class="mdsf" data-f="notes" placeholder="Notes printed on the sheet"
      value="${esc(d.notes || "")}" style="flex:1 1 100%">
  </div>`;
}

/* ------------------------------------------------------------ events */
function status(msg, bad) {
  const el = document.getElementById("mdsStatus");
  if (!el) return;
  el.textContent = msg; el.className = bad ? "bad" : "ok";
  if (!bad) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3500);
}

async function buildFromDesign(designId) {
  const design = await DB.loadDesign(designId);
  const solved = solve({ ...design.inputs, prices: H.prices() });
  DOC = fromCurrent(design.inputs, solved, H.bookId());
  DOC.design_id = design.id;
  DOC.title = design.name;
  DOC.client = design.client || DOC.client;
  EDIT = false; DIRTY = false;
  VIEW = "sheet";
}

/* Re-solve the design behind THIS document and swap in the new snapshot,
   keeping everything the document itself owns: its identity and number, the
   revision, the leads, notes, scrap, FAT basis and the hand edits. Building a
   whole fresh document here instead would quietly drop all of that, which
   matters much more now that hand edits are among the things it would drop. */
async function reloadSnapshot() {
  if (DOC.design_id) {
    const design = await DB.loadDesign(DOC.design_id);
    const solved = solve({ ...design.inputs, prices: H.prices() });
    DOC.snapshot = { inputs: design.inputs, solved: pick(solved) };
    DOC.price_book_id = H.bookId() || DOC.price_book_id;
  } else {
    DOC.snapshot = { inputs: H.inputs(), solved: pick(H.solved()) };
  }
  DIRTY = true;
}

document.addEventListener("click", async e => {
  if (!H) return;
  const open = e.target.closest("[data-mdsopen]");
  const del  = e.target.closest("[data-mdsdel]");
  const id   = e.target.id;
  try {
    if (open) {
      DOC = await DB.loadMds(open.dataset.mdsopen);
      EDIT = false; DIRTY = false; VIEW = "sheet"; H.refresh(); return;
    }
    if (del)  {
      if (!confirm("Delete this datasheet?")) return;
      await DB.deleteMds(del.dataset.mdsdel);
      SAVED = await DB.listMds(); H.refresh(); status("Deleted."); return;
    }
    if (id === "mdsSavedList") { SAVED = await DB.listMds(); VIEW = "list"; H.refresh(); return; }
    if (id === "mdsBackSheet") { VIEW = "sheet"; H.refresh(); return; }
    if (id === "mdsPrint")     { window.print(); return; }

    if (id === "mdsEdit") {
      /* Leaving edit mode commits whatever cell still has the caret in it:
         the browser fires no blur when the markup is replaced underneath. */
      if (EDIT) commitOpenCell();
      EDIT = !EDIT; H.refresh();
      status(EDIT ? "Free edit on — click any figure and type."
                  : DIRTY ? "Free edit off. Edits are not saved yet."
                          : "Free edit off.");
      return;
    }
    if (id === "mdsResetOv") {
      const n = ovCount();
      if (!n) return;
      if (!confirm(`Discard ${n} hand edit${n === 1 ? "" : "s"} and return the sheet `
                 + `to what the design solves to?`)) return;
      DOC.overrides = {}; DIRTY = true; H.refresh();
      status(`Reset ${n} edit${n === 1 ? "" : "s"}.`);
      return;
    }

    if (id === "mdsFromDesigner") {
      DOC = fromCurrent(H.inputs(), H.solved(), H.bookId());
      EDIT = false; DIRTY = false;
      VIEW = "sheet"; H.refresh(); status("Built from the current design."); return;
    }
    if (id === "mdsReload") {
      /* A hand edit sits on top of the snapshot, so it survives the swap and
         can end up contradicting the figure underneath it. Say so rather than
         silently keeping or silently dropping them. */
      const n = ovCount();
      if (n && !confirm(`This sheet has ${n} hand edit${n === 1 ? "" : "s"}, which stay `
                      + `on top of the reloaded design and may now disagree with it.\n\n`
                      + `Reload anyway? Reset edits afterwards to clear them.`)) return;
      if (EDIT) commitOpenCell();
      await reloadSnapshot();
      H.refresh(); status("Snapshot refreshed from the design."); return;
    }
    if (id === "mdsSave" || id === "mdsRevise") {
      if (EDIT) commitOpenCell();
      const row = { ...DOC, overrides: ovEnsure() };
      if (id === "mdsRevise") { row.id = null; row.revision = nextRev(DOC.revision); }
      delete row.created_at; delete row.updated_at; delete row.created_by;
      const saved = await DB.saveMds(row);
      DOC = saved; DIRTY = false; SAVED = await DB.listMds();
      H.refresh();
      const n = ovCount();
      status(`Saved ${saved.doc_number || saved.title} rev ${saved.revision}`
           + `${n ? ` with ${n} hand edit${n === 1 ? "" : "s"}` : ""}.`);
      return;
    }
  } catch (err) { status(err.message, true); }
});

const nextRev = r => {
  const t = String(r || "A").trim();
  return /^[A-Z]$/.test(t) ? String.fromCharCode(t.charCodeAt(0) + 1)
       : /^\d+$/.test(t)   ? String(Number(t) + 1) : t + "1";
};

/* ------------------------------------------------- free-edit capture --

   The sheet is regenerated from the model on every refresh, so typing has to
   be recorded into DOC.overrides and NOT refreshed as it happens - a refresh
   mid-word would replace the element holding the caret and throw the cursor
   out of the cell. So: record on input, redraw only once the cell is left.

   Text is taken as innerText, never innerHTML: the override is stored as the
   words the user typed and escaped again on the way out, so a pasted <b> or
   an & in a material name prints as the characters they are. */

function readCell(el) { return el.innerText.replace(/\s+/g, " ").trim(); }

/* Records what a cell now holds and reports which of three things happened,
   because the caller has to redraw for one of them and must not for the
   others. "cleared" means the key is gone and the computed value belongs
   back in the cell - which only a redraw can put there.

   Clearing is deliberately NOT done while typing: a key deleted on the
   keystroke that empties the cell would leave the blank element sitting
   there with nothing left to tell the sheet to redraw it. Emptying is
   therefore committed when the cell is left. */
function recordCell(el, committing) {
  const key = el.dataset.ov;
  if (!key || !DOC) return "none";
  const map = ovEnsure();
  const typed = readCell(el);
  const had = Object.prototype.hasOwnProperty.call(map, key);
  if (!typed) {
    if (!committing || !had) return "none";
    delete map[key]; DIRTY = true; return "cleared";
  }
  if (map[key] === typed) return "none";
  map[key] = typed; DIRTY = true;
  return "set";
}

/* Whatever cell currently holds the caret, if any. */
function commitOpenCell() {
  const el = document.activeElement;
  if (el && el.dataset && el.dataset.ov) recordCell(el, true);
}

document.addEventListener("input", e => {
  const cell = e.target.closest ? e.target.closest("[data-ov]") : null;
  if (!cell || !DOC) return;
  /* Model only: no refresh while typing, or the element holding the caret
     would be replaced mid-word. What a redraw would have updated - the cell's
     own mark and the two buttons that count edits - is nudged by hand. */
  const what = recordCell(cell, false);
  if (what === "set") cell.classList.add("ovd");
  const btn = document.getElementById("mdsResetOv");
  if (btn) { const n = ovCount(); btn.disabled = !n; btn.textContent = `Reset edits (${n})`; }
  const save = document.getElementById("mdsSave");
  if (save && DIRTY) save.textContent = "Save edits";
});

/* Leaving the cell is the moment to commit it. A cell left empty has just
   given up its override, so the sheet is redrawn to put the computed value
   back; a cell with text in it needs no redraw, and redrawing on every blur
   would throw away a click aimed straight at the next cell. */
document.addEventListener("focusout", e => {
  const cell = e.target.closest ? e.target.closest("[data-ov]") : null;
  if (!cell || !DOC || !EDIT) return;
  if (recordCell(cell, true) === "cleared") H.refresh();
});

/* Enter inside a one-line cell should finish it, not open a second line. */
document.addEventListener("keydown", e => {
  const cell = e.target.closest ? e.target.closest("[data-ov]") : null;
  if (!cell) return;
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); cell.blur(); }
  if (e.key === "Escape") { e.preventDefault(); cell.blur(); }
});

document.addEventListener("change", async e => {
  if (!H) return;
  const f = e.target.closest(".mdsf");
  const pick2 = e.target.id === "mdsPickDesign" ? e.target : null;
  const basis = e.target.id === "mdsBasis" ? e.target : null;
  try {
    if (f && DOC) {
      const k = f.dataset.f;
      DOC[k] = k === "scrap_pct" ? pct(Number(e.target.value) / 100) : e.target.value;
      DIRTY = true; H.refresh(); return;
    }
    if (basis && DOC) { DOC.burst_basis = basis.value; DIRTY = true; H.refresh(); return; }
    if (pick2 && pick2.value) { await buildFromDesign(pick2.value); H.refresh();
      status("Loaded."); return; }
  } catch (err) { status(err.message, true); }
});

/* The API 15S monogram that precedes the licence number on the print legend.

   The monogram is API's registered certification mark, so it is NOT drawn
   here — reproducing a certification mark in code would be passing off
   artwork that only the licensor issues. Drop the licensed file at
   assets/api-15s.png and it appears; until then the slot removes itself and
   the line prints as it always has. Only shown on a 15S line, since LPG and
   downhole product does not carry the mark. */
function apiMark(s) {
  if (!/15S/.test(String(s.printLine1 || ""))) return "";
  return `<img class="apimark" src="assets/api-15s.png" alt="API 15S"
            onerror="this.remove()">`;
}
