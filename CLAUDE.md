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

### Supabase Tables

`profiles`, `roles`, `periodos_evaluacion`, `criterios`, `rubrica`, `evaluaciones` (per-user scores), `evaluaciones_distrito`, `calendario`, `config`, `periodo_participantes`, `distritos`, `trabajos_entregados`. Storage bucket: `avatars`.

The `credenciales` table (plaintext passwords) is dropped by migration `0002`. Do not recreate it.

### Migrations

Schema changes live in `supabase/migrations/NNNN_descripcion.sql`, applied by hand in the Supabase SQL Editor in numeric order. `supabase-schema.sql` is a historical snapshot, **not** the source of truth — the live database has drifted from it. Verify against `pg_policies` / `information_schema` before relying on it.

### Password Reset Flow

The reset email redirects to `index.html`. Supabase delivers the token in the URL hash. `supabase-client.js` has `detectSessionInUrl: true` which parses it. `index.html` listens for `PASSWORD_RECOVERY` event via `SB.auth.onAuthStateChange` and swaps the login form for the reset form (`#reset-form`). The `redirectTo` in `doResetPassword()` must match the deployed URL.

## Key Patterns

- All user-supplied data rendered via `innerHTML` must go through `escHtml()` (defined in `config.js`)
- Lucide icons auto-render via MutationObserver in `config.js` — just add `data-lucide` attributes
- Each page calls `Auth.requireRole()` / `Auth.requireAuth()` on DOMContentLoaded to enforce access; unauthorized users redirect to `index.html`
- Scoring: 7 criteria × 4 points max = 28 base + 2 bonus = 30 max. Levels: Excelente ≥24, Bueno ≥18, En Proceso ≥10, Bajo <10
- District evaluations use a separate 4-criteria system (CGO, CCT, COM, CEE) with max 7 per criterion

## Language

All UI text is in **Spanish**. Variable names mix Spanish and English.
