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
| `index.html` | None (login **and** registration) | `login.js` — login, password reset, recovery detection, and the Entrar / Crear cuenta switch (`setModoAcceso`); `registro.js` — registration form + password strength meter |
| `registro.html` | None | only redirects to `index.html#registro` (old links keep working) |
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

**The dark base is the brand's navy family** (UI/UX redesign): `--bg` `#061326`, `--surface-1/2/3` `#0A1D38` / `#10264A` / `#132D56`, borders tinted with `--cyan-200`. It used to be a neutral near-black (`#0E0F12`) and the site did not look like the brand. The light theme gets a `--cyan-200` veil (`--bg` `#EEF7FC`). `--cyan-200` is now the guide's `#A7E8FF`. **Pure `--navy-900` is still not a page background** — it is the brand surface, one piece per screen (profile header, Inicio hero, rail, login panel); the page behind it is its shadow. The brand's 70 / 30 / 10 split (deep blues / cyans / coral) is the target: coral stays an accent (role chip, active bar, `.tag-marca`), never a surface for body text.

**Brand surfaces redefine their own text tokens.** `.sup-marca`, `.rail`, `.bottom-bar` and `.cab-movil` always sit on navy in both themes, so inside them `--txt`, `--txt-2`, `--txt-muted` (and in `.sup-marca` the level ramp `--sex…--sba`) are re-declared to the measured `--on-brand` / `--on-brand-2` pairs. Without that, a light-theme level colour (dark, made for white) vanishes on the navy. `tools/contraste.js` measures those pairs and the label pairs on coral / cyan: navy on coral is 5.6, **white on coral is 2.9 — never use it**, even though the printed guide does.

**Brand patterns are images, not code.** The seven geometric patterns from the brand go in `img/patrones/patron-1.webp … patron-7.webp` and are only painted behind a brand surface (`.sup-marca::before`, 30 % opacity). They scroll with the page (never `background-attachment: fixed`). Each person gets one (`pat-N`, picked from their id). Do not redraw them in CSS: the brand supplied them. If a file is missing the request 404s and the surface is simply flat navy.

**`--franja` is the six-band palette strip** (navy → coral) from the guide: ornament on the rail, hero edges and section titles, never information.

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
- **The logo is the **CELIDER 08 isotipo** (`logo.webp`, `logo@2x.webp`, `logo.png`; master in `img/marca/isotipo-celider08.png`) via `<picture>`**, with `logo.png` (39 KB) as fallback. It was a 749×1093 PNG of 279 KB rendered at 44px. Regenerate both if the source changes; keep `width`/`height` on the `<img>` to avoid layout shift.
- **The isotipo is square (1:1).** Every placement keeps width = height: 40 in the rail, 32 in the mobile header, 28 in the sheet and modals, 72 in login/registro, 64 and 22 in the report header and footer. `favicon.ico` and `icono-192/512.png` put it on the navy brand ground. The site is still called EIGHT CREATORS LABs but belongs to CELIDER 08.
- The member score is rendered **once**, in the hero. Quick links are mobile-only — on desktop they duplicated the topbar.

### No executable code in the markup (Phase 7)

**Nothing runs from an HTML attribute or an inline `<script>`.** `script-src 'self'` blocks both, so anything left behind silently stops working the moment the CSP stops being Report-Only.

- **All 161 `onclick`** became a single delegated listener with an action table in `config.js` (`data-act` + `data-arg`, plus `data-arg2` for a second argument). Delegated rather than one listener per button because 49 of them lived in markup generated by `innerHTML`. Adding a button means adding an entry to `ACCIONES` — never an `onclick`.
- **The 12 `oninput` / `onchange`** in `admin.html` survived that sweep, which only looked for `onclick`. They now use `data-input` / `data-change`, dispatched by two more delegated listeners against the same `_ACCIONES_SIMPLES` allow-list. The handler is called as `f(elemento, evento)`.
- **The six inline `<script>` blocks** moved to `core/theme.js`, `login.js` and `registro.js`. `core/theme.js` loads in `<head>` **without `defer`** on purpose: applying the theme after first paint flashes white on a dark theme. It also owns the scroll-progress bar, which was writing `style.width` on every scroll event without rAF.

The CSP is now enforcing. If a page ever needs a new external origin, add it to the matching directive in `vercel.json` — do not add `'unsafe-inline'` to `script-src`.

### Login and registration (Phase 7)

**Entrar and Crear cuenta are one page** (`index.html`): two panels (`#pane-login`, `#pane-registro`) switched by `setModoAcceso()` — the selector indicator slides, the leaving form slides out and fades while the other enters, and the brand text crosses over (all CSS, off under `prefers-reduced-motion`). The inactive panel carries `inert`. `#registro` in the URL opens registration. `login.js` loads before `registro.js` (it provides `cargando()`); never redefine a global in both. **On desktop it must fit the window height without scrolling** (brand list compacts and then hides by height; sizes scale with `vh`); on mobile the brand is a one-line header.

`login.css` carries the shared layout (it used to live in two `<style>` blocks that had diverged); the motion and fit-to-screen rules are at the end of `premium.css`.

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

Redesigned around the person. **Mi perfil** answers "how am I doing"; **Inicio** answers "what do I need to do now".

**Member (`user.html`): three destinations.** Inicio · Mi perfil · Entregas.

- **Inicio** (`core/inicio.js`): hero with a countdown to the next date, my evaluation for the current period (ring + level), tasks that need attention (returned first, then by deadline) and the next dates. In a legacy period it says tasks do not apply and points to Entregas.
- **Mi perfil** (`core/perfil.js`): header card (avatar, name, role / profile-version / district chips, ring with the score and the change vs the previous period) and four inner tabs — Resumen, Criterios, Tareas, Evolución. It replaces the old *Mi Score* and *Historial* tabs.
- **Entregas**: my tasks (or the old "registrar trabajo" form in legacy periods) and one **timeline** of the period dates with "today" marked. "Fechas del período" and "Calendario" were the same data; the raw calendar cards stay in a collapsed `<details>`.
- The rubric is not a tab: v2 criteria carry their own "¿Cómo se puntúa?"; the legacy reference sits in a `<details>` inside Criterios.

**Secretary (`secretario.html`): five, in two groups.** *Mi espacio*: Inicio · Mi perfil · Entregas (same as the member; Inicio adds a "Tu distrito" block). *Mi distrito*: **Distrito** · **Tareas**.

- **Distrito** has two inner tabs: *Personas* (cards that open each person's profile in the side panel, in supervision mode) and *Ranking de distritos*. In v2 periods the cards carry "N por revisar" / "N vencidas".
- **Tareas**: assign to and review the members of *their own district*; their own tasks live in Entregas — they do not approve themselves.

**Admin: operation vs configuration.** Panel · Evaluar · Tareas · Personas · Reportes at top level; Períodos, Calendario, Rúbrica, Perfiles, Roles, Distritos and Gestiones live behind the gear. Previously all nine competed at the same level.

- **Panel** (was *Overview*) opens with **Requiere atención** (`admin-personas.js`): accesses pending approval, people not evaluated, drafts not published, deliveries waiting for review, overdue tasks — each linking to where it is solved. Only facts; it never scores.
- **Personas** (was *Usuarios*): cards by default, the old table as an alternative view. A card opens the profile in the side panel with an extra **Gestión** tab holding what each table row used to hold (role, district, type, access, admin, participation in the period, delete). Those controls still go through the same `onCambio*` / `updateUser*` handlers and API calls.

`_ALIAS_TAB` in `user.js` and `secretario.js` maps the old tab names (`scores`, `historial`, `ranking`, `periodos`…) to the new ones so saved links keep working; `#perfil/criterios` opens a profile tab directly.

**Both rubric models must keep working.** Every v2 branch starts with `esPeriodoV2(periodo)`. The profile shows a classic period on its own scale (22/30, level by 26/20/11, bonus, 7 criteria 1–4) and never mixes it with v2 in a chart or a "change vs previous"; its Tareas tab says the period does not use assignable tasks.

### Supabase Tables

`profiles`, `roles`, `periodos_evaluacion`, `criterios`, `rubrica`, `evaluaciones` (per-user scores), `evaluaciones_distrito`, `calendario`, `config`, `periodo_participantes`, `distritos`, `trabajos_entregados`. From 0015: `criterios_v2`, `perfiles_rol`, `perfil_criterios`. From 0016: `tareas`, `tarea_eventos`. Storage bucket: `avatars`.

The `credenciales` table (plaintext passwords) is dropped by migration `0002`. Do not recreate it.

### Shared core (`core/`)

Loaded by `user.html`, `secretario.html` and `admin.html`, right after `config.js`:

- **`core/store.js`** — single application state. One `periodoId` (UUID) governs the whole page; `Store.setPeriodo()` notifies subscribers so every section repaints together. Also holds the per-tab load policy (`necesitaCarga` / `marcarCargado` / `invalidar`) — one rule for all tabs, with explicit invalidation.
- **`core/render.js`** — shared presentation helpers, defined as globals because the portals are classic scripts: the `NIVELES` table, `scoreColor/Label/Class`, `getCriterios`, `calcScore` (portal rows) vs `calcScorePuntajes` (admin `puntajes` + bonus), `parseJSON`, `initials`, `setEl`, `pad`, `timeAgo`, `showToast`, `openModal`/`closeModal`, `switchTabCore`, `initScrollEffects`, `updateTimestamp`, and the three view states `renderCargando` / `renderVacio` / `renderError`.

- **`core/rubrica.js`** — presentation for the role-based rubric (v2): `NIVELES_V2`, `perfilVigenteDe`, `criteriosAplicables`, `resultadoV2HTML`, `rankingV2HTML`, `historialV2HTML`, `miScoreV2`. **No formulas** — see "Role-based rubric" below.
- **`core/tareas.js`** — the `Tareas` module: one list/modal/flow for the three portals (`Tareas.montar`, `Tareas.evidenciaHTML`; also exports `ESTADOS` and `plazoHTML`).
- **`core/ui.js`** — presentation primitives, no formulas: `anilloHTML` (SVG progress ring), `deltaHTML` (change between two already-calculated numbers, with icon + sign + screen-reader text — colour alone is never the signal), `segHTML` (segmented tabs, arrow keys), `esqueletoHTML` (skeletons instead of spinners), `animarEntrada` (ring fill + count-up; off under `prefers-reduced-motion`), `abrirPanel`/`cerrarPanel` (side panel / mobile sheet on top of `openModal`, so it keeps the focus trap and Escape), the date helpers and `lineaTiempoHTML`.
- **`core/perfil.js`** — the `Perfil` component for all three portals (modes `propio` / `supervision` / `admin`; `Perfil.configurar` adds the admin's extra tab and actions). RLS decides what each caller receives. The only derived things are a subtraction between two calculated numbers and the ordering of already-given scores ("puntos más altos / donde hay más margen"): **no score is computed here**.
- **`core/inicio.js`** — the Inicio screen (member and secretary; the secretary adds its block through the `extra` hook).
- **`core/personas.js`** — `personaCardHTML` / `rosterHTML`: the person card shared by the secretary's district and the admin's Personas.
- **`admin-personas.js`** — admin-only glue (Personas cards, the Gestión tab, Requiere atención). Kept out of `admin.js` on purpose; it shares its globals.
- **`perfil.css`** and **`inicio.css`** — styles for the above. The shared primitives (`.anillo`, `.delta`, `.seg`, `.skel`, `.panel`, `.sup-marca`, `.franja`, `.tag-marca`) live in `shared.css`.

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

### Entering the admin panel (Phase 11)

A modal asks which gestión and which period **before** any data is painted.
The preference lives in `localStorage` under `ec-admin-entrada`
(`{omitir, gestionId, periodoId}`), every access wrapped in `try/catch` —
`config.js` already documents that it can be blocked in private mode. If the
saved gestión or period no longer exists it falls back to the active one and
says why with a toast. `?gestion=` in the URL overrides the preference: it is
an explicit link. Configuración has a button to clear the key, without which
"do not show again" would be a door with no handle.

### Writing to an archived gestión (migration 0013)

`API._gid()` returns whatever `setGestion()` took from `?gestion=`. If that
gestión is archived, `savePeriodo`, `saveCriterio`, `saveRubricaRow`,
`saveCalEvento` and `saveConfig` used to insert **into the archived gestión** —
`gestion_escribible()` only covered `evaluaciones`, `evaluaciones_distrito`
and `trabajos_entregados`.

Each of those five tables carried **two** write policies: the current one and
a legacy `*_write` granted to `public` with a **NULL `WITH CHECK`**, so it
reused its `USING` clause. Permissive policies OR together, so adding the
condition to just one would have changed nothing — the legacy one still
authorised the insert. They are dropped in 0013; `gestion_id_escribible()`
now gates the rest.

On the client, `bloquearEscritura()` in `core/render.js` really disables the
controls. Note that with `data-act="fn"` the action name travels in
`data-arg`, not `data-act` — reading only `data-act` left "Guardar rol" and
"+ Nuevo período" enabled.

**Registration closes when there is no open gestión**, via the
`hay_gestion_abierta()` RPC (migration 0014) — *not* a select. `registro.html`
is visited **without a session** and `gestiones` is not readable by `anon`, so
`getGestiones()` returns `[]` and the naive check would have closed
registration for everyone. The RPC exposes one boolean and nothing else.

⚠️ This is **not** "registering into a gestión". `profiles` has no
`gestion_id`; per-gestión membership is designed in
`0006_gestion_miembros.PENDIENTE.sql`, still unapplied. Applying it rewrites 5
SECURITY DEFINER functions and 5 policies and needs frontend changes in the
same deploy.

### Role-based rubric, v2 (migration 0015)

Each period declares its `modelo` (`'legacy'` or `'v2'`) and is read with its own calculation; old periods are never rewritten. **v2 and tasks apply only to NEW periods**: every period that exists when 0015 is applied gets `v2_permitido = false` — it stays `legacy` and the database refuses to switch it to v2 (nobody re-grades someone after the fact). Periods created afterwards can use v2; `v2_permitido` is set by the server on insert and nobody changes it. The model of a period also cannot change once it has evaluations. **Every v2 branch in the frontend starts with `esPeriodoV2(periodo)`.** The frontend degrades to `[]` if 0015 is not applied, so it can be deployed before the SQL.

- **24 criteria** (`criterios_v2`, per gestión): 5 *núcleo* (same for every role, compared in absolute value) + 19 *técnicos*. Scale **1–5**, with anchors for 1, 3 and 5 (2 and 4 are in-between). **A criterion that does not apply is excluded, never scored 0**: it is not in the JSON, not on the form, not in the denominator.
- **Profiles** (`perfiles_rol` + `perfil_criterios`): per role, versioned, technical weights that **sum exactly 100** (deferred constraint trigger). A profile used by any evaluation is **immutable**; a change is `crear_perfil_rol()` → a new version that applies from a period with no evaluations for that role yet. The profile of an evaluation is fixed by the server (`perfil_vigente`) on first save and never changes — the client's `perfil_id`/`modelo` are overwritten.
- **The calculation lives in the database**, in `resultados_periodo()`, not in JS: it already diverged between portals once (`scoreClass`). Núcleo = mean of `(s−1)/4·100`; Técnico = `Σ peso·(s−1)/4·100 / Σ peso` over scored criteria; Individual = `0.6·Téc + 0.4·Núc`; Percentil = `(pos−1)/(n−1)·100` within the role (ties = mean position, so the best of every role reaches 100); General = `0.4·Núc + 0.6·Percentil`. **Roles with fewer than 4 evaluated people**: percentil := Técnico, `rol_pequeno = true`, and the screens must say so (`.v2-nota--regla`) — unexplained, it reads as favouritism. Only `publicado` evaluations count; the admin may ask for drafts (`p_borradores`) to preview.
- `resultados_periodo` is `SECURITY DEFINER` because the percentil needs peers a member cannot read; **it filters the rows it returns itself** (admin: all; secretary: district; member: self). No session → error. The guard is the right way round (`IF auth.uid() IS NULL THEN RAISE`) — see "The admin guard was inverted".
- Levels on 0–100 are the legacy 26/20/11-of-30 thresholds scaled: **87 / 67 / 37** (`NIVELES_V2`); same `--sex…--sba` tokens.
- No bonus in v2 (`bono_ext` must be 0).
- `0015_seed_perfiles.PENDIENTE.sql` creates the 8 profiles from the rubric. It is **pending on purpose**: which of the 8 rubric roles maps to which row of `roles` is a data decision. Edit its mapping table first.
- `abrir_gestion()` (redefined in 0015, same guard as 0008) also clones the v2 catalog and the latest version of each profile; the periods of the new gestión are v2 when the origin has the catalog.

### Tasks (migration 0016)

Tasks give the evaluator facts instead of memory: what was asked, for when, when it was first delivered, how many times it came back, how much was done on one's own initiative.

- **Who can do what is enforced by triggers, not the client.** `tareas_validar_insert/update` fix `origen`, `asignada_por`, `estado`, `entregada_en`, `aprobada_en` and `rondas_revision`; whatever the client sends is overwritten. Admin assigns anyone; a secretary only members of their district; a member only themselves (`origen = 'propia'`). **Nobody reviews their own task** (`puede_revisar_tarea` excludes the assignee, except the admin, who is not evaluated) — that is also what stops "own initiative" from being inflated.
- States: `asignada → en_curso → entregada → aprobada | devuelta`, plus `bloqueada` (waiting on someone else; needs a reason; **not counted as late**). Returning needs a note; delivering needs a link or a note; the delivery can only be written *at* the moment of delivering.
- The deadline moves only through `prorrogar_tarea()` (with a reason); `fecha_limite_original` never changes. `tarea_eventos` is append-only and written only by triggers (`REVOKE INSERT/UPDATE/DELETE` from clients).
- **"On time" is measured on the FIRST delivery**, in the gestión's time zone (`config.zona_horaria`, default `America/Santiago` — confirm it; a wrong zone mislabels deliveries near midnight). Fixing an observation never turns an on-time delivery into a late one.
- `resumen_tareas_periodo()` is the evidence panel in *Evaluar* (admin). It suggests which núcleo criterion each fact feeds (Plazos ← on time/overdue/moved; Calidad ← returns; Iniciativa ← own tasks *approved by someone else*) and **never scores or pre-fills anything**. Few tasks with a deadline → it says to read it with caution.
- **Tasks exist only in v2 periods** (the insert trigger rejects any other). 0016 **does not touch** `trabajos_entregados` and copies nothing: legacy periods keep the old "registrar trabajo" form (`renderTrabajosLegacy`), the member/secretary *Entregas* tab picks tasks or the old form by `esPeriodoV2(periodo)`, and the admin/secretary *Tareas* tabs explain it for older periods. Until 0016 is applied, v2 periods fall back to the old form too.
- `core/tareas.js` has its own modal (`.tk-overlay`): the shared `.modal-*` styles live in `admin.css`, which member and secretary pages do not load. In an archived gestión it offers only *Historial*.
- Fixed on the way: *Evaluar* asked `getTrabajosEntregados` for the period **name** where it indexes by id, so that panel was always empty.

### Second redesign: panel, reports, activities, periods (migration 0018)

Study and rules: `docs/estudio-uiux-evaluacion.md`. New admin-only files share the globals of `admin.js` (same pattern as `admin-personas.js`):

- **`admin-panel.js` (`PanelAdmin`)** — the Panel. Every chart answers one question (progress ring, level histogram, comparison by role/district for calibration, competency radar, trend across periods, heat map person × competency, top results). It normalises both rubric models to 0–100 **only to draw** (levels 87/67/37); official scores still come from `resultados_periodo()` or the legacy formula. `PanelAdmin.datos(periodo)` is cached; `invalidar(id)` refreshes.
- **`admin-reportes.js` (`Reportes`)** — a builder (period, scope: team/district/role/person, sections) with a printable sheet (`.rpt-hoja`; PDF by printing with the light theme forced), CSV export, and support for the role-based rubric.
- **`admin-actividades.js` (`Actividades`)** — the *Actividades* tab: literal activities (title, date or range, label, scope), independent of periods, plus label management.
- **Migration 0018** (`actividades`, `etiquetas`, `mi_distrito()`): admin writes everything; a secretary writes only activities of her own district; everyone reads team-wide ones and those of their district; no writes in an archived gestión. Labels have a tone from the 8-tone palette and are seeded per gestión by trigger. **Apply 0018 after 0017.** The calendar degrades gracefully (`disponible:false`) if it is not applied. Tests: `tools/pruebas/sql-0018.mjs`.
- **Calendar** (`core/calendario.js`): create an activity or assign a task straight from a day; the legend is built from labels and filters the grid. Tasks still belong to a period: the one containing the day, else the active one, and the task form lets the person choose among role-based periods.
- **Periods**: list split into *Rúbrica por roles* / *Clásicos* with a timeline; guided form (name → model → dates in order → active); new periods get suggested dates after the previous one; dates are validated (start ≤ end of work ≤ delivery ≤ ceremony).
- **Roles y perfiles** are one screen (a card per role with its current profile, a stacked weight bar and older versions); **Rúbrica** is split *Por roles* (common vs role competencies with 1-3-5 anchors) and *Clásica*.
- **Full criterion names everywhere** — never the 3-letter codes. **Evaluar** keeps its header fixed (period, search, role/district selects, status chips and shortcuts with counts) and each column scrolls on its own.
- **Mi cuenta** (`core/cuenta.js`): photo, name, assigned data (read-only), theme, password, sign-out.

### Auditoría de interfaz (octubre 2026)

Informe y evidencia en `docs/auditoria-ui-oct-2026.md`. Reglas que salieron de ahí:

- **Toda pestaña abre con `.pantalla-cab` + `h1.pantalla-t`** (título en minúsculas/título, nunca MAYÚSCULAS escritas a mano; `.ptitle` y `h2.tab-title` ya no se usan). La acción primaria de la pantalla (crear) va dentro, en `.pantalla-acc`, como `.btn-save`; exportar o volver son secundarios (`.btn-out`). `front-rediseno.mjs` lo comprueba.
- **`.filtros-fila`** es la fila de filtros de Evaluar, Personas, Tareas y Distritos (período + búsqueda + selects). No improvises cajas con `style=""`.
- **Un fondo opaco sobre `.amain`/`#contenido` tapa la luz ambiental** y dibuja un recuadro; las cabeceras no llevan fondo.
- **`premium.css` carga el último**: lo que un `admin.css` o `shared.css` ya fijó (p. ej. el tope del contenido de `.amain`) se corrige ahí, no con `!important`.
- Puntero grueso: chips, botones de icono, enlaces de tarjeta y botones del rail llegan a 44 px (`@media (pointer: coarse)` al final de `premium.css`).
- `tools/pruebas/ui/audit-layout.js` mide overflow, objetivos táctiles, texto bajo `--fs-xs` y controles sin nombre en el DOM real (`__aud()`, `await __sweep([...tabs])`). Úsalo con `npm run ui` a 320/390/768/1024/1440/1920 antes de dar una pantalla por buena.
- **Tema claro**: los contenedores (`.tarjeta`, `.pf-card`, `.lista-aj`, `.tk-card`…) llevan anillo `--trazo` + `--shadow-sm` y los campos `--campo-borde` (3:1) — ver el bloque «Tema claro» al final de `premium.css`. Un contenedor nuevo se añade a esa lista. Al revisar el tema claro, ojo: con el panel del navegador oculto las transiciones no terminan y se ven colores a medio cambiar; recarga con `localStorage ec-theme=light` en lugar de cambiar `data-theme` en caliente.
- Producción (`eight-coms.vercel.app`) puede ir por detrás de la rama: compara huellas de `marca.css`/`premium.css` antes de afirmar que algo "ya está desplegado".

### Canonical components (phase 1 of the second redesign)

`marca.css` ends with the components every screen must use: **six buttons** (`.btn--primario` coral, `--secundario` outline, `--texto`, `--peligro`, `--icono` circle, `--chip`; all historic classes — `btn-save`, `tk-btn`, `btn-cfg-add`, `cal2-btn`… — are mapped to them), **`.etiqueta`** (pill with a dot; `--etq-coral|violeta|verde|ambar|cian|azul|rojo|gris`, 8 tones measured at 3:1 in both themes by `tools/contraste.js` — the only colours allowed outside the brand ramp, for categories/calendar labels), **`.pantalla-cab`** (title + context + one primary action) and **`.tarjeta`** / **`.tarjeta--kpi`**. One primary per view. Study and rules: `docs/estudio-uiux-evaluacion.md`.

### Brand identity contract (`marca.css`)

`marca.css` is the written rule set for shape, elevation, colour, type, action and lists; `premium.css` implements components on top of it. Both load **last** (order: page sheet → `marca.css` → `premium.css`) so the system wins over page sheets. **No square corners**: radius scale `--r-control` (pill) / `--r-xs` 8 / `--r-fila` 12 / `--r-card` 20 / `--r-cont` 28 / `--r-modal` 32 / `--r-hero` 40; the old `--r-sm/md/lg/xl` names now alias that scale. A new component joins one of the category lists at the bottom of `marca.css` instead of declaring its own radius. Verify with the DOM check: any element with a background or border, at least 40×24, radius 0 and not inside a rounded `overflow:hidden` container is a bug.

### Premium system (anti-"AI look" pass)

The target is a dark, premium product app (diffuse blue light, compact display type, pill controls, settings-style lists), not a card template. The rules live in the last block of `shared.css` ("SISTEMA PREMIUM"), which is written to win the cascade; page sheets only add what is theirs.

**What was removed on purpose** (do not reintroduce): `backdrop-filter` on cards (only the modal/panel/buscador overlays keep a blur); `--vidrio` and `--sombra-dura*` are now flat/`none` tokens; hover lifts (`translateY`, `scale`) and glow shadows; entrance animations per block (`entra/sello/sube/tabIn/slideRow`); the 10 % pattern strip under the header; the coloured KPI blocks (`.v2-kpi` is a plain `--surface-2` tile) and the cyan/blue cards of Inicio. **One brand surface per screen** (hero or login panel) and **one gradient protagonist** (`--brillo`, now a same-hue gradient of `--action-fill`, only on the primary CTA: `.btn-save`, `.tk-btn--main`, `.btn-login`).

- **Surfaces** (each is a real elevation): `--bg` canvas (carries the light) < `--surface-1` container < `--surface-2` row/field < `--surface-3` active/hover. Borders (`--trazo`) only where two same-level things meet.
- **Radii**: `--r-control` pill (buttons, chips, `.seg`), `--r-fila` 12, `--r-card` 20, `--r-cont` 28 (list containers, panels, calendar), `--r-modal` 32, `--r-hero` 40.
- **Type** (role · family · weight · line-height · tracking): display = Barlow Condensed 700, 1.02, −.02em (`--tr-display`/`--lh-display`); titulo 700, 1.05, −.01em; fila = Barlow 600; cuerpo = Source Sans 3 400; micro = `--txt-muted`. One key word per headline may use `.acento` (`--data-txt`; `--cyan-200` on the brand surface), never a gradient on text.
- **Rhythm**: `--sec-hero` / `--sec-main` / `--sec-sub` (from `--sp-*`), not one uniform gap.
- **Ambient light** (`.luz`, applied to `#contenido`, `.amain`, and the login form panel): two asymmetric, very soft radial blobs from `--blue-500`/`--cyan-400`; configure with `--luz-a/-b`, `--luz-op`, `--luz-ax/-ay/-bx/-by`, `--luz-size`. Light theme uses the same light at lower opacity. It is a component: do not copy a `::after` into a section.
- **Buttons**: primary (`.btn-save`), secondary (`.btn-ghost`, outlined pill), text (`.btn-texto`), destructive (`.btn-danger`); every one has hover, active, `:focus-visible`, disabled and (`.is-loading`).
- **Periods** (`renderPEBar`): thin elongated bar under the active period + dots for the rest; `.pb--hoy` adds a `--marca` dot.
- **Settings-style lists**: `.lista-aj` container (`--surface-1`, `--r-cont`) with `.fila-aj` rows (title + description left, indicator right, hairline dividers). `.pf-tareas` already renders this way.
- **States**: empty = dashed outline, left-aligned; error (`role="alert"`) = `--alert` left bar + "!" icon + text; loading = `.skel`/`.spin`. They never look alike.
- Verify with `?as=...` pages and `__contraste()` after adding `*{animation:none!important;transition:none!important}`: with the browser pane hidden, transitions never finish and the audit reads half-faded colours (false 1.0–1.1 ratios).

### Points per task (migration 0017)

Whoever approves a task assigns **0–10 points**, mandatory at the moment of approval. `zz_tareas_puntos` (runs after `tareas_validar_update`) enforces it: points are written only on approving, only the admin corrects them afterwards, reopening clears them. **(Superseded by 0033–0035: the points now feed `resultados_periodo()` through the task grade — see "Teams, collective tasks and the task grade" below. Direct admin corrections by UPDATE are no longer allowed: use `corregir_nota_tarea()`.)** Apply **0017 after 0016**. The approve modal (`Tareas.modalAprobar`) uses `.tk-puntos` radio chips.

### Calendar, search and "from anywhere" actions

- `core/calendario.js` is a section for every role (nav item *Calendario*; admin also has the *Calendario* tab, the old config tab is now *Actividades*). It merges PE ranges, activities/jornadas and tasks (due dates, overdue, delivered, approved) into one month grid + agenda panel (`.cal2*` in `perfil.css`). PE buttons (`renderPEBar`) show their date range and mark today (`.pb--hoy`).
- `core/buscador.js` is the Ctrl/⌘+K palette (`Buscador.registrar(fn)` per portal): jump to a section, open a person's profile, start an action. Everything it offers already exists; RLS still decides what works.
- Actions reachable from anywhere: `Tareas.nueva({soloPersona, fecha})`, `Perfil.nuevaTarea`, the profile *Tareas* tab (full review list for supervisors), `perfilVer` from *Evaluar* cards, calendar events (`calVer`, `calNueva`). New actions are registered in `ACCIONES` (config.js) as usual.
- Visual language: see "Premium system" above (flat layered surfaces, ambient light, pill controls, brand-navy rail). **Text on the `--brillo` cyan gradient is always `--navy-900`** (white fails contrast in the light theme). Icons are **Remix Icon** SVGs (Apache-2.0, via `@iconify-json/ri`) bundled in `core/iconos.js` (regenerate with `tools/generar-iconos.mjs`; `<name>-fill` keys are the filled variants). **Never emojis or text glyphs as icons**: medals use `medallaHTML(pos)`; the markup is still `data-lucide="name"` through a shim, no CDN.
- *Evaluar* (admin): progress bar of published evaluations, status chips (`evalFiltro`), list beside the form on ≥1100px.

### Tests (`tools/pruebas/`)

`npm install && npm run todo` there runs 0015–0025 (the written, tested ones: see `package.json`) against a real Postgres (PGlite) as `authenticated`/`anon` so **RLS counts**, plus the front helpers (`front.mjs` for the rubric; `front-rediseno.mjs` for the UI primitives, the new files, the actions and the portals' markup, including "no inline handlers"). `npm run ui` serves the real site (real CSP) with a simulated Supabase. The site itself still has no build. See `tools/pruebas/README.md`. Run `node tools/contraste.js` too: it also scans `rubrica.css`, `tareas.css`, `perfil.css` and `inicio.css`.

### Instalable como app (PWA) y correos de Auth

- **Añadir a inicio** funciona en Android (Chrome/Edge: `beforeinstallprompt` capturado en `core/pwa.js`) y en iPhone (solo Safari; no hay API, la fila de **Mi cuenta → Instalar en tu celular** explica el gesto). Piezas: `manifest.webmanifest` (standalone, iconos 192/512 any + maskable), `icono-180.png` (apple-touch-icon opaco; `node tools/generar-icono-apple.mjs` lo regenera desde `icono-512.png`), metas de iOS en las cuatro páginas, `sw.js` y `offline.html`.
- **El service worker no cachea nada** salvo `offline.html` y el icono: el sitio no tiene build y sirve datos por persona, así que cachear scripts o respuestas enseñaría versiones viejas o datos de otra sesión. Solo intercepta navegaciones para mostrar «Sin conexión». Sube `VERSION` en `sw.js` si cambias `offline.html`.
- La barra de estado de iOS es `black` (opaca, el contenido empieza debajo): con `black-translucent` habría que añadir `env(safe-area-inset-top)` a cada cabecera.
- **Celular**: `.tab-content` ya no reserva 48px arriba (franja muerta bajo el encabezado fijo); los avisos de «Requiere atención» van en una fila; el calendario mantiene celdas ≥44px de ancho desde 360px.
- **Hook de correos (`auth-correo`)**: Auth da **5 s** al hook y el puente de Apps Script tarda 4–8 s. Por eso la función valida la firma, arma los correos, **responde 200 de inmediato** y envía en segundo plano (`EdgeRuntime.waitUntil`, 3 intentos). Esperar el envío dentro del handler provoca `hook_timeout` y la persona no recibe nada. Si un correo falla tres veces solo queda en el log de la función.

### Mobile design (`movil.css`) — separate from the desktop one

`movil.css` is linked with `media="(max-width: 767px)"` after `premium.css`, so tablet and desktop never see it. It is the contract for phones, not a resize of the desktop layout:

- **Type scale** (redefines `--fs-xs…--fs-hero`): 14 / 16 / 17 / 21 / 24–28. Nothing under 14 px except the bottom-bar label (13 px, with icon). Audit with `__peq()` (sum of text nodes under 14 px) in the simulator; the last pass left only the 13 px bar labels.
- **Touch**: fields and primary buttons 52 px (`--m-ctrl`), secondary 48 (`--m-ctrl-sec`), nothing under 44.
- **Header** (`.cab-movil`, built by `renderCabeceraMovil`): logo 44 px, brand overline + screen name, search and **bell**. The screen's own `h1` is visually hidden on mobile (kept for screen readers) so the name is not repeated. If the title equals the brand it is not shown twice (`_TITULOS_EXTRA`, `.cab--sin-marca`).
- **Bottom bar**: icons only; the active destination is a wider pill with icon + name; inactive names stay in the DOM as `sr-only`. A portal can mark frequent destinations with `fav: true` in its `initNav` items (the secretary's Distrito and Tareas) so they do not hide inside «Más».
- **«Más» sheet**: destinations as a 3-column tile grid, actions in 2 columns, ≤ 70 dvh. The account row opens Mi cuenta. The handle is **real**: `hojaArrastrable()` (core/ui.js) closes the sheet on a downward drag. Never draw a handle on something that cannot be dragged. `openModal` adds the handle and the `X` to every `.modal-box`/`.tk-box` (the X is a zero-height sticky block, not a float — a float shifted the centred logo) and the handle to `.panel`.
- **Components**: `acordeonHTML()` (native `<details>`, state remembered per id in `sessionStorage`), `escalaHTML()`, `puntosHTML()`. Use the accordion only where hiding detail lowers load without hiding what is needed to decide.
- Logos: 72 px in dialogs, 44 in the mobile header, 48 in the rail. Square, always.

### Bell and in-app notices (migration 0022)

The bell reads the same queue as the emails (`notificaciones`, 0019), through four SECURITY DEFINER functions (`mis_notificaciones`, `notif_no_leidas`, `notif_marcar_leida`, `notif_marcar_todas`) that filter by `auth.uid()` themselves; the table still has no grants for `anon`/`authenticated`. `leida_en` does not affect sending. A notice scheduled in the future shows when its time comes, like the email. `core/notificaciones.js` (`Notif`) maps each type to an icon, title and destination tab per portal (`DESTINOS`): a new type in 0019 must be added there (a front test checks every 0019 type is covered). It polls every minute and on tab focus. Without 0022 the panel says the notices are not active yet (`noDisponible`) instead of pretending there are none. Unread = tinted background + left bar + bold title + `sr-only` text (never colour alone).

### Scoring by weight (migration 0023)

In **new** v2 evaluations each criterion is scored from **0 to its own weight** (technical) or **0 to 10** (núcleo), by dragging a bar, typing the number or ±1. `evaluaciones.escala` is `'cinco'` (everything saved before 0023, still 1–5 and computed exactly as before) or `'pesos'`; the server fixes it on the first save and ignores the client. `resultados_periodo()` normalises each to 0–100 (técnico = Σ points · 100 / Σ weights of the scored criteria; núcleo = mean of points/10), so a period can mix both and the percentil still compares fairly; it now returns `escala`. Clients must read a score through `rangoPuntajeV2(c, escala)` / `pctPuntajeV2(v, rango)` — never assume 1–5 or order criteria by raw number. A criterion left blank is *not scored* (excluded, never 0), so 0 is a valid score and `!!puntaje` is a bug: use `!= null`. `API.escalaPorPeso()` is true only if the column exists (probe), so the frontend can ship before 0023 and keeps scoring 1–5.

### Manuals (`ayuda/`)

Three manuals (member, secretary, admin) generated by `node tools/generar-manuales.mjs` — edit the generator, not the HTML. They describe only what exists today; every manual has a «Lo que aún no hace» section (role preferences, roles per activity, onboarding wizard, global PE view are **not implemented**). Screenshots in `ayuda/img/` come from the simulator with invented data and say so. They are linked from the rail (desktop), the «Más» sheet and Mi cuenta (`cfg.ayuda` in each `initNav`, `window.AYUDA_URL`). Update the text and recapture when a screen changes.

### Evolución integral: roles, selector, asignación, actividades, seguimiento, bienvenida, reportes (0021, 0024, 0025)

**Tres cosas que nunca se mezclan.** El rol **funcional** (`es_admin` / `tipo_miembro`) decide permisos y no se toca aquí. El rol **operativo** (`roles`, lo que se hace en el equipo): `profiles.rol_id` es el principal y decide el perfil de evaluación. Los **permitidos** (`persona_roles`, los define la administración) son los roles con los que a una persona se le puede asignar trabajo. Las **preferencias** (`preferencias_rol`, las define la propia persona, en orden, con un rol predeterminado) son **información, nunca una restricción ni un permiso**: el predeterminado tiene que estar entre los permitidos (lo impone un trigger), pero se puede preferir un rol que no se tiene habilitado.

- **0021** — `roles.descripcion / responsabilidades / requisitos` (la administración los edita en Roles y perfiles y los ven las personas al recibir una tarea, en Mi cuenta y en la bienvenida), `persona_roles`, `preferencias_rol` + `guardar_preferencias_rol()` (reemplaza todo en una transacción; sin escritura directa), `tareas.rol_id / rol_excepcion / actividad_id`, `personas_asignables(periodo, rol)` (administración: todas; secretaría: su distrito; miembro: nada) con compatibilidad, preferencia y carga ya calculadas. **Una secretaría no puede asignar un rol que la persona no tenga permitido; la administración sí, y la tarea queda con `rol_excepcion = true`** (el servidor lo fija; el cliente no lo borra). Un rol que no cambia no se revalida: cambiar de estado una tarea no se rompe porque después le quitaron el rol a la persona. Una actividad con tareas vinculadas **no se borra** (trigger con mensaje claro): un `ON DELETE SET NULL` en cascada pasaría por los guardias de `tareas` y chocaría con «una tarea aprobada es historia». Quitar un permitido (o cambiar el rol principal) limpia el predeterminado, no la preferencia.
- **0024** — `actividades.alcance` (`equipo` | `distrito` | `seleccion`), `actividad_destinatarios` (sin escritura directa) y `guardar_actividad()` (crea o edita la actividad y reemplaza sus destinatarias en una sola operación; valida por rol funcional; gestión archivada = solo lectura). La visibilidad la impone RLS con ayudantes SECURITY DEFINER (`act_soy_destinataria`, `act_destinataria_de_mi_distrito`, `act_creada_por_mi`) para que las políticas de las dos tablas no se llamen en círculo: una «seleccion» la ven sus destinatarias, quien la creó, la administración y la secretaría del distrito dueño (la de una secretaría queda anclada a su distrito). **Elegir un equipo en la pantalla expande a sus miembros de ese momento** (la selección siempre es una lista de personas). La migración conserva el significado de lo existente (con `distrito` pasa a `distrito`, sin él a `equipo`) y deshabilita un instante `actividades_fijar` para el backfill (en el SQL Editor no hay sesión). Parchea con `pg_get_functiondef` el aviso de «actividad nueva» y el recordatorio de la víspera de 0019 para que respeten el alcance (si 0019 no está, esa parte se salta); `guardar_actividad` encola el aviso de una «seleccion» cuando ya tiene destinatarias. Un cliente anterior a 0024 que manda `distrito` sin alcance se interpreta igual.
- **0025** — `seguimiento_global(gestion)` (una fila por persona × período; **administración todo, secretaría su distrito, miembro su fila**; los borradores solo los ve la administración y los demás los ven como «sin publicar» sin puntaje; reutiliza `resultados_periodo()` y las definiciones de tareas de 0016: no hay segunda fórmula), `reporte_actividades(gestion)` (tareas por actividad y persona; necesita 0021 y 0024), `bienvenida_estado` + `bienvenida_guardar()` / `bienvenida_reiniciar()` (el perfil del asistente lo fija el servidor según el rol funcional real; **las personas que ya existían quedan `omitida`** para no abrirles el asistente de golpe).
- **0026** — la etiqueta de partida «Hito» pasa a llamarse «Evento» (renombra la existente sin tocar colores ni actividades; si una gestión ya tiene su «Evento» no se toca) y `sembrar_etiquetas` siembra «Evento».
- **Aplicación**: en orden **0021 → 0024 → 0025 → 0026**. El frontend degrada sin ellas: `API.rolesAmpliados(roles)` (columnas de 0021), `_rpcAusente` / `noDisponible` en cada llamada, `API.alcanceDisponible()` (sondea `guardar_actividad`), `crearTarea` solo manda `rol_id` / `actividad_id` si hay valor. «Personas y equipos» queda desactivado y se explica; las pestañas Seguimiento y Reportes dicen qué migración falta; la bienvenida simplemente no aparece.

**Componentes (todos con `escHtml`, acciones por `ACCIONES`, nada de `onclick`).**
- `core/selector.js` (`Selector`) — personas y equipos (distrito o rol) con búsqueda sin tildes, filtros Todos / Equipos / Personas, insignias (rol, habilitado, prefiere n.º N, predeterminado, carga, vencidas, no participa) y Enter para elegir la primera coincidencia. Solo presenta: lo que puede ver quien llama ya viene filtrado por la base. Se usa en Nueva tarea y en el formulario de actividad.
- `core/asignar.js` (`Asignar`) — Nueva tarea para quien revisa, en tres pasos: **Qué → Quién → Rol y resumen** (un rol **por persona**, que carga responsabilidades y competencias del rol; competencias que evidencia la tarea; resumen). Validaciones: incompatibilidad (**bloquea** a la secretaría, **avisa** a la administración), duplicado (mismo título abierto), sobrecarga (`Selector.SOBRECARGA` = 5 abiertas o alguna vencida), no participa, fecha pasada; los avisos se confirman con una casilla. La iniciativa propia de un miembro conserva el formulario simple de `core/tareas.js`.
- `core/actividad-form.js` (`ActividadForm`) — crear y editar actividades desde Actividades (admin) y Calendario (admin y secretaría): **Tipo** (la etiqueta) y **Para quién** (la secretaría solo ofrece su distrito y personas de su distrito), con un renglón que dice a cuántas personas se avisará.
- `core/preferencias.js` (`Preferencias`) — «Mi rol y mis preferencias» en Mi cuenta (no se muestra a la administración, que no se evalúa): orden con flechas (accesible), estrella de predeterminado solo en roles habilitados.
- `core/seguimiento.js` (`Seguimiento`) — pestaña Seguimiento (admin y secretaría) y «Todos los períodos» dentro de Mi perfil → Evolución. Tablas que pasan a tarjetas bajo 768 px.
- `core/reporte-equipo.js` (`ReporteEquipo`) — cortes «Entre períodos» y «Por actividad» (secciones del constructor de Reportes del admin y pestaña Reportes de la secretaría). **Cada cifra dice su numerador y su denominador** (publicadas ÷ participan; a tiempo ÷ entregadas con plazo; entregadas ÷ asignadas; aprobadas ÷ entregadas), un denominador 0 se muestra «—» (nunca 0 %), y la rúbrica por roles y la clásica **no se promedian entre sí**. Los CSV traen numerador y denominador en columnas separadas.
- `core/bienvenida.js` (`Bienvenida`) — asistente por rol funcional (creator / secretaría / administración) con progreso y reanudación; se abre solo la primera vez, deja la tarjeta «Primeros pasos» en Inicio / Panel (`#bv-slot`) y se repasa desde Mi cuenta. Algunos pasos se dan por hechos solos (foto, preferencias).
- `evolucion.css` carga **después de `premium.css` y antes de `movil.css`** en las tres portales; `tools/contraste.js` lo mide. Trampa vista aquí: una regla móvil `.seg-celda` pierde contra `.seg-tabla td` por especificidad — se escribe `.seg-tabla td.seg-celda`.
- Simulador (`tools/pruebas/ui/fake-supabase-client.js`): tablas y RPC nuevos; `?bv=1` (persona nueva: la bienvenida se abre sola), `?bv=2` (a medias) y `?bv=0` (todas omitidas; el valor queda en `sessionStorage`, así que pásalo explícito).

### Teams, collective tasks and the task grade (migrations 0031–0036)

Full audit and findings: `docs/auditoria-equipos-calificaciones.md`. Notification emission points: `docs/equipos-puntos-de-emision.md`. Apply **0031 → 0032 → 0033 → 0034 → 0035 → 0036**, after 0025 (needs 0015–0018, 0021, 0023). The frontend degrades (`noDisponible`) before they are applied.

**Root cause that was fixed.** 0017 stored the 0–10 points of each approved task and *declared* they feed no formula; nothing read them. They now enter the evaluation through **one** definition in the database: `calif_puntaje()` (0034) → `resultados_periodo()` (0035). Perfil, panel, reportes, ranking and `seguimiento_global()` all read `resultados_periodo()`, so no screen recomputes anything. Never add a second formula in JS.

**The formula** (computed on read — no cache, no totals table, so create/correct/annul updates every screen at once and cannot duplicate):

```
nota_tareas = 100 · Σ(peso_efectivo · puntos/10) / Σ(peso_efectivo)       over the tasks that COUNT
peso_efectivo = tarea.peso × multiplicador del tipo (individual | colectiva, from periodo_calif_config)
individual = (1−w)·(0.6·técnico + 0.4·núcleo) + w·nota_tareas            w = peso_tareas/100, only if the person has nota_tareas
general    = (1−w)·(0.4·núcleo + 0.6·percentil) + w·nota_tareas          percentil still ranks the técnico
```
Counts: approved + points + grade not annulled (+ own-initiative only if `contar_propias`). Does NOT count (and is never a 0): delivered-awaiting-review, in progress, returned, blocked, annulled task, annulled grade, approved-before-0017-without-points. Overdue-never-delivered counts as 0 **only** if the PE rule `vencidas_como_cero` is on (off by default). Fewer counting tasks than `minimo_tareas` → `nota_tareas = NULL` and w = 0 (the person keeps their pure evaluation; nobody is penalised for not having graded tasks). `resultados_periodo()` now also returns `individual_eval`, `general_eval`, `tareas`, `tareas_n`, `peso_tareas`; `individual`/`general` already include the tasks.

**Rules per PE** (`periodo_calif_config`, admin-only via `calif_config_guardar()`, motive required if evaluations are already published, every change in `periodo_calif_config_hist`): `peso_tareas` %, `mult_individual`, `mult_colectiva`, `minimo_tareas`, `contar_propias`, `vencidas_como_cero`, `confirmado`. Initial values (a business decision pending, documented and flagged "sin confirmar" in the UI until saved): **PE existing at migration time → 0 %** (published results do not change); **new v2 PE → 20 %** (provisional); all multipliers 1, minimum 1, overdue not as 0. `core/evaluacion-perfil.js` `montarReglas()` edits them (Equipos tab).

**Teams** (`equipos`, `equipo_miembros`, `equipo_eventos`; 0031). One team = one group of people **for one v2 PE** (`periodo_id`, immutable). Only admin writes (all through `equipo_guardar`, `equipo_cambiar_estado`, `equipo_agregar_miembros`, `equipo_retirar_miembro`; direct DML is revoked). Members read their teams (current roster only), the secretary reads teams whose `distrito` is hers or that have someone of her district, with their history. Unique **active** membership per (team, person) (partial index); re-adding someone creates a new row. Eligible = approved profile, not admin, not `periodo_participantes.activo = false`; if the team has a `distrito`, members must belong to it unless the admin passes an explicit exception **with a motive** (stored on the row). **Policy when a member changes district / stops participating: nothing changes silently** — an `alerta` event is written and `equipo_integrantes()` flags it until the admin decides. No DELETE anywhere: teams are inactive/archived (archiving needs a motive and no open collective tasks).

**Collective tasks** (`tareas_equipo` + `tarea_equipo_participantes` + `tarea_equipo_aportes` + `tarea_equipo_eventos`; 0032). **One shared row**, not one copy per member. Participants are the active members when it is created; people who join later are added to still-open tasks (asignada/en_curso/bloqueada/devuelta), people who leave drop out of open/delivered ones; approved/annulled never change. Who: admin assigns/reviews any team; a secretary only teams whose `distrito` is hers and only if she does not take part; members move it to *entregada*, report progress (`tarea_equipo_aportar`, authorship fixed by the server) and cannot edit, approve, extend or annul. `entregada_por`/`entregada_en` are set by the server (first delivery measures the deadline). States add `anulada` (needs a motive, only admin reopens). "Completed" exists only as a persisted transition. **No file storage**: evidence is an http(s) link and/or a note. Progress (`tarea_equipo_avance`): approved/delivered = 100, annulled = none, otherwise the last % a member reported.

**Grades** (0033). Individual `tareas` gain `peso`, `puntos_original`, `nota_anulada_*`, `anulada_*`, `anulacion_motivo` and state `anulada`; a **PROPIA task always weighs 1**. Points are written only when approving (mandatory). Afterwards only `corregir_nota_tarea / anular_nota_tarea / restaurar_nota_tarea(tipo, id, …, motivo)` (admin, motive ≥ 5) change them, and every grade event lands in `calificaciones_historial` (append-only, with the weights and PE rules in force). A task with grade history cannot be deleted. Collective grade = the group's (a person counts once per task); `nota_individual_equipo()` (reviewer/admin, evidence ≥ 10 chars) replaces it for ONE person only and is shown apart. A person counts for a collective task if they were a participant when it was approved **or** left at least one contribution. `equipo_resultados()` counts each task once for the team figure.

**Reading contract for reports/panels** (consume, do not recompute): `resultados_periodo(periodo, borradores)`; `tareas_calificacion_detalle(periodo, persona)` (every piece with `cuenta`, `razon`, `aporte_pct`, `aporte_puntos`); `tareas_calificacion_resumen(periodo)`; `seguimiento_global(gestion)` (now with `individual_eval`, `tareas_nota`, `tareas_n`, `peso_tareas`, `colectivas_total`, `colectivas_aprobadas`); `equipos_resumen`, `tareas_equipo_estado`, `equipo_resultados`. `calif_items` / `calif_puntaje` are **internal** (revoked from clients). Annulled tasks/grades are excluded from every count (`resumen_tareas_periodo`, `reporte_actividades`, `seguimiento_global` were recreated with the same definitions).

**Frontend.** `core/equipos.js` (`Equipos`: admin list/filters/form/detail/history, member «Mis equipos», task actions; mounted in the admin *Equipos* tab and below the tasks of the member/secretary *Entregas* tab), `core/evaluacion-perfil.js` (`EvaluacionPerfil`: «Cómo se compone tu evaluación» in the profile Resumen — one mount point in `core/perfil.js` — and the PE rules editor), `equipos.css` (tokens only; loads after `evolucion.css`). Actions via `ACCIONES` (`eq`, `evReglas`), the filter inputs via `eqFiltrar`. The approve modals also set the task weight. `Tareas.abrirModal` gained a `html` field type (callers must escape).

**Tests.** `tools/pruebas/sql-0031…0036.mjs` (+ `base-eq.mjs`, which mimics Supabase default grants so a missing REVOKE fails), `front-equipos.mjs`, and `sql-0025.mjs --con-equipos` (applies 0031–0035 over existing data: the migration must not change published results). Simulator: `ui/fake-supabase-client.js` has teams, collective tasks, rules and the integrated results. **Deployment trap found by the regression run:** a data-fill `UPDATE` on `tareas` in the SQL Editor has no `auth.uid()`, so 0033 disables user triggers on `tareas` for that statement only.

### Migrations

Schema changes live in `supabase/migrations/NNNN_descripcion.sql`, applied by hand in the Supabase SQL Editor in numeric order (**0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, then 0024 and 0025, then 0031–0036**; `0015_seed_perfiles.PENDIENTE.sql` after reviewing its role mapping). `supabase-schema.sql` is a historical snapshot, **not** the source of truth — the live database has drifted from it. Verify against `pg_policies` / `information_schema` before relying on it.

### Password Reset Flow

The reset email redirects to `index.html`. Supabase delivers the token in the URL hash. `supabase-client.js` has `detectSessionInUrl: true` which parses it. `index.html` listens for `PASSWORD_RECOVERY` event via `SB.auth.onAuthStateChange` and swaps the login form for the reset form (`#reset-form`). The `redirectTo` in `doResetPassword()` must match the deployed URL.

## Key Patterns

- All user-supplied data rendered via `innerHTML` must go through `escHtml()` (defined in `config.js`)
- Lucide icons auto-render via MutationObserver in `config.js` — just add `data-lucide` attributes
- Each page calls `Auth.requireRole()` / `Auth.requireAuth()` on DOMContentLoaded to enforce access; unauthorized users redirect to `index.html`
- Scoring (**legacy periods**, `periodos_evaluacion.modelo = 'legacy'`): 7 criteria × 4 points max = 28 base + 2 bonus = 30 max. Levels: **Excelente ≥26, Bueno ≥20, En Proceso ≥11, Bajo <11** — defined once in the `NIVELES` table in `core/render.js`. `scoreColor`, `scoreLabel` and `scoreClass` all derive from it; never write thresholds inline. (Before Phase 3A, `scoreClass` used 24/18/10 in `user.js`/`admin.js` while the label and colour used 26/20/11, so a score of 25 rendered the text "Bueno" inside an "Excelente"-styled badge.)
- District evaluations use a separate 4-criteria system (CGO, CCT, COM, CEE) with max 7 per criterion

## Language

All UI text is in **Spanish**. Variable names mix Spanish and English.
