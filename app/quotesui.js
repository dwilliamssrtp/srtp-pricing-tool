/* =====================================================================
   Quotes and Archive pages.

   A quote is groups of five lines — pipe, end flange, lap flange,
   splice, reel — exactly as the Endeco Profitability Review laid out.
   The pipe line is a SAVED DESIGN: picking one pulls its $/ft from the
   engine and its reel capacity from the wrap model, and derives the
   flange and splice descriptions from the pipe size, pressure and
   connection material.
   ===================================================================== */
import * as DB from "./db.js?v=20261009-1530";
import { solve } from "./engine.js?v=20261009-1530";
import { partsForPipe, CONNECTION_MATERIALS, SEALING_TYPES } from "./parts.js?v=20261009-1530";
import { quoteTotals, salesQuoteView, priceHistoryNotice, priceForMargin } from "./quote.js?v=20261009-1530";

let H = null;                   // host helpers from ui.js
let CUSTOMERS = [], DESIGNS = [], PARTS = [], SPEEDS = [], SETTINGS = [];
let LIST = [], ARCHIVE = [];
let CUR = null;                 // open quote {…, lines:[]}
let VIEW = "list";              // list | editor | sales
let HISTORY = {};               // product_key -> notice
let QUOTE_SEARCH = "", ARCHIVE_SEARCH = "";
let LINE_INDEX = {};            // quote id -> pipe descriptions, for searching

export function init(helpers) { H = helpers; }

export async function loadRefs(bookId) {
  try {
    [CUSTOMERS, DESIGNS, PARTS, SPEEDS, SETTINGS] = await Promise.all([
      DB.listCustomers(), DB.listDesigns(),
      bookId ? DB.loadPartCosts(bookId) : [],
      bookId ? DB.loadLineSpeeds(bookId) : [],
      DB.loadSettings()
    ]);
  } catch (e) { /* surfaced by the page */ }
}
export async function loadList() {
  try { [LIST, ARCHIVE] = await Promise.all([DB.listQuotes(false), DB.listQuotes(true)]);
        await buildLineIndex(); }
  catch (e) { LIST = []; ARCHIVE = []; }
}

const setting = (k, d) => {
  const s = SETTINGS.find(x => x.key === k);
  return s && s.value != null ? Number(s.value) : d;
};
const quoteSettings = q => ({
  scrapPct: q ? Number(q.scrap_pct) : setting("scrap_pct", 0.05),
  markup:   q ? Number(q.markup)    : setting("markup", 1),
  dayCost:  q ? Number(q.day_cost)  : setting("day_cost", 0),
  hoursPerDay: q ? Number(q.hours_per_day) : setting("hours_per_day", 24),
  daysBuffer:  q ? Number(q.days_buffer)   : setting("days_buffer", 2)
});
const stagesFor = size => SPEEDS.filter(s => String(s.rtp_size) === String(size));

/* --------------------------------------------------------------------
   Build the five lines for a pipe size from a saved design.
   -------------------------------------------------------------------- */
export function groupFromDesign(design, { groupNo, suppliedFt, connectionMaterial, sealing, markup }) {
  const inputs = design.inputs;
  const r = solve({ ...inputs, prices: H.prices() });
  const sizeKey = String(inputs.sizeKey).replace(/\s*(DH|LPG)$/, "");
  const p = partsForPipe({ rtpSize: sizeKey, psi: inputs.psi, connectionMaterial, sealing });
  const reelCode = `SP${inputs.reelSP}-HD${inputs.reelHub}-T${inputs.reelT}`;
  const capacity = r.reelCapacity || 0;
  const reels = capacity ? Math.ceil(suppliedFt / capacity) : 0;

  const look = (kind, extra) => DB.findPart(PARTS, { kind, ...extra });
  const priced = (part, qty, unit) => ({
    unit_cost: part ? (part.cost == null ? null : Number(part.cost)) : null,
    unit_price: part && part.list_price != null ? Number(part.list_price)
              : (part && part.cost != null ? Number(part.cost) * (1 + markup) : null),
    cost_is_placeholder: !!(part && part.is_placeholder),
    supplied_units: qty, manufactured_units: qty, unit
  });

  const endPart = p && look("end_flange", { rtpSize: sizeKey, ansiClass: p.ansiClass,
                                            material: matShort(connectionMaterial) });
  const lapPart = p && look("lap_flange", { flangeSize: p.lap, flangeId: p.lapId,
                                            ansiClass: p.ansiClass });
  const splPart = p && look("splice", { rtpSize: sizeKey, material: matShort(connectionMaterial) });
  const reelPart = look("reel", { reelCode });

  const lines = [{
    group_no: groupNo, sort: 0, kind: "pipe", label: r.productName,
    design_id: design.id, product_key: r.productName,
    supplied_units: suppliedFt, manufactured_units: null, unit: "ft",
    unit_cost: r.costPerFt, unit_price: r.costPerFt * (1 + markup),
    cost_is_placeholder: false
  }];
  if (p) {
    lines.push({ group_no: groupNo, sort: 1, kind: "end_flange", label: p.endFlange,
                 ...priced(endPart, 2, "ea") });
    lines.push({ group_no: groupNo, sort: 2, kind: "lap_flange", label: p.lapFlange,
                 ...priced(lapPart, 2, "ea") });
    lines.push({ group_no: groupNo, sort: 3, kind: "splice", label: p.splice,
                 ...priced(splPart, reels, "ea") });
  }
  lines.push({ group_no: groupNo, sort: 4, kind: "reel",
               label: `Reel ${reelCode} (${H.f0(capacity)} ft per reel)`,
               ...priced(reelPart, reels, "ea") });

  return { lines, capacity, reels, parts: p, solved: r };
}
const matShort = name => (CONNECTION_MATERIALS.find(m => m.name === name) || {}).short || null;

/* ==================================================================== */
/* Free-text search across a quote's number, title, customer, status and the
   pipe descriptions on its lines — so "4.5" or "2200psi" finds the quotes
   that carry that size, not just ones with it in the title. */
function quoteHaystack(q) {
  const lines = (LINE_INDEX[q.id] || []).join(" ");
  return [q.number, q.title, q.customers ? q.customers.name : "", q.status, lines]
    .join(" ").toLowerCase();
}
function filterQuotes(rows, term) {
  const t = (term || "").trim().toLowerCase();
  if (!t) return rows;
  const words = t.split(/\s+/);
  return rows.filter(q => { const h = quoteHaystack(q); return words.every(w => h.includes(w)); });
}

function listPage(rows, archived) {
  const { tbl, esc, money } = H;
  const term = archived ? ARCHIVE_SEARCH : QUOTE_SEARCH;
  const shown = filterQuotes(rows, term);

  const search = `
    <div class="savebar">
      <input class="qsearch" data-scope="${archived ? "archive" : "quotes"}" type="search"
        placeholder="Search number, title, customer or pipe size…" value="${esc(term)}"
        style="flex:1 1 280px">
      <span class="ref">${shown.length} of ${rows.length}${
        term ? ` matching “${esc(term)}”` : ""}</span>
      <span id="qStatus"></span>
    </div>`;

  if (!rows.length) {
    return `<p class="ref">${archived ? "Nothing archived yet."
      : "No quotes yet. Start one below."}</p>` + (archived ? "" : newQuoteForm());
  }
  if (!shown.length) {
    return search + `<p class="ref">Nothing matches that search.</p>`
         + (archived ? "" : newQuoteForm());
  }

  const body = shown.map(q => {
    const t = q.snapshot && q.snapshot.extended != null ? money(q.snapshot.extended, 0) : "—";
    const sizes = [...new Set(LINE_INDEX[q.id] || [])].slice(0, 2).join(", ");
    return { cells: [
      q.number,
      q.title + (sizes ? `\n${sizes}` : ""),
      q.customers ? q.customers.name : "—",
      { v: `<span class="${q.status === "won" ? "ok" : q.status === "lost" ? "bad" : "wn"}">${
        esc(q.status)}</span>`, raw:true },
      { v: t, n: 1 },
      new Date(q.updated_at).toLocaleDateString(),
      { v: `<button data-openq="${esc(q.id)}">Open</button>`
         + (archived ? ` <button data-unarch="${esc(q.id)}">Restore</button>`
                     : ` <button data-arch="${esc(q.id)}">Archive</button>`)
         + ` <button data-delq="${esc(q.id)}">Delete</button>`, raw: true }
    ]};
  });
  return search
       + tbl(["Number","Title / sizes","Customer","Status",{t:"Total",n:1},"Updated",""], body)
       + (archived ? "" : newQuoteForm());
}

function newQuoteForm() {
  const { esc } = H;
  return `
    <h4>New quote</h4>
    <div class="savebar">
      <input id="nqTitle" placeholder="Quote title" style="flex:1 1 220px">
      <select id="nqCustomer">
        <option value="">— customer —</option>
        ${CUSTOMERS.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}
      </select>
      <input id="nqNewCustomer" placeholder="or a new customer name" style="flex:1 1 180px">
      <button class="pri" id="nqCreate">Create</button>
      <span id="qStatus"></span>
    </div>`;
}

/* ------------------------------------------------------------- editor */
function editorPage() {
  const { tbl, esc, money, f0, f } = H;
  const q = CUR;
  const st = quoteSettings(q);
  const stagesByGroup = {};
  for (const l of q.lines) {
    if (l.kind !== "pipe") continue;
    const d = DESIGNS.find(x => x.id === l.design_id);
    const size = d ? String(d.summary?.sizeKey || "").replace(/\s*(DH|LPG)$/, "") : null;
    stagesByGroup[l.group_no] = size ? stagesFor(size) : [];
  }
  const T = quoteTotals(q.lines, st, stagesByGroup);

  const head = `
    <div class="savebar">
      <button id="qBack">← All quotes</button>
      <b>${esc(q.number)}</b>
      <input id="qTitle" value="${esc(q.title)}" style="flex:1 1 220px">
      <select id="qStatusSel">${["draft","sent","won","lost"].map(s =>
        `<option value="${s}"${q.status===s?" selected":""}>${s}</option>`).join("")}</select>
      <button class="pri" id="qSave">Save</button>
      <button id="qSales">Sales quote view</button>
      <span id="qStatus"></span>
    </div>
    <div class="savebar">
      <span class="ref">Customer <b>${esc(q.customers ? q.customers.name : "—")}</b></span>
      <label class="ref">Scrap % <input class="qset2" data-k="scrap_pct" type="number" step="0.5"
        value="${(st.scrapPct*100).toFixed(2)}" style="width:74px;text-align:right"></label>
      <label class="ref">Markup % <input class="qset2" data-k="markup" type="number" step="5"
        value="${(st.markup*100).toFixed(0)}" style="width:78px;text-align:right"></label>
      <label class="ref">Day cost <input class="qset2" data-k="day_cost" type="number" step="100"
        value="${st.dayCost}" style="width:106px;text-align:right"></label>
      <label class="ref">Hrs/day <input class="qset2" data-k="hours_per_day" type="number" step="1"
        value="${st.hoursPerDay}" style="width:66px;text-align:right"></label>
      <label class="ref">Day buffer <input class="qset2" data-k="days_buffer" type="number" step="1"
        value="${st.daysBuffer}" style="width:66px;text-align:right"></label>
      <button id="qReprice" title="Reset every unit price to cost x (1 + markup)">Re-price at markup</button>
    </div>
    <p class="ref">These settings belong to <b>this quote</b>: changing them here restates nothing
      else, and changing the defaults on the Pricing page will not restate this quote.
      Unit cost, margin and days are editable per line &mdash; an overridden cost is marked
      &#9679; and is never written back to the master cost sheet.</p>`;

  const warn = [];
  if (T.placeholders.length)
    warn.push(`<li><b>${T.placeholders.length} line(s) use placeholder costs</b> ($500 each):
      ${esc(T.placeholders.slice(0,4).join("; "))}${T.placeholders.length>4?" …":""}.
      The totals below are not real until those are costed on the Pricing page.</li>`);
  if (T.missingCost.length)
    warn.push(`<li>No cost found for: ${esc(T.missingCost.join("; "))}.
      Those lines are excluded from the budget, so margin is overstated.</li>`);
  for (const l of q.lines) {
    const h = HISTORY[l.product_key];
    if (l.kind === "pipe" && h && h.differs)
      warn.push(`<li><b>Repeat customer price:</b> this exact pipe was quoted to
        ${esc(q.customers ? q.customers.name : "this customer")} at
        <b>${money(h.lastPrice)}</b>/ft on ${esc(q.number === h.lastQuote ? "this quote" : h.lastQuote)}
        (${esc(new Date(h.lastDate).toLocaleDateString())}). You have
        ${money(l.unit_price)}/ft here.</li>`);
  }

  const groups = T.groups.map(g => {
    const rows = g.rows.map(r => ({ cells: [
      r.label,
      { v: `<input class="qln" data-id="${esc(r.id ?? r.sort + "-" + g.groupNo)}"
             data-g="${g.groupNo}" data-s="${r.sort}" data-f="supplied_units" type="number"
             step="1" min="0" value="${r.supplied}" style="width:96px;text-align:right">`, n:1, raw:true },
      /* Manufactured is typed for parts, where it is a count you decide
         (spares, breakage, a part you build an extra of). On the pipe line it
         stays derived as supplied x (1 + scrap), so it is shown read-only. */
      r.kind === "pipe"
        ? { v: `${f0(r.manufactured)} <span class="ref" title="supplied × (1 + scrap)">auto</span>`,
            n:1, raw:true }
        : { v: `<input class="qln" data-g="${g.groupNo}" data-s="${r.sort}"
               data-f="manufactured_units" type="number" step="1" min="0"
               value="${r.manufactured}" title="Units built, which may exceed the units supplied"
               style="width:96px;text-align:right">`, n:1, raw:true },
      { v: `<input class="qln" data-g="${g.groupNo}" data-s="${r.sort}" data-f="unit_price"
             type="number" step="0.01" min="0" value="${r.price ?? ""}"
             placeholder="not set" style="width:96px;text-align:right">`, n:1, raw:true },
      { v: r.extended == null ? "—" : money(r.extended, 0), n:1 },
      /* Cost is editable so a placeholder can be overridden for this quote
         alone. The override never writes back to the master cost sheet. */
      { v: `<input class="qln" data-g="${g.groupNo}" data-s="${r.sort}" data-f="unit_cost"
             type="number" step="0.01" min="0" value="${r.cost ?? ""}"
             placeholder="no cost" title="${r.cost_overridden ? "Overridden on this quote"
               : r.cost_is_placeholder ? "Placeholder from the cost sheet" : "From the cost sheet"}"
             style="width:92px;text-align:right${r.cost_overridden ? ";border-color:var(--accent2)" : ""}">`
          + (r.cost_overridden ? ' <span class="ref" title="Overridden">●</span>'
             : r.cost_is_placeholder ? ' <span class="wn" title="Placeholder">◌</span>' : ""),
        n:1, raw:true },
      { v: r.budget == null ? "—" : money(r.budget, 0), n:1 },
      /* Typing a margin back-solves the unit price, scrap included. */
      { v: `<input class="qmargin" data-g="${g.groupNo}" data-s="${r.sort}"
             type="number" step="0.5" max="99" value="${r.margin == null ? "" : (r.margin*100).toFixed(1)}"
             placeholder="—" title="Type a target margin to set the price"
             style="width:74px;text-align:right">%`, n:1, raw:true }
    ]}));
    const lab = g.labour;
    const pipeLine = g.rows.find(x => x.kind === "pipe");
    const daysBox = `<input class="qdays" data-g="${g.groupNo}" type="number" min="0" step="1"
        value="${pipeLine && pipeLine.days_override != null ? pipeLine.days_override : ""}"
        placeholder="${lab && lab.totalDays != null ? lab.totalDays : "auto"}"
        title="Blank uses the labour calculator" style="width:72px;text-align:right">`;
    const labTxt = !lab ? `Days ${daysBox}` : lab.missing.length
      ? `<span class="wn">line speeds missing for ${esc(lab.missing.join(", "))}</span> &middot; days ${daysBox}`
      : `${f(lab.longestDays,2)} days on the longest stage &rarr; calculator says
         <b>${lab.totalDays}</b>. Using ${daysBox}
         ${lab.overridden ? '<span class="wn">(overridden)</span>' : ""}
         &times; ${money(st.dayCost,0)} = ${money(g.dayCharge ?? 0,0)}`;
    return `<h4>Group ${g.groupNo} <button data-rmg="${g.groupNo}" title="Remove">×</button></h4>`
      + tbl(["Line",{t:"Supplied",n:1},{t:"Manufactured",n:1},{t:"Unit price",n:1},
             {t:"Extended",n:1},{t:"Unit cost",n:1},{t:"Budget",n:1},{t:"Margin",n:1}], rows)
      + `<p class="ref">${labTxt} &middot; group total ${money(g.extended,0)},
         budget ${money(g.budget,0)}, margin ${g.margin==null?"—":(g.margin*100).toFixed(1)+"%"},
         true margin ${g.trueMargin==null?"—":(g.trueMargin*100).toFixed(1)+"%"}</p>`;
  }).join("");

  const adder = `
    <h4>Add a pipe size</h4>
    <div class="savebar">
      <select id="agDesign" style="flex:1 1 260px">
        <option value="">— saved design —</option>
        ${DESIGNS.map(d => `<option value="${esc(d.id)}">${esc(d.name)}${
          d.client ? " · " + esc(d.client) : ""}</option>`).join("")}
      </select>
      <input id="agFt" type="number" min="1" placeholder="supplied ft" style="width:120px">
      <select id="agMat">${CONNECTION_MATERIALS.map(m =>
        `<option value="${esc(m.name)}">${esc(m.name)} (${m.service})</option>`).join("")}</select>
      <select id="agSeal">${SEALING_TYPES.map(s => `<option>${s}</option>`).join("")}</select>
      <button data-addgroup="1">Add</button>
    </div>
    <p class="ref">The pipe line takes its $/ft from the saved design and its reel capacity from the
      wrap model. Flange, lap and splice descriptions are derived from size, pressure and connection
      material; their costs come from the master cost sheet.</p>`;

  const totals = H.tiles([
    { k:"Quote total", v:money(T.extended,0), cls:"big" },
    { k:"Material budget", v:money(T.budget,0) },
    { k:"Gross margin", v:T.margin==null?"—":(T.margin*100).toFixed(1)+"%",
      cls:(T.margin??0)>=0.3?"ok":"bad" },
    { k:"Production days", v:f0(T.totalDays), s:money(T.dayCharge,0)+" at day cost" },
    { k:"True margin", v:T.trueMargin==null?"—":(T.trueMargin*100).toFixed(1)+"%",
      cls:(T.trueMargin??0)>=0.2?"ok":"bad", s:"after production days" }
  ]);

  return head
    + (warn.length ? `<ul class="warns">${warn.join("")}</ul>` : "")
    + `<div style="margin:14px 0">${totals}</div>`
    + groups + adder;
}

/* -------------------------------------------------------- sales quote */
function salesPage() {
  const { tbl, esc, money, f0 } = H, q = CUR;
  const st = quoteSettings(q);
  const T = quoteTotals(q.lines, st, {});
  const view = salesQuoteView(T.groups);
  const blocks = view.map(g => {
    const rows = g.rows.map(r => [
      esc(r.label) + (r.foldedLap ? `<br><span class="ref">includes ${esc(r.foldedLap)}</span>` : ""),
      { v:f0(r.supplied), n:1 },
      { v:r.price==null?"—":money(r.price), n:1 },
      { v:r.extended==null?"—":money(r.extended,0), n:1 }
    ]).map(cells => ({ cells: cells.map((c,i) => i===0 ? {v:c,raw:true} : c) }));
    rows.push({ cls:"tot", cells:["Subtotal",{v:"",n:1},{v:"",n:1},{v:money(g.extended,0),n:1}] });
    return tbl(["Requested Materials",{t:"Supplied Units",n:1},{t:"Unit Price",n:1},
                {t:"Extended Price",n:1}], rows);
  }).join('<div style="height:12px"></div>');

  return `
    <div class="savebar">
      <button id="qBackEditor">← Back to the quote</button>
      <button onclick="window.print()">Print</button>
      <span class="ref">The lap flange is folded into the end-flange price, as the Endeco sales quote did.</span>
    </div>
    <div class="card"><div class="pad">
      <p style="margin:0 0 4px"><b>Specialty RTP</b><br>
        <span class="ref">11317 Cash Rd. Stafford, TX 77477 &middot; www.specialtyrtp.com</span></p>
      <table style="width:auto;margin:12px 0;border:0">
        <tr><td class="k">Company</td><td>${esc(q.customers ? q.customers.name : "—")}</td></tr>
        <tr><td class="k">Sales Tender Number</td><td>${esc(q.number)}</td></tr>
        <tr><td class="k">Date</td><td>${new Date().toLocaleDateString()}</td></tr>
        <tr><td class="k">Lead Time</td><td>${esc(q.lead_time || "—")}</td></tr>
        <tr><td class="k">Payment Terms</td><td>${esc(q.payment_terms || "—")}</td></tr>
        <tr><td class="k">Validity</td><td>${esc(String(q.validity_days || 30))} days</td></tr>
      </table>
      ${blocks}
      <h4 style="margin-top:18px">Total project: ${money(T.extended, 0)}</h4>
      ${T.placeholders.length ? `<p class="bad">Not for issue — ${T.placeholders.length}
        line(s) still use $500 placeholder costs.</p>` : ""}
    </div></div>`;
}

/* ==================================================================== */
export function quotesHTML() {
  if (VIEW === "editor" && CUR) return editorPage();
  if (VIEW === "sales"  && CUR) return salesPage();
  return listPage(LIST, false);
}
export function archiveHTML() { return listPage(ARCHIVE, true); }

function status(msg, bad) {
  const el = document.getElementById("qStatus");
  if (!el) return;
  el.textContent = msg; el.className = bad ? "bad" : "ok";
  if (!bad) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3500);
}

async function refreshHistory() {
  HISTORY = {};
  if (!CUR || !CUR.customer_id) return;
  for (const l of CUR.lines.filter(x => x.kind === "pipe" && x.product_key)) {
    try {
      const hist = await DB.priceHistory(CUR.customer_id, l.product_key);
      const other = hist.filter(h => h.number !== CUR.number);
      const notice = priceHistoryNotice(l.product_key, l.unit_price, other);
      if (notice) HISTORY[l.product_key] = notice;
    } catch (e) { /* non-fatal */ }
  }
}

export async function openQuote(id) {
  CUR = await DB.loadQuote(id);
  VIEW = "editor";
  await refreshHistory();
  H.refresh();
}

/* ------------------------------------------------------------ events */
document.addEventListener("click", async e => {
  if (!H) return;
  const t = id => e.target.closest(id);
  const openq = t("[data-openq]"), arch = t("[data-arch]"), unarch = t("[data-unarch]"),
        delq = t("[data-delq]"), addg = t("[data-addgroup]"), rmg = t("[data-rmg]");

  try {
    if (openq) { await openQuote(openq.dataset.openq); return; }
    if (arch)   { await DB.updateQuote(arch.dataset.arch,
                    { status:"archived", archived_at:new Date().toISOString() });
                  await loadList(); H.refresh(); return; }
    if (unarch) { await DB.updateQuote(unarch.dataset.unarch, { status:"draft", archived_at:null });
                  await loadList(); H.refresh(); return; }
    if (delq)   { if (!confirm("Delete this quote and all its lines? This cannot be undone.")) return;
                  await DB.deleteQuote(delq.dataset.delq); await loadList(); H.refresh(); return; }

    if (e.target.id === "qBack")       { VIEW = "list"; CUR = null; await loadList(); H.refresh(); return; }
    if (e.target.id === "qSales")      { VIEW = "sales";  H.refresh(); return; }
    if (e.target.id === "qBackEditor") { VIEW = "editor"; H.refresh(); return; }

    if (e.target.id === "nqCreate") {
      const title = document.getElementById("nqTitle").value.trim();
      const pick  = document.getElementById("nqCustomer").value;
      const fresh = document.getElementById("nqNewCustomer").value.trim();
      if (!title) { status("Give the quote a title.", true); return; }
      let customerId = pick || null;
      if (!customerId && fresh) { customerId = (await DB.addCustomer(fresh)).id; CUSTOMERS = await DB.listCustomers(); }
      if (!customerId) { status("Pick a customer or type a new one.", true); return; }
      const s = quoteSettings(null);
      const q = await DB.createQuote({
        title, customer_id: customerId, price_book_id: H.bookId(),
        scrap_pct: s.scrapPct, markup: s.markup, day_cost: s.dayCost,
        hours_per_day: s.hoursPerDay, days_buffer: s.daysBuffer
      });
      await loadList(); await openQuote(q.id);
      status(`Created ${q.number}.`); return;
    }

    if (rmg) {
      CUR.lines = CUR.lines.filter(l => String(l.group_no) !== String(rmg.dataset.rmg));
      H.refresh(); status("Group removed — Save to keep it."); return;
    }

    if (addg) {
      const did = document.getElementById("agDesign").value;
      const ft  = Number(document.getElementById("agFt").value);
      if (!did || !ft) { status("Pick a design and enter the supplied footage.", true); return; }
      const design = await DB.loadDesign(did);
      const groupNo = (CUR.lines.reduce((m, l) => Math.max(m, l.group_no || 1), 0) || 0) + 1;
      const st = quoteSettings(CUR);
      const built = groupFromDesign(design, {
        groupNo, suppliedFt: ft,
        connectionMaterial: document.getElementById("agMat").value,
        sealing: document.getElementById("agSeal").value,
        markup: st.markup
      });
      CUR.lines = CUR.lines.concat(built.lines);
      await refreshHistory();
      H.refresh();
      status(`Added ${design.name}: ${built.reels} reel(s) at ${H.f0(built.capacity)} ft.`);
      return;
    }

    if (e.target.id === "qReprice") {
      const m = quoteSettings(CUR).markup;
      let count = 0;
      for (const l of CUR.lines) {
        if (l.unit_cost == null) continue;
        l.unit_price = Math.round(Number(l.unit_cost) * (1 + m) * 10000) / 10000;
        count++;
      }
      await refreshHistory(); H.refresh();
      status(`Re-priced ${count} line(s) at ${(m * 100).toFixed(0)}% markup.`);
      return;
    }

    if (e.target.id === "qSave") {
      await DB.updateQuote(CUR.id, {
        title: document.getElementById("qTitle").value.trim(),
        status: document.getElementById("qStatusSel").value,
        scrap_pct: CUR.scrap_pct, markup: CUR.markup, day_cost: CUR.day_cost,
        hours_per_day: CUR.hours_per_day, days_buffer: CUR.days_buffer,
        snapshot: snapshotOf()
      });
      await DB.replaceQuoteLines(CUR.id, CUR.lines.map(stripLine));
      CUR = await DB.loadQuote(CUR.id);
      await refreshHistory();
      await loadList(); H.refresh();
      status("Saved.");
      return;
    }
  } catch (err) { status(err.message, true); }
});

const stripLine = l => ({
  group_no: l.group_no, sort: l.sort, kind: l.kind, label: l.label,
  design_id: l.design_id ?? null, product_key: l.product_key ?? null,
  supplied_units: l.supplied_units ?? l.supplied ?? 0,
  manufactured_units: l.manufactured_units ?? null,
  unit_price: l.unit_price ?? null, unit_cost: l.unit_cost ?? null,
  unit: l.unit || "ea", cost_is_placeholder: !!l.cost_is_placeholder,
  days_override: l.days_override == null ? null : Number(l.days_override),
  cost_overridden: !!l.cost_overridden
});

function snapshotOf() {
  const T = quoteTotals(CUR.lines, quoteSettings(CUR), {});
  return { extended: T.extended, budget: T.budget, margin: T.margin,
           placeholders: T.placeholders.length, at: new Date().toISOString() };
}

/* Line edits update in memory; Save persists. */
document.addEventListener("change", async e => {
  if (!H || !CUR) return;
  const box    = e.target.closest(".qln");
  const margin = e.target.closest(".qmargin");
  const days   = e.target.closest(".qdays");
  const qs     = e.target.closest(".qset2");

  const lineAt = (g, s) =>
    CUR.lines.find(l => Number(l.group_no) === Number(g) && Number(l.sort) === Number(s));

  if (box) {
    const line = lineAt(box.dataset.g, box.dataset.s);
    if (!line) return;
    const field = box.dataset.f;
    const v = box.value === "" ? null : Number(box.value);
    const wasSupplied = Number(line.supplied_units);
    const wasMade     = line.manufactured_units == null ? null : Number(line.manufactured_units);

    line[field] = v;

    // On a part line, manufactured tracks supplied until you deliberately set
    // the two apart; after that your figure is left alone.
    if (field === "supplied_units" && line.kind !== "pipe"
        && (wasMade === null || wasMade === wasSupplied)) {
      line.manufactured_units = v;
    }
    // A typed cost is an override for this quote only.
    if (field === "unit_cost") {
      line.cost_overridden = true;
      line.cost_is_placeholder = false;
    }
    if (line.kind === "pipe") await refreshHistory();
    H.refresh();
    return;
  }

  if (margin) {
    const line = lineAt(margin.dataset.g, margin.dataset.s);
    if (!line) return;
    if (margin.value === "") { H.refresh(); return; }
    const target = Number(margin.value) / 100;
    const price = priceForMargin(line, target, quoteSettings(CUR).scrapPct);
    if (price === null) { status("Need a unit cost before a margin can set the price.", true); return; }
    line.unit_price = Math.round(price * 10000) / 10000;
    if (line.kind === "pipe") await refreshHistory();
    H.refresh();
    return;
  }

  if (days) {
    const pipe = CUR.lines.find(l => Number(l.group_no) === Number(days.dataset.g) && l.kind === "pipe");
    if (!pipe) return;
    pipe.days_override = days.value === "" ? null : Number(days.value);
    H.refresh();
    return;
  }

  if (qs) {
    const k = qs.dataset.k;
    let v = qs.value === "" ? 0 : Number(qs.value);
    if (k === "scrap_pct" || k === "markup") v = v / 100;   // entered as a percentage
    CUR[k] = v;
    H.refresh();
    return;
  }
});

/* Refresh just the saved-design list. Called whenever a design is saved or
   deleted on the Designer page, so a new design is immediately available to
   quote against without reloading the site. */
export async function reloadDesigns() {
  try { DESIGNS = await DB.listDesigns(); } catch (e) { /* keep the old list */ }
}
/* Same for customers, after one is created elsewhere. */
export async function reloadCustomers() {
  try { CUSTOMERS = await DB.listCustomers(); } catch (e) { /* keep the old list */ }
}

/* Pull every quote's pipe descriptions in one query so the list can be
   searched by size or pressure without opening each quote. */
async function buildLineIndex() {
  try {
    const rows = await DB.allPipeLines();
    LINE_INDEX = {};
    for (const r of rows) (LINE_INDEX[r.quote_id] ||= []).push(r.label);
  } catch (e) { LINE_INDEX = {}; }
}

document.addEventListener("input", e => {
  const box = e.target.closest(".qsearch");
  if (!box || !H) return;
  if (box.dataset.scope === "archive") ARCHIVE_SEARCH = box.value;
  else QUOTE_SEARCH = box.value;
  H.refresh();
  // Re-focus: refresh() replaces the page body, which drops the caret.
  const again = document.querySelector(`.qsearch[data-scope="${box.dataset.scope}"]`);
  if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
});
