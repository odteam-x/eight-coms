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

**Run `node tools/contraste.js` before touching a colour. It is not optional.** It reads the tokens from `shared.css`, resolves the `var()` chains, composes every text×surface pair of both themes and fails under 4.5:1 (text) or 3:1 (fill, border, focus ring). It also flags hex outside `:root`, against an explicit exception list with a reason each.

Two things it taught us while being written: a regex that reads token declarations must strip comments first, or a comment mentioning `--surface-3` is parsed as a token, the value comes out garbage and **that pair is skipped silently** — which is exactly the false negative the script exists to prevent. And line numbers must be computed on the original text (blank the comments in place, don't delete them) or the report points at lines that have nothing to do with the problem.

**Every contrast figure in this file was computed, never estimated.** When you change a colour, recompute it against the surface it actually sits on. Two values from the original design brief had to be rejected for failing: `--spr` at `#005286` scored 2.33 on `--bg` (an invisible "En Proceso" bar) and white on `--blue-500` scored 3.66 as a button label.

**One view, one colour dimension:**

- **Fill and text are different tokens.** A colour validated as a bar fill (3:1) is not valid as text (4.5:1). The pairs are `--data`/`--data-txt`, `--criterio`/`--criterio-txt`, `--action`/`--action-fill`, and the level ramp `--sex`…`--sba` (fill) versus `--sex-txt`…`--sba-txt` (text). In code: `scoreColor()` fills, `scoreColorTxt()` paints text.
- **`--action` is never text on `--surface-2` or `--surface-3`** — it scores 4.40 and 3.87 there, and inside the closed palette no blue passes without invading `--data`. The active state of the rail and the bottom bar therefore carries a `--marca` bar plus `--txt` at weight 600, so colour is not the only indicator (WCAG 1.4.1).
- **All seven criteria render in a single colour** — `var(--criterio)`. Each bar already carries its label (PLA, REV, EDI…) and its length; seven saturated hues collided with the level scale. `criterios.color` still exists in the DB and stays admin-editable, but the score views ignore it.
- **The level scale is four luminance steps of the brand cyan**, not four hues. Dark: `--sex` 13.95 / `--sbu` 10.03 / `--spr` 5.23 / `--sba` 6.48 on `--bg`. Light has its own ramp.
- **`--alert` is for alerts and destructive actions.** Every alert also carries an icon and text: since Phase 11 it shares a family with `--marca`, so colour alone can never be the signal.
- **`--marca` is brand ornament, never interactive and never a surface.** Rule, underline, 3px bar, dot. It does not count against the three-colours-per-view budget. It is theme-aware because plain coral scores **2.73** on the light background — below even the 3:1 an ornament needs: `--coral` in dark (6.48 / 4.79), `#D93A3E` in light (4.19 / 3.69).
- **`--sba` stopped being `var(--coral)`** so "Bajo" is not confused with the brand: `#E8484E` in dark, `#A81F23` in light.

`--bg` is `#0E0F12`, a near-black neutral. `--navy-900` is **not** a page background — it is a brand surface, one solid high-contrast piece per screen (hero, login panel). As a page background it distorted every colour in front of it.

**Minimum font size is `--fs-xs` (`.8rem`).** Type is a fluid `clamp()` scale (`--fs-xs` … `--fs-hero`); do not write raw `rem` sizes.

Typography is **three families, one role each**: `Barlow Condensed` (`--font-display`, numbers and titles), `Barlow` (`--font-ui`, labels and buttons), `Source Sans 3` (`--font-body`, running text).

There are **three shadows** (`--shadow-sm/md/lg`), down from 104 distinct declarations, and one spacing scale (`--sp-1` … `--sp-7`).

⚠️ **`shared.css` still carries a compatibility alias block** (`--s1`, `--glass`, `--accent`, `--muted`, …). It is marked TEMPORARY and is being retired stylesheet by stylesheet — **263 references left**, down from 553. `admin.css` is fully migrated. Do not use those names in new code.

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

**CSP is enforcing** (not Report-Only). See "No executable code in the markup" below for what had to be removed first. It was verified under an enforcing policy before the flip — zero violations with Supabase, Chart.js, Lucide, Google Fonts, the `data:` URI arrow on `.cfg-select`, a real `connect-src` query and the delegated click dispatcher all exercised. The header in `vercel.json`:

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

The CSP is now enforcing. If a page ever needs a new external origin, add it to the matching directive in `vercel.json` — do not add `'unsafe-inline'` to `script-src`.

### Login and registration (Phase 7)

`index.html` and `registro.html` share **`login.css`** — the same layout used to live in two `<style>` blocks that had already diverged.

- Two panels **42 / 58**, brand side on solid `--navy-900`, form capped at `400px`, single column below `860px`. `body { overflow:hidden }` is gone: it blocked scrolling with the virtual keyboard open.
- Inputs are **16px**; anything smaller makes iOS zoom on focus and knocks the page sideways.
- The spinner lives **inside the button** (`cargando(btn, activo, texto)`), not in a separate line below the form.
- Errors set `aria-invalid` on the offending field as well as filling the `role="alert"` box — colour alone is not an accessible indicator.
- The password strength meter reuses the **level scale** (`--sba` → `--sex`), so there is no second colour code to learn, and always prints the level as text.

**`--action-fill` / `--action-on` / `--action-fill-hover` are separate from `--action`.** `--action` is used as a *colour* (link text, focus ring, active border) and only needs to contrast with the page. As a *fill* it also has to contrast with its own label, and white on `--blue-500` is 3.66 — a button is not large text. In dark theme the fill is `--cyan-400` with `--navy-900` text (8.32 / 10.03); in light, `#0068C9` with white (5.45 / 4.87). The dark fill deliberately coincides with `--data`: the auth screens draw no bars, so cyan is not saying "data" anywhere in that view.

**The three background orbs are gone** — markup, CSS, keyframes and `--orb*` tokens. Three animated `blur(100px)` layers forced continuous compositing, and with `--bg` already neutral they contributed nothing visible.

### Components and charts (Phase 8)

**Shared components live in `shared.css`, not in a page stylesheet.** `.cfg-inp` and `.btn-save` were defined only in `admin.css`, which just `admin.html` loads — so the member's "subir trabajo" form rendered with the browser's default input and a background-less button. One definition, three pages.

The layer covers: `.page-header`, `.cfg-inp` / `.cfg-select` / `.cfg-textarea`, `.btn-save` / `.btn-icon`, `.nivel-badge`, `.chip` / `.chip-row`, `.kpi` / `.kpi-row`, `.barra-track` / `.barra-fill`, `.chart-wrap` / `.chart-alt`.

**`.nivel-badge` is a filled pill, not coloured text.** As text on the page background, light-theme `--sex` scored 4.46. Filled, the contrast is against the pill's own background, which the token controls: `--nivel-on` is `--bg` in dark (worst of the four: 5.23) and `--surface-1` in light (worst: 4.83).

**Inputs sit on `--surface-1`, not `--surface-2`.** The placeholder (`--txt-muted`) scored 4.38 on `--surface-2`; on `--surface-1` it is 4.83.

#### Chart.js

Loaded only by the three portals — the auth pages draw nothing. Version 4.4.7, SRI computed, never guessed. Everything goes through `core/charts.js`:

- **Colours are read from the CSS at runtime** with `token()`. A hex inside a dataset is a colour outside `:root` that no theme change reaches.
- **A theme change destroys and rebuilds.** Chart.js copies colours in at construction, so `update()` leaves the canvas on the old palette. A `MutationObserver` on `data-theme` re-runs the builder — which is why `pintarGrafico` takes a *function*, not a config object. Verified: chart ids go 1 → 2 → 3 across two toggles and every colour follows.
- **`.chart-wrap` has a fixed height and `maintainAspectRatio: false`.** Without both, a responsive canvas inside a flexible container grows on every repaint until it fills the page.
- The legend renders only at **≥640px**, and re-renders on crossing that breakpoint.
- `animation: false` under `prefers-reduced-motion`.
- **If the CDN fails**, `.chart-wrap` gets a `role="status"` message pointing at the table, instead of a blank rectangle.
- Call `borrarGrafico(id)` **before** replacing a section by `innerHTML` — the canvas is destroyed with it and Chart.js keeps a dangling reference otherwise.

Every chart carries a `.chart-alt` paragraph with the same numbers in prose, wired via `aria-describedby`.

**`criterios.color` never reaches a `style` attribute.** `escHtml()` escapes quotes but not `;`, so a stored value like `red;background:url(x)` injected extra declarations. The score views use `var(--criterio)`; the one place the stored colour is legitimately shown — the admin criteria table swatch — goes through `colorSeguro()` in `core/render.js`, which only accepts hex notation.

### Responsive, 320 to 1920 (Phase 9)

**Tables become cards below 768px.** The admin user table has 8 columns and was forced to `min-width: 900px`, so on a 320px phone you dragged it sideways to read one row. Below 768px `.tbl-head` is hidden, each `.tbl-row` becomes a card, and each cell renders as *label: value*.

The label comes from the table's own `.tbl-head`, stamped onto the cells by `etiquetarFilas()` in `core/render.js` — **not** from a hand-written `data-label` per cell. There are six tables rendered by `innerHTML` in six different functions, and a per-call-site attribute is the kind of thing that gets forgotten on the seventh. A `MutationObserver` picks up rows as they are created.

Two specificity traps when overriding those tables: `.tbl-row.tbl--usuarios` (0,2,0) beats a plain `.tbl-row` (0,1,0), and two tables set `grid-template-columns` in a `style` attribute. Both are overridden by name in the mobile block.

**The mobile overrides for `.tbl` and `.modal` live in `admin.css`, not `shared.css`.** Those components are defined in `admin.css`, which loads *after* `shared.css`, so a same-specificity override in `shared.css` silently loses. Only the generic rules (`overflow-wrap`, `min-width: 0`, touch targets, safe areas) belong in `shared.css`.

Other rules:

- **`.tbl-cell` no longer sets `white-space: nowrap` + `overflow: hidden`.** It clipped a long email mid-character with no indication data was missing. Human-origin data (emails, district names, work titles) gets `overflow-wrap: anywhere`.
- **Every `minmax(Npx, 1fr)` became `minmax(min(100%, Npx), 1fr)`** — 17 of them. A fixed minimum overflows the grid below that width no matter how many media queries sit on top.
- **`min-height: 100dvh`**, not `100vh`: `vh` does not discount the mobile browser chrome.
- **Modals are bottom sheets below 768px**, full width, `max-height: 92dvh`, rounded top only, with `env(safe-area-inset-bottom)` in the padding and stacked full-width actions. A centred box sits behind the virtual keyboard.
- **Safe areas are folded into the existing padding with `max()`**, not layered as a separate rule — a blanket `padding-left` override reinstated the desktop 24px on phones where the mobile rule had reduced it to 14px.
- Touch targets reach 44px under `@media (pointer: coarse)`; `.pb` and `.chip` were 40px.
- Content is capped at 1440px above 1600px, where running text was stretching past 120 characters per line.

Verified at 320, 390, 414, 768, 1024, 1440 and 1920: nothing escapes the viewport without a scrollable ancestor, no text is clipped, no touch target under 44px. Note that `body { overflow-x: hidden }` masks overflow, so `scrollWidth` is not a valid check here — measure element rects instead.

### Accessibility, final pass (Phase 10)

**The focus ring is `--action`, never `--cyan-400`.** The brand cyan is the same value in both themes and scores **1.77:1** on the light background — a focus indicator needs 3:1 (WCAG 1.4.11). `--action` is theme-aware: 5.23 dark, 5.07 light. The same applied to six substitute rings in `admin.css` that used `--cyan`, and to one that used the coral alert tint, which made a focused field look like a field in error.

Eight rules still set `outline: none` on `:focus`; every one substitutes a visible `box-shadow` ring. That is the only acceptable reason to remove an outline.

**`admin.html` had 37 controls with no accessible name.** 25 modal fields used `<label>Nombre</label>` with no `for`, and the control as a *sibling* rather than a descendant — so nothing associated them and a screen reader announced a nameless edit box. The 12 search and filter inputs had only a `placeholder`, which is not an accessible name. All 47 fields now resolve to a name.

Charts carry `role="img"` with `aria-labelledby` (the section title) and `aria-describedby` (a `.chart-alt` paragraph with the same numbers in prose).

**Verification note:** `element.focus()` from a script does not match `:focus-visible`, and if the browser pane is not displayed `document.hasFocus()` is false so `:focus` never matches either. Auditing focus by driving the DOM produces false "no indicator" results — check the CSSOM for rules that match the element instead.

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

### The admin guard was inverted (migration 0008)

`set_periodo_activo` and `abrir_gestion` shipped with this guard:

```sql
IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN RAISE EXCEPTION ...
```

The `auth.uid() IS NOT NULL AND` prefix **inverts the check**: with no session the whole condition is false and the function proceeds. It blocked the signed-in non-admin and let the anonymous caller through. Verified against the database — with role `anon` and no claims, `set_periodo_activo(null)` executed without error. With only the public anon key, anyone could leave the gestión with no active period, or call `abrir_gestion` and archive the live one.

**Never write `auth.uid() IS NOT NULL AND NOT is_admin()`. The guard is `IF NOT public.is_admin() THEN`** — nothing more. There is no need for a migration escape hatch, and a `current_user` check cannot provide one anyway: inside a `SECURITY DEFINER` function `current_user` is the function's **owner**, so any such test is always true.

### Function EXECUTE grants

Revoking from `anon` and `authenticated` is not enough. PostgreSQL grants EXECUTE to `PUBLIC` on `CREATE FUNCTION`, and `anon` inherits it. The ACL shows it as a leading `=X/postgres` entry with no role before the `=`. Trigger functions need `REVOKE ... FROM PUBLIC` (migration 0010); revoking does not disable them, because a trigger runs without checking the DML user's EXECUTE.

**Five SECURITY DEFINER functions stay callable by `anon` on purpose** — `is_admin`, `is_secretario`, `get_my_distrito`, `get_district_member_ids`, `gestion_escribible`. 34 policies invoke them and a policy is evaluated with the querying role's privileges, so revoking breaks ordinary reads. `is_admin` alone appears in 27, some targeting `public`, which includes anon. To an anonymous caller they return `false` / `null` / `[]`. The Supabase linter will keep flagging them; that is expected.

**No table is readable without a session.** Verified from outside with the public anon key: all 13 tables return `[]`.

### Two sets of date columns (migration 0007)

`calendario` carried `fecha_inicio` / `fecha_fin_trabajo` / `fecha_entrega` / `fecha_jornada` as `date`, **and** `inicio` / `fin_trabajo` / `entrega` / `jornada` as `text`. The admin CRUD read and wrote the text ones; `API.getContexto()` serves the portals the `date` ones, which were all NULL. The admin saw every period's dates and the member's calendar tab was blank. The text columns are gone; `admin.js` uses the typed ones.

`periodos_evaluacion` had its four date columns NULL. PE1–PE3 were backfilled from the calendar row with the same number, which also matches on description. **PE4 was left alone**: there are two calendar rows numbered 4 and neither is named "UN SOLO LATIDO", so the correspondence is not derivable from the data.

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
