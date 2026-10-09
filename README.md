# SRTP Pricing Tool

Browser rebuild of `Pricing Tool - v7.xlsx` — the braided reinforced thermoplastic
pipe design and cost engine used at Specialty RTP.

Live site: **https://dwilliamssrtp.github.io/srtp-pricing-tool/**

## Why there are no prices in this repository

Every material, braid and coupling price lives in Supabase behind Row Level
Security, not in this source. That is deliberate and it is what allows this
repository to be public. Two checks back it up:

* An anonymous caller holding the publishable key gets `[]` from
  `price_book_items`, `price_books`, `designs` and `profiles`.
* The access helper functions are in a `private` schema that PostgREST does not
  expose, so `/rest/v1/rpc/is_admin` and friends return 404.

Signing up grants nothing on its own: `profiles.is_active` defaults to `false`
and an administrator has to switch it on.

The source keeps engineering constants only — pipe dimensions, braid widths and
strengths, coupling geometry, the material selection matrices. None of that is
commercially sensitive.

## Layout

```
index.html        shell: sign-in gate + application markup + all CSS
app/config.js     Supabase URL and publishable key (public by design)
app/db.js         Supabase client, auth, price books, designs
app/data.js       engineering lookup tables — NO prices
app/engine.js     the formula chain; pure functions, prices injected
app/ui.js         rendering and wiring
supabase/schema.sql   current database schema
serve.ps1         local static server (ES modules need a real HTTP origin)
```

No build step and no dependencies to install. `supabase-js` is loaded from a
pinned CDN URL as an ES module. Deploy by pushing to `main`.

## Running locally

```
powershell -NoProfile -File serve.ps1
```

then open http://localhost:8777. Opening `index.html` directly off disk will not
work — ES modules require `http://`.

## The engine

`app/engine.js` mirrors the Inputs sheet formula chain, with the source cell
named in a comment on nearly every line. It is pure: `solve(inputs)` in,
results out, no I/O. Prices arrive on `inputs.prices` as
`{ polymer: {...}, braid: {...} }`. A material with no price in the active book
is reported as a warning and never silently costed at zero.

Keeping the engine in one place and client-side is what makes the workbook
verification meaningful: 45 cached values from the spreadsheet — including the
full stress-rupture chain, three-pass burst, coupling retention and the reel
wrap model — are reproduced exactly, with prices served from the database.

Known workbook defects that this rebuild routes around are listed in the code
comments; the significant ones are the dead external link behind `MDS (2)`, the
`#N/A` in `CDS!E26`, and a longs lookup range that makes one braid unselectable.

## Price books

Versioned and dated, exactly one `active` at a time. Two are seeded from the
workbook: *Inputs sheet (v7)*, which is what v7 shipped with and what the
verification reproduces, and *Confirmed Jan 2026*, newer figures from the
Materials sheet that were never promoted. Switching the active book is a
commercial decision, so it is admin-only.

Quotes are not built yet. When they are, a quote must store a frozen snapshot of
its inputs *and* the resolved prices, pinned to a `price_book_id`; re-pricing
creates a revision rather than mutating the original.
