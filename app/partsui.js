/* =====================================================================
   Master cost sheet UI — bought-in parts, line speeds, quote settings.

   Rendered into the Pricing page. Read-only for viewers and estimators,
   editable for admins, which is what the RLS policies allow.
   ===================================================================== */
import * as DB from "./db.js?v=20261009-1530";
import { ANSI_CLASSES } from "./parts.js?v=20261009-1530";

const PART_KIND_LABEL = {
  end_flange: "End flanges", lap_flange: "Lap flanges",
  splice: "Splices", reel: "Reels", support: "Support items"
};
const PART_KIND_ORDER = ["end_flange", "lap_flange", "splice", "reel", "support"];

/* Populated by load(); the host passes in its formatting helpers so the
   look matches the rest of the page. */
let PARTS = [], SPEEDS = [], SETTINGS = [];
let PART_FILTER = "uncosted";
let H = null;                     // {tbl, esc, money, f0, isAdmin, refresh, bookId}

export function init(helpers) { H = helpers; }

export async function load(bookId) {
  if (!bookId) { PARTS = []; SPEEDS = []; SETTINGS = []; return; }
  try {
    [PARTS, SPEEDS, SETTINGS] = await Promise.all([
      DB.loadPartCosts(bookId), DB.loadLineSpeeds(bookId), DB.loadSettings()
    ]);
  } catch (err) { PARTS = []; SPEEDS = []; SETTINGS = []; }
}

export const counts = () => ({
  total: PARTS.length, costed: PARTS.filter(p => p.cost != null).length
});

/* ------------------------------------------------------------- parts */
export function partsSection() {
  const { tbl, esc, money } = H, admin = H.isAdmin();
  const { total, costed } = counts();

  const head = `
    <h4>Master cost sheet &mdash; bought-in parts</h4>
    <div class="savebar">
      <select id="partFilter">
        <option value="uncosted"${PART_FILTER === "uncosted" ? " selected" : ""}>Show not-yet-costed only</option>
        <option value="all"${PART_FILTER === "all" ? " selected" : ""}>Show everything</option>
      </select>
      <span class="ref">${costed} of ${total} rows costed</span>
      <span id="partStatus"></span>
    </div>
    <p class="ref">The Endeco Cost Sheet carried this grid but every price cell was blank &mdash; part costs
      were typed into each quote by hand. Nothing here is invented, so every row starts uncosted. A blank
      cost stays distinct from zero: a quote that needs one will say so rather than treat the part as free.</p>`;

  const section = kind => {
    let rows = PARTS.filter(p => p.kind === kind);
    if (PART_FILTER === "uncosted") rows = rows.filter(p => p.cost == null);
    if (!rows.length) {
      return `<h4>${esc(PART_KIND_LABEL[kind])}</h4><p class="ref">${
        PART_FILTER === "uncosted" ? "All costed." : "No rows."}</p>`;
    }
    const cell = (p, field, ph) => admin
      ? { v: `<input class="partCost" data-id="${esc(p.id)}" data-f="${field}" type="number"
             step="0.01" min="0" value="${p[field] == null ? "" : p[field]}" placeholder="${ph}"
             style="width:94px;text-align:right">`, n: 1, raw: true }
      : { v: p[field] == null ? `<span class="wn">${ph}</span>` : money(p[field]), n: 1,
          raw: p[field] == null };

    const body = rows.map(p => ({ cells: [
      p.label,
      p.ansi_class ? "ANSI " + p.ansi_class : "—",
      p.material || p.reel_code || "—",
      cell(p, "cost", "not set"),
      cell(p, "list_price", "—"),
      p.unit,
      { v: admin ? `<button data-rmpart="${esc(p.id)}" title="Remove">×</button>` : "", raw: true }
    ]}));
    return `<h4>${esc(PART_KIND_LABEL[kind])} <span class="ref">(${rows.length} shown)</span></h4>`
      + tbl(["Part", "Class", "Material / code", { t: "Our cost", n: 1 },
             { t: "List price", n: 1 }, "Unit", ""], body);
  };

  const adder = admin ? `
    <h4>Add a part</h4>
    <div class="savebar">
      <select id="npKind">${PART_KIND_ORDER.map(k =>
        `<option value="${k}">${esc(PART_KIND_LABEL[k])}</option>`).join("")}</select>
      <input id="npLabel" placeholder="Description" style="flex:1 1 240px">
      <select id="npClass"><option value="">no ANSI class</option>${
        ANSI_CLASSES.map(c => `<option value="${c}">ANSI ${c}</option>`).join("")}</select>
      <select id="npMat"><option value="">no material</option>${
        ["Zinc Chromate", "PPS", "Duplex 2205", "Stainless Steel"]
          .map(m => `<option>${m}</option>`).join("")}</select>
      <input id="npCost" type="number" step="0.01" placeholder="cost" style="width:94px">
      <input id="npUnit" placeholder="$/ea" style="width:78px">
      <button data-addpart="1">Add</button>
    </div>` : "";

  return head + PART_KIND_ORDER.map(section).join("") + adder;
}

/* ------------------------------------------------------- line speeds */
export function speedsSection() {
  const { tbl, esc, f0 } = H, admin = H.isAdmin();
  const bySize = {};
  for (const s of SPEEDS) (bySize[s.rtp_size] ||= []).push(s);

  const num = (s, field, step, w = 76) => admin
    ? { v: `<input class="spd" data-id="${esc(s.id)}" data-f="${field}" type="number" step="${step}"
           min="0" value="${s[field] == null ? "" : s[field]}" style="width:${w}px;text-align:right">`,
        n: 1, raw: true }
    : { v: s[field] == null ? "—" : String(s[field]), n: 1 };

  const rows = [];
  for (const size of Object.keys(bySize)) {
    rows.push({ group: `${size} in pipe` });
    for (const s of bySize[size]) {
      const rate = s.ft_per_min == null ? null
        : s.ft_per_min * 60 * 24 * (1 / (s.passes || 1)) * (s.efficiency ?? 0.8) * (s.braider_mult ?? 1);
      rows.push({ cells: [
        s.stage,
        num(s, "ft_per_min", 0.1),
        num(s, "passes", 1, 58),
        num(s, "efficiency", 0.05),
        num(s, "braider_mult", 1, 58),
        { v: rate == null ? `<span class="wn">rate missing</span>` : f0(rate) + " ft/day",
          n: 1, raw: rate == null }
      ]});
    }
  }
  return `<h4>Line speeds &mdash; labour calculator</h4>`
    + tbl(["Stage", { t: "ft/min", n: 1 }, { t: "Passes", n: 1 }, { t: "Efficiency", n: 1 },
           { t: "Braider ×", n: 1 }, { t: "Day rate at 24 hr", n: 1 }], rows)
    + `<p class="ref">Day rate = ft/min &times; 60 &times; 24 &times; (1 / passes) &times; efficiency
       &times; braider multiplier, then scaled by hours per day. Days for a run is the <b>longest</b>
       stage, not the sum, because the stages run on separate lines. Endeco used 2.8 / 5 / 10 ft-min at
       0.8 on both its runs, so that is seeded for every size &mdash; correct it where you have real data.</p>`;
}

/* ---------------------------------------------------------- settings */
export function settingsSection() {
  const { tbl, esc } = H, admin = H.isAdmin();
  const rows = SETTINGS.map(s => ({ cells: [
    s.label,
    admin
      ? { v: `<input class="qset" data-key="${esc(s.key)}" type="number" step="0.01"
             value="${s.value == null ? "" : s.value}" style="width:118px;text-align:right">`,
          n: 1, raw: true }
      : { v: s.value == null ? "—" : String(s.value), n: 1 },
    s.unit || "",
    { v: `<span class="ref">${esc(s.notes || "")}</span>`, raw: true }
  ]}));
  return `<h4>Quote settings</h4>` + tbl(["Setting", { t: "Value", n: 1 }, "Unit", "Note"], rows);
}

/* ------------------------------------------------------------ events */
function status(msg, bad) {
  const el = document.getElementById("partStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = bad ? "bad" : "ok";
  if (!bad) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3000);
}

/* Saves fire on blur, never per keystroke, so typing is not interrupted. */
document.addEventListener("change", async e => {
  if (!H) return;
  const part = e.target.closest(".partCost");
  const spd  = e.target.closest(".spd");
  const qset = e.target.closest(".qset");
  const filt = e.target.id === "partFilter" ? e.target : null;
  try {
    if (part) {
      const v = part.value === "" ? null : Number(part.value);
      await DB.setPartField(part.dataset.id, { [part.dataset.f]: v });
      const row = PARTS.find(p => p.id === part.dataset.id);
      if (row) row[part.dataset.f] = v;
      status("Saved.");
      // A newly costed row leaves the "not yet costed" view.
      if (part.dataset.f === "cost" && PART_FILTER === "uncosted") H.refresh();
    }
    if (spd) {
      const v = spd.value === "" ? null : Number(spd.value);
      await DB.setLineSpeed(spd.dataset.id, { [spd.dataset.f]: v });
      const row = SPEEDS.find(s => s.id === spd.dataset.id);
      if (row) row[spd.dataset.f] = v;
      H.refresh(); status("Saved.");
    }
    if (qset) {
      await DB.setSetting(qset.dataset.key, qset.value);
      const row = SETTINGS.find(s => s.key === qset.dataset.key);
      if (row) row.value = qset.value === "" ? null : Number(qset.value);
      status("Saved.");
    }
    if (filt) { PART_FILTER = filt.value; H.refresh(); }
  } catch (err) { status(err.message, true); }
});

document.addEventListener("click", async e => {
  if (!H) return;
  const add = e.target.closest("[data-addpart]");
  const rm  = e.target.closest("[data-rmpart]");
  if (add) {
    const g = id => document.getElementById(id);
    const label = g("npLabel").value.trim();
    if (!label) { status("A description is required.", true); return; }
    try {
      await DB.addPart(H.bookId(), {
        kind: g("npKind").value, label,
        ansi_class: g("npClass").value ? Number(g("npClass").value) : null,
        material: g("npMat").value || null,
        cost: g("npCost").value === "" ? null : Number(g("npCost").value),
        unit: g("npUnit").value.trim() || "$/ea"
      });
      await load(H.bookId()); H.refresh();
      status(`Added "${label}".`);
    } catch (err) { status(err.message, true); }
  }
  if (rm) {
    if (!confirm("Remove this part from the cost sheet?")) return;
    try {
      await DB.removePart(rm.dataset.rmpart);
      await load(H.bookId()); H.refresh(); status("Removed.");
    } catch (err) { status(err.message, true); }
  }
});
