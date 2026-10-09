/* =====================================================================
   Top-level pages.

   Pricing and Users are their own pages reached from the header, rather
   than entries in the datasheet strip at the bottom — they are not
   datasheets, and burying a price editor under "TDS / MDS / CDS" made it
   hard to find.

   This module owns nothing but navigation. The page bodies are rendered
   by sheetPricing() and sheetUsers() in ui.js, which ui.js exposes on
   window.__srtp for this module to call.
   ===================================================================== */

export function initPages(api) {
  const PAGES = ["designer", "pricing", "users"];
  let page = "designer";

  function render() {
    for (const p of PAGES) {
      const el = document.getElementById("page-" + p);
      if (el) el.hidden = (p !== page);
    }
    for (const b of document.querySelectorAll("#pagenav button"))
      b.setAttribute("aria-selected", String(b.dataset.page === page));

    // The KPI strip, price-book picker and Reset only mean anything while
    // a design is on screen; hide them rather than show stale numbers.
    const onDesigner = page === "designer";
    for (const id of ["hdkpi", "priceBasis", "resetBtn"]) {
      const el = document.getElementById(id);
      if (el) el.hidden = !onDesigner;
    }

    if (page === "pricing") document.getElementById("pricingPage").innerHTML = api.pricingHTML();
    if (page === "users")   document.getElementById("usersPage").innerHTML   = api.usersHTML();
  }

  function setPage(p) {
    if (!PAGES.includes(p)) p = "designer";
    page = p;
    render();
    try { localStorage.setItem("srtp-page", p); } catch (e) {}
  }

  document.getElementById("pagenav").addEventListener("click", e => {
    const b = e.target.closest("button[data-page]");
    if (b) setPage(b.dataset.page);
  });

  return {
    setPage,
    current: () => page,
    /* Re-render the page in view, after a save or a role change. */
    refresh: () => render(),
    /* Users is admin-only, so the nav entry only appears for admins. */
    showUsers: on => {
      const b = document.querySelector('#pagenav button[data-page="users"]');
      if (b) b.hidden = !on;
      if (!on && page === "users") setPage("designer");
    },
    restore: () => {
      let saved = "designer";
      try { saved = localStorage.getItem("srtp-page") || "designer"; } catch (e) {}
      setPage(saved);
    }
  };
}
