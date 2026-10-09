/* =====================================================================
   Supabase client, session handling and data access.
   ===================================================================== */
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_JS } from "./config.js";

const { createClient } = await import(SUPABASE_JS);

export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

/* ---------------------------------------------------------------- auth */
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signOut() { await sb.auth.signOut(); }

export async function currentSession() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

/* The profile row doubles as the access verdict: no row, or is_active false,
   means signed in but not yet approved. */
export async function currentProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("id,email,full_name,role,is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data || { id: user.id, email: user.email, role: "viewer", is_active: false };
}

/* --------------------------------------------------------- price books */
export async function listPriceBooks() {
  const { data, error } = await sb
    .from("price_books")
    .select("id,name,effective_from,status,notes")
    .order("status")
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return data || [];
}

/* Returns { id, name, status, prices: { polymer:{}, braid:{} } } — the shape
   the engine expects on inp.prices. */
export async function loadPriceBook(bookId) {
  let book;
  if (bookId) {
    const { data, error } = await sb.from("price_books")
      .select("id,name,status,effective_from,notes").eq("id", bookId).single();
    if (error) throw error;
    book = data;
  } else {
    const { data, error } = await sb.from("price_books")
      .select("id,name,status,effective_from,notes").eq("status", "active").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("No active price book. Ask an admin to activate one.");
    book = data;
  }
  const { data: items, error: e2 } = await sb
    .from("price_book_items")
    .select("kind,item_key,price,unit,source_note")
    .eq("price_book_id", book.id);
  if (e2) throw e2;

  const prices = { polymer: {}, braid: {}, coupling: {} };
  // NULL price means "not priced yet" - omit it so the engine reports it as
  // missing rather than costing the item at zero.
  for (const it of items || []) {
    if (it.price === null || it.price === undefined) continue;
    (prices[it.kind] || (prices[it.kind] = {}))[it.item_key] = Number(it.price);
  }
  return { ...book, prices, itemCount: (items || []).length };
}

export async function updatePrice(bookId, kind, itemKey, price) {
  const { error } = await sb.from("price_book_items")
    .upsert({ price_book_id: bookId, kind, item_key: itemKey, price },
            { onConflict: "price_book_id,kind,item_key" });
  if (error) throw error;
}

/* ------------------------------------------------------------- designs */
export async function listDesigns() {
  const { data, error } = await sb
    .from("designs")
    .select("id,name,client,notes,summary,created_at,updated_at,created_by")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function loadDesign(id) {
  const { data, error } = await sb.from("designs").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function saveDesign({ id, name, client, notes, inputs, summary, priceBookId }) {
  const row = { name, client: client || null, notes: notes || null,
                inputs, summary, price_book_id: priceBookId || null };
  if (id) {
    const { data, error } = await sb.from("designs").update(row).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from("designs")
    .insert({ ...row, created_by: user.id }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteDesign(id) {
  const { error } = await sb.from("designs").delete().eq("id", id);
  if (error) throw error;
}

/* ------------------------------------------------- price book, full sheet */
/* Every item including unpriced ones, for the master pricing sheet. */
export async function loadPriceSheet(bookId) {
  const { data, error } = await sb
    .from("price_book_items")
    .select("id,kind,item_key,label,price,unit,source_note,sort")
    .eq("price_book_id", bookId)
    .order("kind").order("sort").order("item_key");
  if (error) throw error;
  return data || [];
}

export async function setItemPrice(id, price) {
  const { error } = await sb.from("price_book_items")
    .update({ price: price === null || price === "" ? null : Number(price) })
    .eq("id", id);
  if (error) throw error;
}

export async function setItemField(id, patch) {
  const { error } = await sb.from("price_book_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function addItem(bookId, { kind, item_key, label, price, unit, source_note }) {
  const { data, error } = await sb.from("price_book_items").insert({
    price_book_id: bookId, kind, item_key, label: label || null,
    price: price === "" || price === null || price === undefined ? null : Number(price),
    unit: unit || ($ => $)(kind === "polymer" || kind === "braid" ? "$/lb" : "$/ea"),
    source_note: source_note || null
  }).select().single();
  if (error) throw error;
  return data;
}

export async function removeItem(id) {
  const { error } = await sb.from("price_book_items").delete().eq("id", id);
  if (error) throw error;
}

/* Copy a book so prices can be revised without touching the one in force. */
export async function copyPriceBook(sourceId, name, effectiveFrom) {
  const { data: { user } } = await sb.auth.getUser();
  const { data: book, error } = await sb.from("price_books")
    .insert({ name, effective_from: effectiveFrom, status: "draft", created_by: user.id })
    .select().single();
  if (error) throw error;
  const src = await loadPriceSheet(sourceId);
  if (src.length) {
    const { error: e2 } = await sb.from("price_book_items").insert(
      src.map(i => ({ price_book_id: book.id, kind: i.kind, item_key: i.item_key,
                      label: i.label, price: i.price, unit: i.unit,
                      source_note: i.source_note, sort: i.sort })));
    if (e2) throw e2;
  }
  return book;
}

/* Exactly one book may be active; a partial unique index enforces it, so the
   outgoing book must be archived before the incoming one is promoted. */
export async function activatePriceBook(bookId) {
  const { error: e1 } = await sb.from("price_books")
    .update({ status: "archived" }).eq("status", "active").neq("id", bookId);
  if (e1) throw e1;
  const { error: e2 } = await sb.from("price_books")
    .update({ status: "active" }).eq("id", bookId);
  if (e2) throw e2;
}

/* --------------------------------------------------------------- users */
export async function listProfiles() {
  const { data, error } = await sb
    .from("profiles")
    .select("id,email,full_name,role,is_active,created_at")
    .order("created_at");
  if (error) throw error;
  return data || [];
}

/* Role and activation are plain table writes — the profiles_admin_all policy
   already restricts them to admins, so no privileged key is involved. */
export async function setProfile(id, patch) {
  const { error } = await sb.from("profiles").update(patch).eq("id", id);
  if (error) throw error;
}

/* Creating or deleting an auth user needs the service-role key, which must
   never reach the browser. The admin-users Edge Function holds it and
   re-checks that the caller is an active admin before doing anything. */
async function adminFn(payload) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${session.access_token}`,
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  let out; try { out = await res.json(); } catch { out = {}; }
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status}).`);
  return out;
}
export const createUser   = (email, password, role, full_name) =>
  adminFn({ action:"create", email, password, role, full_name });
export const deleteUser   = id => adminFn({ action:"delete", id });
export const resetPassword = (id, password) => adminFn({ action:"password", id, password });
