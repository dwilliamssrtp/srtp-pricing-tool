/* =====================================================================
   Supabase connection.

   These two values are PUBLIC by design — the publishable key identifies
   the project, it does not grant access. Every table is protected by Row
   Level Security, and `profiles.is_active` must be switched on by an admin
   before a signed-in user can read anything. Nothing commercially
   sensitive is reachable with this key alone; that is verified by the
   anon-access test documented in README.md.
   ===================================================================== */
export const SUPABASE_URL = "https://mkgbaprutwznmvegpqak.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rQcUUEceJWPGw2mX0QE_0w_R6fbt8FG";

/* Pinned so a CDN-side release cannot silently change behaviour. */
export const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2.47.10";
