# maq3ad

Pick a seat in a 3D stadium, see the view from it, and book it.

The current version is a front-end demo: the venue, teams, prices and
availability are placeholder data, bookings are stored in the visitor's own
browser, and checkout takes no real payment.

## Features

- 3D stadium with ~50,000 individually selectable seats on three tiers
- Three levels: whole stadium, block, and the view from a single seat (360° look-around)
- View score (0–100) per seat, four price categories with a filter
- Basket (up to 6 seats), demo checkout and demo tickets
- Arabic (RTL) and English, mouse and touch, responsive layout
- Mini-map and buttons give a keyboard path to every block and to free seats

## Stack

Vite, TypeScript and Three.js. No UI framework.

## Getting started

```bash
pnpm install
pnpm dev
```

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Local dev server |
| `pnpm build` | Type-check and build to `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript only |
| `pnpm test` | Unit tests (Vitest) |

## Project layout

```
src/
  config/venue.ts        venue, fixture, tiers, prices (edit this to change the stadium)
  domain/                seat layout, availability, view score, pricing (pure, tested)
  data/                  BookingRepository interface + browser-storage implementation
  scene/                 Three.js scene, camera modes, picking, ambient match
  ui/                    DOM panels, basket, checkout
  i18n/                  Arabic and English strings
tests/
```

## Configuration

There are no environment variables and no secrets. Everything about the venue
lives in `src/config/venue.ts`.

## Going to production

This demo is not a ticketing system yet. Before selling real tickets it needs:

- a server-side `BookingRepository` that holds seats atomically, so two people
  cannot book the same seat
- accounts, a real payment provider (confirmed by the provider's webhook, never
  by the browser), and tickets that can be verified at the gate
- an agreement with the event organiser, and licences for any real venue,
  club names or logos
- privacy policy and terms pages
