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
import * as DB from "./db.js?v=20261012-1609";
import { solve } from "./engine.js?v=20261012-1609";

let H = null;                     // host helpers from ui.js
let DESIGNS = [], SAVED = [];
let DOC = null;                   // the open document
let VIEW = "sheet";               // sheet | list

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
    prepared_by: "", approved_by: "",
    issued_on: new Date().toISOString().slice(0, 10),
    burst_basis: "api", notes: "",
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

  const ctrl = `
    <div class="savebar noprint">
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
      <button class="pri" id="mdsSave">${d.id ? "Save" : "Save as new"}</button>
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
      <label class="ref">Prepared <input class="mdsf" data-f="prepared_by" value="${esc(d.prepared_by || "")}" style="width:110px"></label>
      <label class="ref">Approved <input class="mdsf" data-f="approved_by" value="${esc(d.approved_by || "")}" style="width:110px"></label>
      <label class="ref">Issued <input class="mdsf" data-f="issued_on" type="date" value="${esc(d.issued_on || "")}"></label>
    </div>`;

  const layer = (n, name, cells) =>
    `<tr><td class="mn">${n}</td><td class="ml">${esc(name)}</td>${cells}</tr>`;
  const td = (v, cls) => `<td${cls ? ` class="${cls}"` : ""}>${v}</td>`;

  const base = `
    <table class="mds">
      <thead><tr><th colspan="2">1 &nbsp; Base tube</th>
        <th>Wall, in</th><th>ID, in</th><th>OD, in</th><th>lbs/ft</th><th>Project lbs (ref)</th></tr></thead>
      <tbody>
        ${layer("1.1", s.linerLabel || s.liner,  td(f3(s.skinThk)) + td(f3(s.base[0].id)) + td(f3(s.base[0].od))
                                 + td(f4(s.base[0].wt)) + td(f0(Math.ceil(s.base[0].wt * s.lengthFt))))}
        ${layer("1.2", s.bondLabel || s.bond,   td(f3(s.bondThk)) + td(f3(s.base[1].id)) + td(f3(s.base[1].od))
                                 + td(f4(s.base[1].wt)) + td(f0(Math.ceil(s.base[1].wt * s.lengthFt))))}
        ${layer("1.3", s.backerLabel || s.backer, td(f3(s.backerThk)) + td(f3(s.base[2].id)) + td(f3(s.baseOD))
                                 + td(f4(s.base[2].wt)) + td(f0(Math.ceil(s.base[2].wt * s.lengthFt))))}
        <tr class="tot"><td></td><td class="ml">Base tube, ovality 0&ndash;5%</td>
          ${td(f3(s.specWT))}${td(f3(s.linerID))}${td(f3(s.baseOD))}
          ${td(f4(s.baseWt))}${td(f0(Math.ceil(s.baseWt * s.lengthFt)))}</tr>
      </tbody>
    </table>`;

  const kg = x => `${f(x, 1)} (${f(x / 2.2, 1)})`;
  const braidRows = [
    layer("2.1", s.longsName, td(f0(s.longsQty)) + td("&mdash;") + td("&mdash;")
          + td(f4(s.longsWt)) + td(kg(s.longsWtRaw * s.lengthFt))),
    layer("2.2", s.xbraid, td("Pass 1") + td(f(s.pitch) + '"') + td(f3(s.A57))
          + td(f4(s.xWt)) + td(kg(s.xWtPerPass * s.lengthFt)))
  ];
  if (s.passes >= 2) braidRows.push(layer("2.3", s.xbraid,
    td("Pass 2") + td(f(s.pitch2) + '"') + td(f3(s.A58)) + td("") + td(kg(s.xWtPerPass * s.lengthFt))));
  if (s.passes >= 3) braidRows.push(layer("2.4", s.xbraid,
    td("Pass 3") + td(f(s.pitch3) + '"') + td(f3(s.A59)) + td("") + td(kg(s.xWtPerPass * s.lengthFt))));
  if (s.is24T) braidRows.push(layer("2.5", "24-Tensile · " + s.tBraid,
    td("24 ends") + td(f(s.tPitch) + '"') + td("") + td(f4(s.tWt)) + td("")));

  const braid = `
    <table class="mds">
      <thead><tr><th colspan="2">2 &nbsp; Reinforcement</th>
        <th>Number / pass</th><th>Pitch &plusmn;0.040</th><th>OD, in</th><th>lbs/ft</th><th>lbs (kg)</th></tr></thead>
      <tbody>${braidRows.join("")}</tbody>
    </table>`;

  const cover = `
    <table class="mds">
      <thead><tr><th colspan="2">3 &nbsp; Cover</th>
        <th>Min wall</th><th>Wall, in</th><th>OD, in &plusmn;0.01</th><th>lbs/ft</th><th>Project lbs (ref)</th></tr></thead>
      <tbody>
        ${layer("3.1", s.jacketLabel || s.jacket, td("&ge;0.070") + td(f4(s.jacketThk)) + td(f3(s.jacketOD))
                + td(f4(s.jacketWt)) + td(f0(Math.ceil(s.jacketWt * s.lengthFt))))}
        ${layer("3.2", s.colorLabel || s.colorMB, td("") + td("") + td("")
                + td(f4(s.colorWt)) + td(f0(Math.ceil(s.colorWt * s.lengthFt))))}
        <tr class="tot"><td></td><td class="ml">Finished product</td>
          ${td("")}${td(f4(s.jacketThk))}${td(f3(s.jacketOD))}
          ${td(f3(s.weightPerFt))}${td(f0(Math.ceil(s.weightPerFt * s.lengthFt)))}</tr>
      </tbody>
    </table>`;

  const reel = `
    <table class="mds">
      <thead><tr><th colspan="2">4 &nbsp; Reel</th>
        <th>SP</th><th>HD</th><th>T</th><th>Min bend</th><th>Per reel</th></tr></thead>
      <tbody>
        <tr><td class="mn">4.1</td><td class="ml">Reel SP${f0(s.reelSP)}-HD${f0(s.reelHub)}-T${f0(s.reelT)}</td>
          ${td(f0(s.reelSP))}${td(f0(s.reelHub))}${td(f0(s.reelT))}
          ${td(f(s.minD, 1) + "D")}${td(f0(s.lenFinished) + " ft")}</tr>
        <tr><td class="mn">4.2</td><td class="ml">Target length: base ${f0(s.lenBase)} ft &middot;
          braid ${f0(s.lenBraid)} ft &middot; finished ${f0(s.lenFinished)} ft</td>
          <td colspan="5">${f0(s.nReels)} reel(s) &middot; ${f0(s.reelWeight)} lbs each
            (${f0(s.reelWeight / 2.2)} kg) &middot; max ${f0(s.reelMax)} ft</td></tr>
      </tbody>
    </table>`;

  const print = `
    <table class="mds">
      <thead><tr><th colspan="7">5 &nbsp; Print legend</th></tr></thead>
      <tbody>
        <tr><td class="mn">5.1</td><td class="ml" colspan="6">${apiMark(s)}<span class="cell">${esc(s.printLine1)}</span></td></tr>
        <tr><td class="mn">5.2</td><td class="ml" colspan="6"><span class="cell">${esc(s.printLine2)}</span></td></tr>
        <tr><td class="mn">5.3</td><td class="ml" colspan="6"><span class="cell">${esc(s.printLine3)}</span></td></tr>
        <tr><td class="mn">5.4</td><td class="ml" colspan="6">Date code is Year Month Day Hour,
          e.g. 2022010910, suffix &ldquo;01&rdquo; for Stafford TX. Print every 3 ft,
          minimum 1/4&Prime; character height.</td></tr>
      </tbody>
    </table>`;

  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;

  return ctrl + `
  <div class="sheetwrap">
    <article class="mdsdoc" id="mdsDoc">
      <header class="mdshead">
        <div>
          <h1>Manufacturing Datasheet</h1>
          <p class="sub">Specialty RTP &middot; 11317 Cash Rd, Stafford TX 77477</p>
        </div>
        <table class="meta">
          <tr><td>Document</td><th>${esc(d.doc_number || "—")}</th>
              <td>Revision</td><th>${esc(d.revision)}</th></tr>
          <tr><td>Project</td><th>${esc(d.project || "—")}</th>
              <td>Issued</td><th>${esc(d.issued_on || "—")}</th></tr>
          <tr><td>Client</td><th>${esc(d.client || "—")}</th>
              <td>Prepared</td><th>${esc(d.prepared_by || "—")}</th></tr>
        </table>
      </header>

      <h2 class="prod">${esc(s.productName)}</h2>

      <!-- Design pressure, temperature, service, hydrotest, service life and
           coupling are deliberately absent: they are design conditions, and
           the pressure and temperature already read off the product title
           immediately above. The MDS carries what the floor builds.
           API nominal stays: it also leads the Designer's headline strip. -->
      <div class="kvrow">
        ${kv("Application", esc(s.app))}
        ${kv("API nominal", f(s.apiNominal, 2) + " in")}
        ${kv("FAT min burst", f0(fat) + " psi")}
        ${kv("Length", f0(s.lengthFt) + " ft / " + f0(s.lengthM) + " m")}
      </div>
      <p class="basis">FAT basis: ${esc(fatLabel)}. Burst achieved ${f0(s.burstTotal)} psi at a
        ${f(s.braidAngle, 1)}&deg; braid angle. Tensile ${f0(s.tensileStrength)} lbs.</p>

      ${base}${braid}${cover}${reel}${print}

      ${d.notes ? `<p class="notes"><b>Notes.</b> ${esc(d.notes)}</p>` : ""}

      <footer class="mdsfoot">
        <div><span>Prepared</span><b>${esc(d.prepared_by || "")}</b></div>
        <div><span>Approved</span><b>${esc(d.approved_by || "")}</b></div>
        <div><span>Date</span><b>${esc(d.issued_on || "")}</b></div>
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
  VIEW = "sheet";
}

document.addEventListener("click", async e => {
  if (!H) return;
  const open = e.target.closest("[data-mdsopen]");
  const del  = e.target.closest("[data-mdsdel]");
  const id   = e.target.id;
  try {
    if (open) { DOC = await DB.loadMds(open.dataset.mdsopen); VIEW = "sheet"; H.refresh(); return; }
    if (del)  {
      if (!confirm("Delete this datasheet?")) return;
      await DB.deleteMds(del.dataset.mdsdel);
      SAVED = await DB.listMds(); H.refresh(); status("Deleted."); return;
    }
    if (id === "mdsSavedList") { SAVED = await DB.listMds(); VIEW = "list"; H.refresh(); return; }
    if (id === "mdsBackSheet") { VIEW = "sheet"; H.refresh(); return; }
    if (id === "mdsPrint")     { window.print(); return; }

    if (id === "mdsFromDesigner") {
      DOC = fromCurrent(H.inputs(), H.solved(), H.bookId());
      VIEW = "sheet"; H.refresh(); status("Built from the current design."); return;
    }
    if (id === "mdsReload") {
      if (DOC.design_id) await buildFromDesign(DOC.design_id);
      else { DOC.snapshot = { inputs: H.inputs(), solved: pick(H.solved()) }; }
      H.refresh(); status("Snapshot refreshed from the design."); return;
    }
    if (id === "mdsSave" || id === "mdsRevise") {
      const row = { ...DOC };
      if (id === "mdsRevise") { row.id = null; row.revision = nextRev(DOC.revision); }
      delete row.created_at; delete row.updated_at; delete row.created_by;
      const saved = await DB.saveMds(row);
      DOC = saved; SAVED = await DB.listMds();
      H.refresh();
      status(`Saved ${saved.doc_number || saved.title} rev ${saved.revision}.`);
      return;
    }
  } catch (err) { status(err.message, true); }
});

const nextRev = r => {
  const t = String(r || "A").trim();
  return /^[A-Z]$/.test(t) ? String.fromCharCode(t.charCodeAt(0) + 1)
       : /^\d+$/.test(t)   ? String(Number(t) + 1) : t + "1";
};

document.addEventListener("change", async e => {
  if (!H) return;
  const f = e.target.closest(".mdsf");
  const pick2 = e.target.id === "mdsPickDesign" ? e.target : null;
  const basis = e.target.id === "mdsBasis" ? e.target : null;
  try {
    if (f && DOC) { DOC[f.dataset.f] = e.target.value; H.refresh(); return; }
    if (basis && DOC) { DOC.burst_basis = basis.value; H.refresh(); return; }
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
