# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EIGHT CREATORS LABs is a team performance evaluation portal for CELIDER 08 Santiago. It's a **static frontend** (vanilla HTML/CSS/JS, no build step, no bundler) backed by **Supabase** for auth, database, and storage. Deployed on **Vercel** at `https://eight-coms.vercel.app`.

## Running Locally

```bash
npx serve -p 3000 --no-clipboard .
```

No `npm install` needed — all dependencies load via CDN (`@supabase/supabase-js`, `lucide` icons). Open `http://localhost:3000/index.html`.

Vercel config is in `vercel.json` (security headers only). Note that `vercel.json` uses path-to-regexp `source` patterns (`/(.*)`), not glob — a glob pattern silently applies no headers.

## Architecture

### Auth & Data Flow

- `config.js` — Supabase URL + anon key, `escHtml()` helper, `debug()` logger, Lucide icon utilities
- `supabase-client.js` — creates the `SB` Supabase singleton (auth persistence, auto-refresh, session-in-URL detection)
- `auth.js` — `Auth` module: `getProfile()`, `requireAuth()`, `requireRole()`, `requireAnyRole()`, `logout()`. Falls back to session metadata if the `profiles` table is inaccessible via RLS
- `api.js` — `API` module: all Supabase queries (CRUD for roles, periodos, criterios, rubrica, evaluaciones, evaluaciones_distrito, calendario, trabajos_entregados, avatar upload)

### Pages (each is a standalone HTML file)

| File | Role gate | JS logic |
|------|-----------|----------|
| `index.html` | None (login page) | Inline — login, password reset, password recovery detection via `onAuthStateChange('PASSWORD_RECOVERY')` |
| `registro.html` | None | Inline — registration form |
| `user.html` | `Auth.requireRole('miembro')` | `user.js` — member dashboard (scores, feedback, rubrica, calendario) |
| `secretario.html` | `Auth.requireAnyRole(['secretario','miembro'])` | `secretario.js` — secretary view (adds ranking, district management) |
| `admin.html` | `Auth.requireAuth(true)` | `admin.js` — full admin panel (users, roles, periodos, evaluaciones, criterios, rubrica, calendario, config) |

### Styling

- `shared.css` — design system: CSS variables, glass morphism, dark/light theme, grid utilities, animations
- `user.css`, `secretario.css`, `admin.css` — page-specific styles

**One view, one colour dimension.** The rule that keeps this readable:

- **All seven criteria render in a single colour** — `var(--criterio)`. Each bar already carries its label (PLA, REV, EDI…) and its length; the colour added nothing and its seven saturated hues collided with the level scale. `criterios.color` still exists in the DB and stays admin-editable, but the score views ignore it.
- **The level scale is one hue (194°, brand cyan) in four luminance steps**, not four different hues. Measured contrast on `--bg`: 13.26 / 9.84 / 6.89 / 4.69 — all pass AA. Light theme has its own ramp (10.56 / 7.64 / 5.99 / 4.63).
- **`#FF6063` is reserved for action and alert.** Never use it for a score level, a criterion or a decorative orb.

`--bg` is `#0A1628`, a desaturated navy — **not** the brand `#002247`, which is saturated blue and distorted the colours in front of it. The brand navy→cyan identity lives in accents, borders and gradients.

Background orbs sit at opacity ≤.15 and are hidden below 768px (`.bg-canvas { display:none }`): three blurred animated layers force continuous compositing.

**Minimum font size is `.8rem`** (`--fs-min`). `--muted` is `#8FA8C4` (7.40:1). Before Phase 5 it was `#7090B0` at 4.78:1 applied to `.65rem` text.

Typography is **two families**: `Bebas Neue` (large numbers and section titles) and `Source Sans 3` (everything else, weights 400/600/700). Barlow and Barlow Condensed were removed — they competed for the same role. Four font files, down from ~14.

Medal colours in `secretario.css` are tokenised (`--medalla-oro/plata/bronce`) with light-theme variants: the hardcoded gold scored 1.55:1 on the light background.

### Security model (Phase 1)

- **Registration grants nothing.** `registro.html` collects only name, email, password. The `profiles` row is created server-side by the `on_auth_user_created` trigger (migration `0001`) with fixed values: `tipo_miembro='miembro'`, `es_admin=false`, `distrito=NULL`, `rol_id=NULL`, `aprobado=false`. The client cannot influence any of them.
- **Privileged fields are frozen.** The `profiles_bloquear_privilegios` BEFORE UPDATE trigger rejects any non-admin change to `es_admin`, `tipo_miembro`, `distrito`, `rol_id` or `aprobado`. Never rely on the RLS `WITH CHECK` alone — a policy with a NULL `WITH CHECK` reuses its `USING` clause and silently ORs away the guard.
- **`aprobado` gates the portal.** `Auth._bloquearSiPendiente()` signs out and redirects to `index.html?pendiente=1`. It only blocks on an explicit `aprobado === false`, so the frontend is safe to deploy before migration `0001` runs.
- **Never trust `user_metadata`.** It is user-writable via `SB.auth.updateUser({data:{...}})`. `auth.js` reads only `nombre` from it.
- **All human-origin data goes through `escHtml()`** before `innerHTML`. This includes criterion labels/colors, period names, district names, work titles and the search box (`q`).

CDN scripts are pinned to exact versions with SRI hashes, both served from `cdn.jsdelivr.net`. Bumping a version **requires** recomputing the hash:

```bash
curl -sS "https://cdn.jsdelivr.net/npm/PKG@VER/dist/umd/FILE.js" | openssl dgst -sha384 -binary | openssl base64 -A
```

**CSP is not enabled yet.** It requires removing the 137 inline `onclick=` handlers (Phase 3). Once they are gone, add to `vercel.json`:

```json
{ "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.supabase.co; connect-src https://*.supabase.co; frame-ancestors 'none'; base-uri 'none'" }
```

### Accessibility and performance (Phase 6)

- **Modals** get `role="dialog"`, `aria-modal`, `aria-labelledby`, focus moved to the first control, a Tab trap, Escape-to-close and focus restored to the trigger — all centralised in `openModal`/`closeModal` in `core/render.js`. Do not hand-roll a modal that bypasses them.
- **Tabs**: `switchTabCore` sets `role="tablist"`/`role="tab"`/`aria-selected` on the nav and `role="tabpanel"`/`aria-hidden` on the panels. Hidden panels leave the accessibility tree, so a screen reader no longer walks all six tabs at once.
- **Touch**: `.tnav-drop` menus opened on `:hover` only, which does not exist on touch. Under `@media (pointer: coarse)` the submenu renders inline instead.
- `prefers-reduced-motion` is now honoured in all four stylesheets (`admin.css` and `secretario.css` ignored it).
- **The logo is `logo.webp` (16 KB) via `<picture>`**, with `logo.png` (39 KB) as fallback. It was a 749×1093 PNG of 279 KB rendered at 44px. Regenerate both if the source changes; keep `width`/`height` on the `<img>` to avoid layout shift.
- The member score is rendered **once**, in the hero. Quick links are mobile-only — on desktop they duplicated the topbar.

**No inline `onclick` anywhere.** All 161 were replaced by a single delegated listener with an action table in `config.js` (`data-act` + `data-arg`, plus `data-arg2` where a second argument is needed). Delegated rather than one listener per button because 49 of them lived in markup generated by `innerHTML`. Adding a new button means adding an entry to `ACCIONES` — never an `onclick`.

The CSP ships as `Content-Security-Policy-Report-Only`. To enforce it, drop `-Report-Only` from the key in `vercel.json`.

### Navigation

**Member (`user.html`): three destinations.** Mi Score · Entregas · Historial. "Períodos" and "Calendario" were the same data — the dates of each PE — split across two tabs, and "Reportes" is its temporal view; all three are sections inside Historial. The rubric is no longer a tab: it is a `<details>` under the score bars, where the question "how is this graded?" actually arises.

**Secretary (`secretario.html`): four.** Same consolidation, keeping Ranking (with Mi Distrito) which is secretary-specific.

**Admin: operation vs configuration.** Overview, Evaluar, Usuarios and Reportes stay at top level; Períodos, Calendario, Rúbrica, Roles, Distritos and Gestiones live behind the gear. Previously all nine competed at the same level, so "Evaluar" (daily) sat beside "Rúbrica" (twice a gestión).

`_ALIAS_TAB` in `user.js` and `secretario.js` maps the old tab names to the new ones so saved links keep working.

### Supabase Tables

`profiles`, `roles`, `periodos_evaluacion`, `criterios`, `rubrica`, `evaluaciones` (per-user scores), `evaluaciones_distrito`, `calendario`, `config`, `periodo_participantes`, `distritos`, `trabajos_entregados`. Storage bucket: `avatars`.

The `credenciales` table (plaintext passwords) is dropped by migration `0002`. Do not recreate it.

### Shared core (`core/`)

Loaded by `user.html`, `secretario.html` and `admin.html`, right after `config.js`:

- **`core/store.js`** — single application state. One `periodoId` (UUID) governs the whole page; `Store.setPeriodo()` notifies subscribers so every section repaints together. Also holds the per-tab load policy (`necesitaCarga` / `marcarCargado` / `invalidar`) — one rule for all tabs, with explicit invalidation.
- **`core/render.js`** — shared presentation helpers, defined as globals because the portals are classic scripts: the `NIVELES` table, `scoreColor/Label/Class`, `getCriterios`, `calcScore` (portal rows) vs `calcScorePuntajes` (admin `puntajes` + bonus), `parseJSON`, `initials`, `setEl`, `pad`, `timeAgo`, `showToast`, `openModal`/`closeModal`, `switchTabCore`, `initScrollEffects`, `updateTimestamp`, and the three view states `renderCargando` / `renderVacio` / `renderError`.

Do not copy these back into the page scripts. They were duplicated across all three portals and had silently diverged.

**There is no `CRITERIOS_DEFAULT` fallback.** If the criteria query fails, `getCriterios()` returns `[]` and the view must show an error — check `hayCriterios()` before rendering scores. Showing seven plausible-but-wrong criteria was worse than failing.

### Active period (PE)

**Single source of truth: `periodos_evaluacion.activo`.** A partial unique index (`periodos_solo_uno_activo`) makes "only one active period" a database invariant, not a JS convention. Change it only through the `set_periodo_activo(uuid)` RPC, which deactivates the previous one and activates the new one atomically — passing `null` leaves the gestión with no active period.

Do **not** reintroduce `config.periodo_activo`. It was a third source of truth, seeded as `periodoActivo` and written as `periodo_activo`, and migration `0003` deleted it.

**PE buttons are generated from data**, never hardcoded in HTML. Use `renderPEBar(container, periodos, current, onSelect)` and `syncPEBar(container, current)` from `config.js`. The containers are empty `.pe-row` divs with ids (`pe-row-scores`, `pe-row-miscore`, `pe-row-rankdist`, `pe-row-rank`, `trabajos-pe-row`). Hardcoding PE1/PE2/PE3 is what made the active PE4 unreachable.

When syncing after a click, always scope to `btn.closest('.pe-row')` — a global `.pe-row .pb` selector clears every bar on the page.

### Data flow (two phases)

`API.getData()` is gone. The portals load in two stages:

1. **`API.getContexto()`** — profile, criteria, periods, rubric, calendar. Four queries in parallel, one round-trip. Enough to paint the hero and the PE bar.
2. **`API.getContenido(periodoId, { signal })`** — evaluations, feedback, district ranking and district members **for the selected period only**. Lazy, and cancellable via `AbortController`: switching periods quickly used to fire N uncancelled requests that could land out of order and paint the wrong period.

`API.getMiHistorial()` covers the views that legitimately cross periods (trend, report). It is a small query — one row per period, only for the signed-in user.

Every query is filtered by `periodo_id`. Never fetch all periods or all districts to render one table.

Rules that follow from this:

- **Scores are nested**: `row.puntajes[key]`, never spread onto the row. Use `puntajeDe(row, key)`. Criteria are created by the admin in a free-form field, so a criterion named `nombre`, `distrito` or `ext` would otherwise silently overwrite the user's own data.
- **Identity is always `evaluado_id` (UUID)**, never email. The old `usuario === CU.user || evaluado_id === CU.id` double-check existed only to paper over joins that sometimes returned no email.
- **RLS is the only security boundary.** The client must not re-filter by district "just in case" — that habit is what hides leaks when someone edits a policy months later.
- Both phases return `{ ok, ... }`. On `ok: false` render a visible error with a retry, never an empty state. A legitimate empty state should say *when* the data will arrive — `renderVacio()` takes `{ periodo, calendario }` for that.

### Migrations

Schema changes live in `supabase/migrations/NNNN_descripcion.sql`, applied by hand in the Supabase SQL Editor in numeric order. `supabase-schema.sql` is a historical snapshot, **not** the source of truth — the live database has drifted from it. Verify against `pg_policies` / `information_schema` before relying on it.

### Password Reset Flow

The reset email redirects to `index.html`. Supabase delivers the token in the URL hash. `supabase-client.js` has `detectSessionInUrl: true` which parses it. `index.html` listens for `PASSWORD_RECOVERY` event via `SB.auth.onAuthStateChange` and swaps the login form for the reset form (`#reset-form`). The `redirectTo` in `doResetPassword()` must match the deployed URL.

## Key Patterns

- All user-supplied data rendered via `innerHTML` must go through `escHtml()` (defined in `config.js`)
- Lucide icons auto-render via MutationObserver in `config.js` — just add `data-lucide` attributes
- Each page calls `Auth.requireRole()` / `Auth.requireAuth()` on DOMContentLoaded to enforce access; unauthorized users redirect to `index.html`
- Scoring: 7 criteria × 4 points max = 28 base + 2 bonus = 30 max. Levels: **Excelente ≥26, Bueno ≥20, En Proceso ≥11, Bajo <11** — defined once in the `NIVELES` table in `core/render.js`. `scoreColor`, `scoreLabel` and `scoreClass` all derive from it; never write thresholds inline. (Before Phase 3A, `scoreClass` used 24/18/10 in `user.js`/`admin.js` while the label and colour used 26/20/11, so a score of 25 rendered the text "Bueno" inside an "Excelente"-styled badge.)
- District evaluations use a separate 4-criteria system (CGO, CCT, COM, CEE) with max 7 per criterion

## Language

All UI text is in **Spanish**. Variable names mix Spanish and English.
