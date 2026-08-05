# DESIGN.md — Synapse visual system

> Incumbent design authority, documented (not redesigned) 2026-08-04 alongside
> the design-token layer in `tailwind.config.js`. Refinements preserve this
> world; replacing it is a deliberate redesign decision, not drift.

## Theme story: "paper documents in a dark studio"

Synapse is a **dark-chrome workspace that produces light documents**. This is
the committed motif, not an accident:

- **Dark studio:** app shell, login, tour, journey rail, and boot surfaces
  live on `neutral-900` ground with `neutral-100` text.
- **Paper artifacts:** the things Synapse *produces* — PRD, screens, data
  model, plans — render as white/`neutral-50` panes, like printed pages on a
  workbench. Light panes are always **content**, never chrome.
- Every route must be explainable by this sentence. The HomePage prompt
  screen is the current known exception (fully light) and should migrate
  toward dark-studio framing when next touched.

## Tokens (`tailwind.config.js`)

The brand hue is **"electric iris"** — a bespoke OKLCH-derived scale (hue
285), deliberately not stock Tailwind indigo. The config **overrides the
`indigo` alias with the same scale**, so every legacy `indigo-*` call site
renders the owned hue; `brand-*` is the preferred spelling in new code.

| Token | Value | Use |
|---|---|---|
| `brand-*` / `indigo-*` | iris scale — 600 `#653bec`, 500 `#7962f8`, 400 `#968cff`, 100 `#e8e8ff`, 950 `#211552` | Interactive accents, active states, links, focus. `brand-600` on light (6.2:1 on white), `brand-400` on dark (6.4:1 on neutral-900). |
| `accent-*` | violet scale | Companion hue; gradient endpoint in the tour's display type. Sparingly — expressive surfaces only. |
| `muted` | neutral-500 | Secondary/meta text **on light panes** (4.6:1 on white). Never use `neutral-400` on light surfaces — it fails WCAG AA. |
| `muted-dark` | neutral-400 | Secondary/meta text **on dark chrome** (AA on `neutral-900`). |

Key contrast pairs are pre-validated: 600/white 6.2, white/600 6.2, 700/100
6.7, 400/neutral-900 6.4, 300/neutral-900 9.4. Keep any new pairing at ≥4.5.

## Type

Body/UI: system sans stack (Tailwind default) — Operate surfaces stay on it
for scanability. Display voice: **Space Grotesk Variable** (self-hosted via
`@fontsource-variable/space-grotesk`, class `font-display`), reserved for
brand moments only — the wordmark, the HomePage hero, the boot splash, the
login title, and tour headings. Do not spread it onto workspace content.
The tour's gradient display type (`from-indigo-400 to-violet-400`) is the
**one** sanctioned gradient-text moment in the product — do not add more.

## Motif: the blueprint grid

`bg-blueprint` (light panes) / `bg-blueprint-dark` (studio ground) paint a
subtle dot grid — the "product blueprint" promise made visible. Entry
surfaces only (home, login, splash); never behind dense workspace content.

## Interaction states

- **Focus:** structural — `src/index.css` gives every interactive element a
  2px `brand-500` outline at zero specificity. Components may override with
  `focus-visible:ring-*` + `focus-visible:outline-none`; they may never
  remove focus visibility.
- **Waits:** honest progress is the brand (see PRODUCT.md). Real
  percentages, per-section attribution, explicit `waiting` states. Never a
  fake shimmer where truth is available.
- **Status chips:** every status/priority chip must carry a plain-language
  definition (tooltip or adjacent text). System freshness vocabulary stays
  separate from user review/readiness statuses.

## Idioms

- Cards on `neutral-200` borders, `rounded-lg`+; tight in-group spacing,
  generous between groups.
- One finality signal per artifact header (a noun-shaped chip, not a
  button-shaped verb).
- Mobile: 44px touch targets; `MobileSelectionToolbar`'s bottom-sheet pattern
  is the reference for thumb-zone actions. Chrome (banners, tab rows) yields
  to content — banners collapse to one line.
- Icon-only buttons always carry `aria-label` (not just `title`).

## Anti-patterns (do not reintroduce)

- `text-neutral-400` on white/light panes (contrast failure).
- Gray secondary text on colored surfaces — tint from the surface hue instead.
- A second gradient-text moment outside the tour headings.
- Duplicate state signals (badge + button for the same fact).
- Vendor/configuration warnings on showcase (demo/gallery) surfaces.
