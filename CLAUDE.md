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
| `index.html` | None (login page) | `login.js` — login, password reset, recovery detection via `onAuthStateChange('PASSWORD_RECOVERY')` |
| `registro.html` | None | `registro.js` — registration form + password strength meter |
| `user.html` | `Auth.requireRole('miembro')` | `user.js` — member dashboard (scores, feedback, rubrica, calendario) |
| `secretario.html` | `Auth.requireAnyRole(['secretario','miembro'])` | `secretario.js` — secretary view (adds ranking, district management) |
| `admin.html` | `Auth.requireAuth(true)` | `admin.js` — full admin panel (users, roles, periodos, evaluaciones, criterios, rubrica, calendario, config) |

### Styling

- `shared.css` — the token system and everything shared. `:root` is the closed palette; nothing outside it.
- `login.css` — `index.html` + `registro.html`
- `user.css`, `secretario.css`, `admin.css` — page-specific styles

**The palette is closed.** Six brand colours (`--navy-900`, `--blue-700`, `--blue-500`, `--cyan-400`, `--cyan-200`, `--coral`), a neutral base, and three semantic slots. **No hex literal outside `:root`** — the only exceptions are pure white on the brand panel and the medal colours, both commented in place.

**Every contrast figure in this file was computed, never estimated.** When you change a colour, recompute it against the surface it actually sits on. Two values from the original design brief had to be rejected for failing: `--spr` at `#005286` scored 2.33 on `--bg` (an invisible "En Proceso" bar) and white on `--blue-500` scored 3.66 as a button label.

**One view, one colour dimension:**

- **All seven criteria render in a single colour** — `var(--criterio)`. Each bar already carries its label (PLA, REV, EDI…) and its length; seven saturated hues collided with the level scale. `criterios.color` still exists in the DB and stays admin-editable, but the score views ignore it.
- **The level scale is four luminance steps of the brand cyan**, not four hues. Dark: `--sex` 13.95 / `--sbu` 10.03 / `--spr` 5.23 / `--sba` 6.48 on `--bg`. Light has its own ramp.
- **`--alert` (`#FF6063`) is for alerts and destructive actions.** It doubles as `--sba` ("Bajo") because a failing score *is* the alert state; do not use it for anything else.

`--bg` is `#0E0F12`, a near-black neutral. `--navy-900` is **not** a page background — it is a brand surface, one solid high-contrast piece per screen (hero, login panel). As a page background it distorted every colour in front of it.

**Minimum font size is `--fs-xs` (`.8rem`).** Type is a fluid `clamp()` scale (`--fs-xs` … `--fs-hero`); do not write raw `rem` sizes.

Typography is **three families, one role each**: `Barlow Condensed` (`--font-display`, numbers and titles), `Barlow` (`--font-ui`, labels and buttons), `Source Sans 3` (`--font-body`, running text).

There are **three shadows** (`--shadow-sm/md/lg`), down from 104 distinct declarations, and one spacing scale (`--sp-1` … `--sp-7`).

⚠️ **`shared.css` still carries a compatibility alias block** (`--s1`, `--glass`, `--accent`, `--muted`, …) mapping ~625 references to the old token names. It is marked TEMPORARY and is being retired stylesheet by stylesheet. Do not use those names in new code.

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

**CSP is live as `Report-Only`.** See "No executable code in the markup" below for what had to be removed first. The header in `vercel.json`:

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

### No executable code in the markup (Phase 7)

**Nothing runs from an HTML attribute or an inline `<script>`.** `script-src 'self'` blocks both, so anything left behind silently stops working the moment the CSP stops being Report-Only.

- **All 161 `onclick`** became a single delegated listener with an action table in `config.js` (`data-act` + `data-arg`, plus `data-arg2` for a second argument). Delegated rather than one listener per button because 49 of them lived in markup generated by `innerHTML`. Adding a button means adding an entry to `ACCIONES` — never an `onclick`.
- **The 12 `oninput` / `onchange`** in `admin.html` survived that sweep, which only looked for `onclick`. They now use `data-input` / `data-change`, dispatched by two more delegated listeners against the same `_ACCIONES_SIMPLES` allow-list. The handler is called as `f(elemento, evento)`.
- **The six inline `<script>` blocks** moved to `core/theme.js`, `login.js` and `registro.js`. `core/theme.js` loads in `<head>` **without `defer`** on purpose: applying the theme after first paint flashes white on a dark theme. It also owns the scroll-progress bar, which was writing `style.width` on every scroll event without rAF.

The CSP ships as `Content-Security-Policy-Report-Only`. To enforce it, drop `-Report-Only` from the key in `vercel.json`.

### Login and registration (Phase 7)

`index.html` and `registro.html` share **`login.css`** — the same layout used to live in two `<style>` blocks that had already diverged.

- Two panels **42 / 58**, brand side on solid `--navy-900`, form capped at `400px`, single column below `860px`. `body { overflow:hidden }` is gone: it blocked scrolling with the virtual keyboard open.
- Inputs are **16px**; anything smaller makes iOS zoom on focus and knocks the page sideways.
- The spinner lives **inside the button** (`cargando(btn, activo, texto)`), not in a separate line below the form.
- Errors set `aria-invalid` on the offending field as well as filling the `role="alert"` box — colour alone is not an accessible indicator.
- The password strength meter reuses the **level scale** (`--sba` → `--sex`), so there is no second colour code to learn, and always prints the level as text.

**`--action-fill` / `--action-on` / `--action-fill-hover` are separate from `--action`.** `--action` is used as a *colour* (link text, focus ring, active border) and only needs to contrast with the page. As a *fill* it also has to contrast with its own label, and white on `--blue-500` is 3.66 — a button is not large text. In dark theme the fill is `--cyan-400` with `--navy-900` text (8.32 / 10.03); in light, `#0068C9` with white (5.45 / 4.87). The dark fill deliberately coincides with `--data`: the auth screens draw no bars, so cyan is not saying "data" anywhere in that view.

**The three background orbs are gone** — markup, CSS, keyframes and `--orb*` tokens. Three animated `blur(100px)` layers forced continuous compositing, and with `--bg` already neutral they contributed nothing visible.

### Navigation

**Member (`user.html`): three destinations.** Mi Score · Entregas · Historial.

- **Entregas** holds the delivered works, the period dates and the calendar. All three answer one question — *what do I owe and when* — and "Períodos" and "Calendario" were the same data (the dates of each PE) split across two tabs.
- **Historial** holds only the evolution across periods, which is a different question.
- The rubric is no longer a tab: it is a `<details>` under the score bars, where "how is this graded?" actually arises.

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
