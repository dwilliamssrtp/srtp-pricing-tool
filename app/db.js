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
  for (const it of items || []) prices[it.kind][it.item_key] = Number(it.price);
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
