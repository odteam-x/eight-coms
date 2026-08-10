/**
 * EIGHT CREATORS LABs — Configuración Supabase
 * ─────────────────────────────────────────────
 * ¿Es seguro poner la anon key aquí si este archivo es público? SÍ.
 * La anon key solo identifica la app ante Supabase. Sin una sesión de
 * usuario válida el rol PostgreSQL es "anon" y las RLS policies bloquean
 * el 100 % de los datos. La service_role key (que bypassa RLS) NUNCA
 * va al frontend.
 *
 * Obtén estos valores en:
 *   Supabase Dashboard → Settings → API
 *   → "Project URL"  → SUPABASE_URL
 *   → "anon public"  → SUPABASE_ANON_KEY
 */
const SUPABASE_URL      = 'https://owfmorjlymoxqrzhadnf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_l6zMSRSW85gASQRgPd_rmw_p3oKJhsP';

/* ── HTML-escape helper — use on ALL user-supplied data before innerHTML ── */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Log de depuración — activar con localStorage.setItem('ec-debug','1') ── */
function debug(...args) {
  try {
    if (localStorage.getItem('ec-debug') === '1') console.log(...args);
  } catch { /* localStorage bloqueado (modo privado / cookies off) */ }
}

/* ── Lucide icon helper — returns a <i data-lucide> tag that lucide.createIcons() renders ── */
function renderLucideIcon(name, cls) {
  return '<i data-lucide="' + name + '"' + (cls ? ' class="' + cls + '"' : '') + '></i>';
}

const _ICON_MAP = {
  score:'bar-chart-2', trophy:'trophy', map:'map', users:'users',
  clipboard:'clipboard-list', calendar:'calendar', search:'search', ruler:'ruler',
  star:'star', starLg:'star', award:'award', activity:'activity', zap:'zap',
  dashboard:'layout-dashboard', msg:'message-square', lock:'lock', user:'user',
  trending:'trending-up', settings:'settings', plus:'plus', trash:'trash-2',
  edit:'pencil', check:'check', logOut:'log-out',
};

const ICONS = new Proxy({}, {
  get(_, key) { return renderLucideIcon(_ICON_MAP[key] || key); }
});

/* Auto-render Lucide icons when new data-lucide elements appear in the DOM */
(function() {
  var _pending = false;
  function refresh() {
    _pending = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  function schedule() {
    if (!_pending) { _pending = true; requestAnimationFrame(refresh); }
  }
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes.length) { schedule(); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
