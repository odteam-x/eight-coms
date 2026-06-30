# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EIGHT CREATORS LABs is a team performance evaluation portal for CELIDER 08 Santiago. It's a **static frontend** (vanilla HTML/CSS/JS, no build step, no bundler) backed by **Supabase** for auth, database, and storage. Deployed on **Vercel** at `https://eight-coms.vercel.app`.

## Running Locally

```bash
npx serve -p 3000 --no-clipboard .
```

No `npm install` needed — all dependencies load via CDN (`@supabase/supabase-js`, `lucide` icons). Open `http://localhost:3000/index.html`.

Vercel config is in `serve.json` (security headers only).

## Architecture

### Auth & Data Flow

- `config.js` — Supabase URL + anon key, `escHtml()` helper, Lucide icon utilities
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
| `dashboard.html` | — | `dashboard.js` — lightweight dashboard view |

### Legacy Layer

`app.js` is the **old Google Sheets-based** version (reads from a public Sheet via `gviz/tq`). It's still present but the active pages use the Supabase stack (`auth.js` + `api.js`). Do not modify `app.js` for new features.

### Styling

- `shared.css` — design system: CSS variables, glass morphism, dark/light theme, grid utilities, animations
- `user.css`, `secretario.css`, `admin.css`, `styles.css` — page-specific styles

### Supabase Tables

`profiles`, `roles`, `periodos_evaluacion`, `criterios`, `rubrica`, `evaluaciones` (per-user scores), `evaluaciones_distrito`, `calendario`, `config`, `periodo_participantes`, `distritos`, `trabajos_entregados`. Storage bucket: `avatars`.

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
