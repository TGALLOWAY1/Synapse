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

| Token | Value | Use |
|---|---|---|
| `brand-*` | indigo scale | The brand hue — owned deliberately. Interactive accents, active states, links, focus. Use `brand-600` on light, `brand-400`/`brand-500` on dark. |
| `accent-*` | violet scale | Companion hue; gradient endpoint in the tour's display type. Sparingly — expressive surfaces only. |
| `muted` | neutral-500 | Secondary/meta text **on light panes** (4.6:1 on white). Never use `neutral-400` on light surfaces — it fails WCAG AA. |
| `muted-dark` | neutral-400 | Secondary/meta text **on dark chrome** (AA on `neutral-900`). |

New code references tokens (`text-brand-600`, `text-muted`), not raw hues.
Raw `indigo-*` in older code is legacy to be migrated opportunistically.

## Type

System sans stack (Tailwind default). Hierarchy comes from weight and size,
not decoration. The tour's gradient display type
(`from-indigo-400 to-violet-400`) is the **one** sanctioned gradient-text
moment in the product — do not add more.

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
