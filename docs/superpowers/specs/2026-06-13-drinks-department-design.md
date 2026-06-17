# Drinks Department — Design

**Date:** 2026-06-13
**Status:** Approved
**Scope:** Add a drinks ("PIĆE") department to LiberoMenu alongside the existing food ("HRANA") menu, with a landing screen that picks one, a header toggle that switches between them, and a single shared cart that groups items by department.

---

## 1. Goals

- A customer scanning the QR lands on a full-screen picker: PIĆE or HRANA.
- One tap puts them inside the chosen menu. A persistent header toggle lets them flip between menus freely.
- Food and drinks data come from two independent Google Sheets (via two Apps Script endpoints).
- Drinks use a slimmer schema — no images, no ingredients, no allergens.
- The cart is shared. Adding a Coke from PIĆE and a burger from HRANA produces a single order. The cart sheet and the waiter summary visually group items by department so the bar can pull drinks while the kitchen pulls food.
- Single-variant drinks add to the cart with one inline tap. Multi-variant drinks (e.g. Coke 0.33L / 0.5L) open a bottom sheet.
- No regressions to the food experience — food rendering, dish detail sheet, search, sort, category filter, lazy images, offline detection, and caching all continue to work as today.

## 2. Non-goals

- No URL routing or deep links per department (the QR-to-table flow is a fresh session every visit).
- No persistence of the "last chosen department" across sessions. Each QR scan starts at the landing screen.
- No images, descriptions, ingredients, or allergens for drinks. Slim schema only.
- No payment processing (silent-order model unchanged).
- No client-side EN translation switch (out of scope for this iteration even though the drinks sheet will carry `NameEN`/`CategoryEN`).
- No cross-department search ("Coke" in HRANA shows nothing). Search remains scoped to the active department.

## 3. View states & navigation

`app.js` owns a single state variable:

```js
let currentDepartment = null; // null | 'food' | 'drinks'
```

- `null` → landing screen visible; header, filters bar, menu container hidden.
- `'food'` → landing hidden; existing chrome shown; menu container shows food dishes only.
- `'drinks'` → landing hidden; existing chrome shown; menu container shows drinks only.

A dedicated function `setDepartment(dep)` is the only writer. It:

1. Updates `currentDepartment`.
2. Toggles a CSS class on `<body>` (`.view-landing`, `.view-food`, `.view-drinks`) — CSS uses these to show/hide the landing element and the menu chrome.
3. Re-runs the same render path (`buildCategoryFilter` + `renderMenu`) against the active department's dishes.
4. Resets `currentQuery`, `currentSort`, `currentCategory` to their defaults on department switch — the user expects a clean slate when changing menus.
5. Scrolls to top.

Initial load: `setDepartment(null)` — landing screen is the entry point, every visit.

No URL hash routing. The browser back button does not switch departments — pressing back on a department view exits the site (consistent with current behavior).

## 4. Data layer

### 4.1 Config

`CONFIG` in `app.js` gains a second sheet URL:

```js
const CONFIG = {
  SHEET_CSV_URL: "...existing food endpoint...",
  SHEET_CSV_URL_DRINKS: "...new drinks Apps Script endpoint...",
  CACHE_KEY_FOOD: "libero_menu_data",          // renamed from CACHE_KEY for clarity
  CACHE_TS_FOOD: "libero_menu_ts",             // renamed from CACHE_TIMESTAMP_KEY
  CACHE_KEY_DRINKS: "libero_drinks_data",
  CACHE_TS_DRINKS: "libero_drinks_ts",
  CACHE_TTL: 5 * 60 * 1000,
  // ...existing fields...
};
```

The existing food cache keys are preserved by mapping `CACHE_KEY_FOOD` to the current string values, so existing customers don't lose their cached food data on rollout.

### 4.2 Fetch

`fetchMenuData()` becomes department-aware. The cleanest factoring:

```js
async function fetchMenuData() {
  const [food, drinks] = await Promise.all([
    fetchDepartment('food'),
    fetchDepartment('drinks'),
  ]);
  return { food, drinks };
}
```

`fetchDepartment(dep)` is a generalization of the current `fetchFresh` + cache logic, parameterized on the URL and cache keys it should use, and on which parser to apply to the CSV (`parseFoodCSV` vs `parseDrinksCSV`). Stale-while-revalidate semantics are preserved per-department: each department independently renders cached, then revalidates in background.

State splits to:

```js
let foodDishes = [];
let drinkDishes = [];
```

`allDishes` is removed — every read site asks for the active department's array via a helper `getActiveDishes()`. This keeps render code unchanged in shape; it just sources from one of two arrays.

### 4.3 Drinks schema

The drinks Google Sheet uses these columns (slim schema, per Q1):

| Column | Required | Notes |
|---|---|---|
| Category | yes | e.g. "Sokovi", "Pivo", "Topli napici" |
| CategoryEN | no | reserved for future EN switch |
| SortOrder | yes | integer, controls in-category order |
| Name | yes | e.g. "Coca-Cola", "Jelen pivo" |
| NameEN | no | reserved |
| Variants | no | `"0.33L 200\|0.5L 250"` — same `\|`-separated format as food |
| Price | conditional | required when Variants is empty; ignored when Variants is set |
| Tags | no | comma-separated, matched against `TAGS_CONFIG` (same as food) |
| Active | yes | `TRUE`/`FALSE` |

Drinks deliberately drop: `Description`, `Ingredients`, `Allergens`, `ImageUrl`. The parser does not look for them.

### 4.4 Parsing

`parseCSV(csvText)` is the existing food parser, renamed `parseFoodCSV`. A new `parseDrinksCSV` is a near-copy that calls a new `transformDrinkRow` instead of `transformRow`:

```js
function transformDrinkRow(row) {
  return {
    department: 'drinks',
    category: String(row.Category || '').trim(),
    sortOrder: Number(row.SortOrder) || 0,
    name: String(row.Name || '').trim(),
    description: '',
    ingredients: '',
    allergens: '',
    imageUrl: '',
    price: Number(row.Price) || 0,
    variants: parseVariants(row.Variants),
    tags: parseTags(row.Tags),
  };
}
```

`transformRow` is updated to also tag food rows with `department: 'food'`. This single field is what the cart, the waiter summary, and any future cross-department code keys off.

The empty-string defaults for description/ingredients/allergens/imageUrl let existing rendering code keep its `if (dish.description)` guards intact — drinks just naturally have no description block.

`parseVariants` is unchanged — drinks variants like `"0.33L 200|0.5L 250"` already match the existing `"Label Price"` regex.

The Pica-specific `parsePicaPrice` branch in `transformRow` is irrelevant for drinks (the "Pice" category is food).

## 5. Landing screen (PIĆE / HRANA picker)

### 5.1 Markup (added to `index.html`)

Inserted before the `<header>` so it can cover the viewport without z-index gymnastics:

```html
<section id="landing" class="landing" aria-label="Izaberite kategoriju">
  <button class="landing__panel landing__panel--food" data-dep="food" type="button">
    <svg class="landing__icon" ...><!-- burger / utensils glyph --></svg>
    <span class="landing__label">HRANA</span>
  </button>
  <button class="landing__panel landing__panel--drinks" data-dep="drinks" type="button">
    <svg class="landing__icon" ...><!-- glass / bottle glyph --></svg>
    <span class="landing__label">PIĆE</span>
  </button>
</section>
```

The Libero logo appears centered in the seam between the two panels (a small inline SVG positioned absolutely over the section center), so the brand is still present without adding chrome.

### 5.2 Behavior

`initLanding()` (new, called from `init()` before any fetch) binds click handlers on the two panels — each calls `setDepartment(panel.dataset.dep)`.

### 5.3 Visibility

CSS rules (in `style.css`):

```css
.view-landing .header,
.view-landing .search-container,
.view-landing .filters-bar,
.view-landing .menu-container,
.view-landing .cart-fab { display: none; }

body:not(.view-landing) #landing { display: none; }
```

The cart FAB is hidden on landing because there is nothing to add yet (cart is always empty on a fresh session).

### 5.4 Visual treatment

- Full viewport, two stacked panels (`grid-template-rows: 1fr 1fr` on mobile portrait, `grid-template-columns: 1fr 1fr` on landscape / desktop).
- HRANA panel: dark `#0E0E0E` background, large golden Syne-uppercase label, subtle noise overlay.
- PIĆE panel: inverted — golden `#FFCF40` background, dark text. The contrast makes the pick obvious.
- Panel tap: brief scale-down + golden glow flash, then transition to the menu view.
- Both panels are full-tappable buttons (entire panel area) — no small CTAs.

## 6. Header toggle

A new toggle control replaces nothing — it slots into the existing `.header__actions` row, on the left of the action icons, or as a row directly under the brand depending on what fits cleanly with the current layout.

### 6.1 Markup (added to `<header>` in `index.html`)

```html
<div class="dept-toggle" role="tablist" aria-label="Meni">
  <button class="dept-toggle__btn" data-dep="food" role="tab" type="button">HRANA</button>
  <button class="dept-toggle__btn" data-dep="drinks" role="tab" type="button">PIĆE</button>
</div>
```

### 6.2 Behavior

`initDeptToggle()` (new) binds clicks → `setDepartment(btn.dataset.dep)`. `setDepartment` is also responsible for updating the `aria-selected` + visual active state of the toggle buttons.

### 6.3 Visual treatment

Pill-shaped golden border, two segments. Active segment is filled golden with dark text; inactive segment is transparent with golden text. Tap target ≥44px. Hidden on landing via the `.view-landing` rule.

## 7. Rendering drinks

### 7.1 Card shape

Drink cards live in the same `menu-container` and use the same category-section structure (`createCategorySection` already works for any dishes array). What differs is the card markup itself.

New function `createDrinkCard(dish)` is called from `createCategorySection` when `dish.department === 'drinks'`. Otherwise the existing food-card builder runs. The selection happens once per dish, at render time.

Drink card structure (HTML, kept compact — no image):

```html
<article class="drink-card" data-key="...">
  <div class="drink-card__body">
    <h3 class="drink-card__name">Coca-Cola</h3>
    <div class="drink-card__meta">
      <span class="drink-card__price">200 RSD</span>
      <!-- optional tag badges, same rendering as food cards -->
    </div>
  </div>
  <button class="drink-card__add" aria-label="Dodaj Coca-Cola">+</button>
</article>
```

For multi-variant drinks the price line shows the minimum price prefixed (`od 200 RSD`) and the `+` button still appears but routes to the bottom sheet instead of adding directly (see §7.3).

### 7.2 No images

Drink cards never reference `imageUrl`, so no lazy-load setup, no placeholder fallback, no `IntersectionObserver` work for them. The existing `initLazyLoading` only walks `.dish-card__image[data-src]`, so drink cards naturally pass through it untouched.

### 7.3 Add-to-cart behavior (per Q4 → C)

`createDrinkCard` wires the `+` button:

- **Single-variant or no variants** (`dish.variants.length <= 1`): tap `+` → `addToCart(dish, dish.variants.length === 1 ? 0 : null)` → brief on-button feedback (the `+` glyph swaps to `✓` for ~600ms, button scales 0.9 → 1.0). Cart FAB badge increments automatically via `updateCartBadge()`. No sheet, no floating animation.
- **Multi-variant** (`dish.variants.length >= 2`): tap `+` → `openDishSheet(dish)`. The dish sheet already handles variant selection. The fact that it shows no image / no description block is harmless given the empty strings in `transformDrinkRow` — the existing `if (dish.description)` guards just skip those sections.

### 7.4 Drink card taps

Unlike food cards, the drink card body itself is **not** tappable — only the `+` button. This is the whole point of inline-add. `makeDishCardTappable` is not called for drink cards.

## 8. Cart & waiter summary

### 8.1 Cart items get a `department` field

`addToCart(dish, variantIndex)` is amended to capture `department` from the dish:

```js
cart.push({
  key,
  department: dish.department, // 'food' | 'drinks'
  name: dish.name,
  variant: variant ? variant.label : null,
  price: variant ? variant.price : dish.price,
  qty: 1,
  imageUrl: dish.imageUrl, // empty for drinks
});
```

The `key` formula (`dish.name + (variant ? '|' + variant.label : '')`) is technically collision-prone if a drink and a dish ever share a name, but in practice menus don't have that — and we can prefix with department if it ever becomes an issue. (Listed as a known minor risk, not blocking.)

### 8.2 Cart migration

Existing carts in localStorage (from previous sessions) lack `department`. On `loadCart()`, any item without a `department` field is back-filled to `'food'` (safe assumption — there were no drinks before).

### 8.3 Cart sheet rendering

`openCartSheet` is refactored to split the items into two groups and render them as separate sections:

```
┌─────────────────────────────┐
│ Vaša narudžbina             │
│                             │
│ HRANA                       │
│ ┌─ Burger        1  650 RSD│
│ └─ Pizza M       1 1500 RSD│
│                             │
│ PIĆE                        │
│ ┌─ Coca-Cola 0.5 2  500 RSD│
│ └─ Jelen 0.5L    1  280 RSD│
│                             │
│ Ukupno:           2930 RSD │
│ [ Pokaži konobaru ]         │
│ [ Obriši sve ]              │
└─────────────────────────────┘
```

Implementation: partition `cart` into `cart.filter(i => i.department === 'food')` and `cart.filter(i => i.department === 'drinks')`. Each non-empty group renders its own header and item list. The quantity buttons, total, and footer actions stay exactly as they are — the partition is render-time only, the underlying `cart` array is unchanged.

If one of the two groups is empty, only the populated section's header is shown (no empty "HRANA" header above an empty list). If both are empty, the existing empty-cart state shows.

### 8.4 Waiter summary

Same partition logic. `openWaiterSummary` renders:

```
HRANA
1x Burger                 650 RSD
1x Pizza — M             1500 RSD

PIĆE
2x Coca-Cola — 0.5L       500 RSD
1x Jelen pivo — 0.5L      280 RSD

Ukupno                  2930 RSD
```

Department headers are styled Syne-uppercase, golden, with a thin underline — consistent with the existing menu category headers.

### 8.5 Cart FAB

Unchanged — the badge shows total combined count (`getCartCount` already sums all items). Hidden on landing only.

## 9. Files touched

- `index.html` — add landing markup, add dept toggle markup in header.
- `style.css` — landing screen styles, dept toggle styles, drink card styles, cart/waiter group headers, `.view-landing` visibility rules.
- `app.js` — `CONFIG` additions, `currentDepartment` state, `setDepartment`, `initLanding`, `initDeptToggle`, `fetchDepartment` refactor, `parseDrinksCSV`, `transformDrinkRow`, `transformRow` gains `department: 'food'`, `createDrinkCard`, branching in `createCategorySection`, `getActiveDishes` helper, search/sort/filter sourcing changed to active department.
- `cart.js` — `addToCart` captures `department`, `loadCart` back-fills missing `department`, `openCartSheet` partitions and renders two sections, `openWaiterSummary` same.
- `tags-config.js` — unchanged. Drink tags can be added to the same config as food tags.
- No new files. No build step. No new dependencies.

## 10. Out of scope (YAGNI)

These were considered and intentionally dropped:

- **EN language switch** — `CategoryEN` / `NameEN` columns in the sheet are reserved (so the client can populate them now without rework later), but no UI toggle yet.
- **Search across departments** — search stays scoped to the active department to keep mental model simple.
- **Per-department offline state** — single offline badge serves both. If one CSV fetch fails and the other succeeds, the failed one renders from cache and the badge shows.
- **Department-aware cache TTL** — same 5-minute TTL for both.
- **URL deep-links** — out per §3.
- **Animated department transitions** — instant view swap, no slide animation. Can be added later cheaply if it feels jarring; not blocking.
- **"Recommended for you" cross-sells** ("you have a burger — add a drink?") — no.

## 11. Risks & open issues

- **Sheet URL setup** — the drinks Apps Script endpoint must be deployed and the URL added to `CONFIG.SHEET_CSV_URL_DRINKS` before this feature can render anything for drinks. Until then, the drinks fetch returns `[]` and the PIĆE view shows the empty state. Acceptable for staged rollout.
- **Existing cached carts** — the `loadCart` back-fill handles the migration in one line. No data loss.
- **Cart key collisions** — currently keyed on `name + variant`. A drink and a dish sharing a name (e.g. "Espresso" both as dessert and coffee) would merge in the cart. Unlikely in practice; if it happens, prefix the key with `department`. Not pre-emptively fixed.
- **Landing screen on tiny viewports** — two stacked panels each get 50vh; the labels need to be readable on a 320×568 iPhone SE. Picker buttons use `clamp()` for label size to handle this.
- **Bottom sheet on drinks with variants** — the sheet was designed for food (image, description, allergens). For a drink it'll show an empty top area where the image was. The empty-string defaults make this functionally harmless but visually a bit sparse. Acceptable for v1; a `dish-sheet--drink` variant class can hide the image wrapper if it looks bad.

## 12. Success criteria

- Customer scans the QR → sees the PIĆE / HRANA picker within ~200ms (no menu data needed to render landing).
- Tapping HRANA → existing food menu, indistinguishable from current production behavior.
- Tapping PIĆE → drinks menu loads from the second sheet, drink cards render without images, single-tap add works.
- Header toggle flips between menus instantly (data is already in memory after first fetch of each).
- Cart shows mixed items grouped under HRANA / PIĆE headers.
- Waiter summary same grouping.
- No regression to food-side search / sort / category filter / dish detail sheet / offline badge / cache behavior.
- Lighthouse scores not measurably worse than current main.
