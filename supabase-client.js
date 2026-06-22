'use strict';
/**
 * EIGHT CREATORS LABs — Cliente Supabase
 * Cargado DESPUÉS de config.js y el CDN de Supabase.
 * Expone el singleton `SB` usado por auth.js y api.js.
 */
const SB = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:     true,   // guarda sesión en localStorage
    autoRefreshToken:   true,   // renueva el JWT antes de que expire
    detectSessionInUrl: true,   // captura el token tras redirect de email confirm
  },
});
