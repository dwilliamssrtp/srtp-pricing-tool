import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* =====================================================================
   admin-users — create and delete team accounts, and reset passwords.

   The service-role key never leaves this function. The platform injects
   it as an environment variable; it is not in the public repo and never
   reaches the browser.

   Every request is checked twice: the platform verifies the JWT, then we
   re-read the caller's own profile row to confirm they are an ACTIVE
   ADMIN. A valid token belonging to a viewer, or to an admin who has
   since been deactivated, gets 403.
   ===================================================================== */

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);

  const caller = createClient(URL_, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const admin = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false } });

  // Authorisation is re-derived from the database, not from the token's claims.
  const { data: me } = await admin
    .from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (!me || !me.is_active || me.role !== "admin")
    return json({ error: "Administrator access required" }, 403);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const action = body.action;

  if (action === "create") {
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const role = body.role || "viewer";
    if (!email || !password) return json({ error: "Email and password are required" }, 400);
    if (password.length < 10) return json({ error: "Password must be at least 10 characters" }, 400);
    if (!["viewer", "estimator", "admin"].includes(role)) return json({ error: "Unknown role" }, 400);

    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: body.full_name || null }
    });
    if (error) return json({ error: error.message }, 400);

    // The signup trigger makes the profile inactive; an admin creating an
    // account intends it to work, so activate it and set the role.
    const { error: pErr } = await admin.from("profiles")
      .update({ role, is_active: true, full_name: body.full_name || null })
      .eq("id", created.user.id);
    if (pErr) return json({ error: pErr.message }, 400);

    return json({ ok: true, id: created.user.id, email, role });
  }

  if (action === "delete") {
    if (!body.id) return json({ error: "id is required" }, 400);
    if (body.id === user.id) return json({ error: "You cannot delete your own account" }, 400);

    // Never strand the project without an administrator.
    const { count } = await admin.from("profiles")
      .select("id", { count: "exact", head: true }).eq("role", "admin").eq("is_active", true);
    const { data: target } = await admin.from("profiles")
      .select("role,is_active").eq("id", body.id).maybeSingle();
    if (target?.role === "admin" && target.is_active && (count ?? 0) <= 1)
      return json({ error: "That is the last active administrator" }, 400);

    await admin.from("designs").update({ created_by: user.id }).eq("created_by", body.id);
    const { error } = await admin.auth.admin.deleteUser(body.id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "password") {
    if (!body.id || !body.password) return json({ error: "id and password are required" }, 400);
    if (body.password.length < 10) return json({ error: "Password must be at least 10 characters" }, 400);
    const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
