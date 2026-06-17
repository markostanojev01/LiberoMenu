# Drinks Department Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PIĆE (drinks) department alongside the existing HRANA (food) menu — including a full-screen landing picker, a persistent header toggle, drinks loaded from a second Google Sheet, and a shared cart that visually groups items by department.

**Architecture:** Single-page app, no router. A `currentDepartment` state variable (`null | 'food' | 'drinks'`) drives view mode via body classes. Food and drinks come from two independent Google Sheets fetched in parallel; both caches use stale-while-revalidate. Drinks use a slimmer schema (no images/ingredients/allergens). The cart is a single array; each item carries a `department` field used for render-time grouping in the cart sheet and waiter summary.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step. PapaParse via CDN. localStorage for cache + cart state. Static hosting (GitHub Pages).

**Spec:** [`docs/superpowers/specs/2026-06-13-drinks-department-design.md`](../specs/2026-06-13-drinks-department-design.md)

---

## Conventions for this plan

This codebase has no automated test framework. "Verification" means:

1. Run `npx serve .` from the project root.
2. Open `http://localhost:3000` (or whatever port `serve` reports) in a Chrome / Safari mobile-viewport DevTools window (375×667 baseline).
3. Step through the verification checklist for the task.
4. Open DevTools Console — there must be **zero errors and zero new warnings**.
5. Report the result to the user.

**Commits:** Do **NOT** run `git add`, `git commit`, or `git push` at any point. The user commits manually after each task. After completing a task, stop and wait for the user's go-ahead before starting the next.

**Style:** Match existing patterns in the file you're editing. Use the same indentation, the same JSDoc style (or none), the same naming conventions. Do not add comments unless they explain a non-obvious why.

---

## File map

| File | Role in this feature |
|---|---|
| `index.html` | Add `<section id="landing">` markup before `<header>`. Add `.dept-toggle` markup inside `<header>`. |
| `style.css` | Add styles for `.landing`, `.dept-toggle`, `.drink-card`, `.cart-group` headers, `.view-landing` visibility rules. |
| `app.js` | Add second sheet URL to `CONFIG`. Split `allDishes` into `foodDishes` / `drinkDishes`. Add `currentDepartment`, `setDepartment`, `getActiveDishes`. Refactor `fetchMenuData` → `fetchDepartment(dep)`. Add `parseDrinksCSV`, `transformDrinkRow`. Tag `transformRow` output with `department: 'food'`. Add `createDrinkCard` and branch in `createCategorySection`. Add `initLanding` and `initDeptToggle`. |
| `cart.js` | `addToCart` captures `department`. `loadCart` back-fills missing `department` as `'food'`. `openCartSheet` and `openWaiterSummary` partition by department and render grouped sections. |
| `tags-config.js` | No changes. |

---

## Task 1: Data layer — split fetch + parse by department

**Files:**
- Modify: `app.js` — `CONFIG`, state vars, `init`, `fetchMenuData`, `fetchFresh`, cache helpers, `parseCSV`, `transformRow`, all `allDishes` references

This task changes the internals without changing visible behavior. After this task, the food menu must render and behave identically to before. The drinks fetch returns `[]` (the second sheet URL is empty for now), so the drinks department has no data yet — but no UI shows drinks yet either.

- [ ] **Step 1.1: Extend `CONFIG`**

In `app.js`, replace the `CONFIG` object (lines 8-21) with:

```js
const CONFIG = {
  // Food sheet — existing endpoint
  SHEET_CSV_URL:
    "https://script.google.com/macros/s/AKfycbyjuDHlU4XfkdfIZXBqk7XTHHnVa4WhvoNlnGBt-oaFo97UXsknKqOjTW94No3IFfzP/exec",
  // Drinks sheet — set this once the second Apps Script is deployed
  SHEET_CSV_URL_DRINKS: "",
  CACHE_KEY_FOOD: "libero_menu_data",         // preserves existing cached data
  CACHE_TS_FOOD: "libero_menu_ts",
  CACHE_KEY_DRINKS: "libero_drinks_data",
  CACHE_TS_DRINKS: "libero_drinks_ts",
  CACHE_TTL: 5 * 60 * 1000,
  IMAGE_BASE_PATH: "assets/images/",
  PLACEHOLDER_IMAGE: "assets/images/placeholder.svg",
  CURRENCY: "RSD",
  PHONE_NUMBER: "+381693336303",
  MAPS_URL:
    "https://www.google.com/maps/place/Libero+Fast+Food/@43.902285,22.27958,20z/data=!4m6!3m5!1s0x475473005fce1ab9:0x5deb13694bb3f3f9!8m2!3d43.9021943!4d22.2796925!16s%2Fg%2F11xvbp01kn?entry=ttu&g_ep=EgoyMDI2MDIwNC4wIKXMDSoASAFQAw%3D%3D",
};
```

The old keys `CACHE_KEY` and `CACHE_TIMESTAMP_KEY` are removed — they're replaced by `CACHE_KEY_FOOD` / `CACHE_TS_FOOD` with the same string values so existing browsers don't lose their cached food data.

- [ ] **Step 1.2: Replace state block**

Replace the state block (lines 45-49):

```js
// ----------------------------------------------------------
// 2. STATE
// ----------------------------------------------------------
let foodDishes = [];
let drinkDishes = [];
let currentDepartment = "food"; // temporarily defaults to 'food' so existing UI keeps working; Task 3 changes this to null for the landing screen
let currentSort = "recommended";
let currentQuery = "";
let currentCategory = "all";
let lazyObserver = null;

function getActiveDishes() {
  if (currentDepartment === "drinks") return drinkDishes;
  if (currentDepartment === "food") return foodDishes;
  return [];
}
```

- [ ] **Step 1.3: Replace `init`**

Replace `init` (lines 56-70):

```js
async function init() {
  initHeaderLinks();
  initSearch();
  initSort();
  initCategoryFilter();
  initOfflineDetection();
  if (typeof initCart === "function") initCart();

  await fetchMenuData();
}
```

The render decision moves into `fetchMenuData` so it can fire per-department as each fetch resolves.

- [ ] **Step 1.4: Replace `fetchMenuData` and `fetchFresh`**

Replace `fetchMenuData` and `fetchFresh` (lines 86-154) with the per-department version:

```js
async function fetchMenuData() {
  // Fire both fetches in parallel. Each one independently updates its
  // department array and triggers a render if it's the active department.
  await Promise.all([
    fetchDepartment("food"),
    fetchDepartment("drinks"),
  ]);
}

async function fetchDepartment(dep) {
  const url = dep === "food" ? CONFIG.SHEET_CSV_URL : CONFIG.SHEET_CSV_URL_DRINKS;
  const cacheKey = dep === "food" ? CONFIG.CACHE_KEY_FOOD : CONFIG.CACHE_KEY_DRINKS;
  const tsKey = dep === "food" ? CONFIG.CACHE_TS_FOOD : CONFIG.CACHE_TS_DRINKS;
  const parser = dep === "food" ? parseFoodCSV : parseDrinksCSV;

  // No URL configured — render empty state only if this is the active dept
  if (!url) {
    if (dep === "food") {
      // Original behavior preserved for food: show setup message
      removeSkeletons();
      if (currentDepartment === "food") {
        renderEmptyState(
          "Meni jos nije povezan",
          "Dodajte Google Sheet CSV URL u app.js konfiguraciju.",
        );
      }
    }
    setDepartmentData(dep, []);
    return;
  }

  const cached = getCachedData(cacheKey, tsKey);

  if (cached) {
    setDepartmentData(dep, cached.data);
    if (currentDepartment === dep) {
      buildCategoryFilter(getActiveDishes());
      renderMenu(getActiveDishes());
    }
    if (isCacheValid(tsKey)) return;
    // Stale — refresh in background
    fetchFresh(dep, url, parser, cacheKey, tsKey, cached);
    return;
  }

  // No cache — wait for network
  await fetchFresh(dep, url, parser, cacheKey, tsKey, null);
}

async function fetchFresh(dep, url, parser, cacheKey, tsKey, cached) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    const dishes = parser(csvText);
    setCachedData(cacheKey, tsKey, dishes);

    if (cached) {
      const changed = JSON.stringify(dishes) !== JSON.stringify(cached.data);
      if (changed) {
        setDepartmentData(dep, dishes);
        if (currentDepartment === dep) {
          buildCategoryFilter(getActiveDishes());
          renderMenu(getActiveDishes());
        }
      }
    } else {
      setDepartmentData(dep, dishes);
      if (currentDepartment === dep) {
        buildCategoryFilter(getActiveDishes());
        renderMenuProgressive(getActiveDishes());
      }
    }
  } catch (error) {
    console.error(`Menu fetch failed (${dep}):`, error);
    if (cached) {
      renderOfflineBadge(true);
      return;
    }
    if (dep === "food" && currentDepartment === "food") {
      removeSkeletons();
      renderEmptyState(
        "Meni trenutno nije dostupan",
        "Proverite internet konekciju i pokusajte ponovo.",
      );
    }
  }
}

function setDepartmentData(dep, dishes) {
  if (dep === "food") foodDishes = dishes;
  else drinkDishes = dishes;
}
```

- [ ] **Step 1.5: Update cache helpers to take keys**

Replace `getCachedData`, `setCachedData`, `isCacheValid` (lines 156-180) with:

```js
function getCachedData(cacheKey, tsKey) {
  try {
    const raw = localStorage.getItem(cacheKey);
    const ts = localStorage.getItem(tsKey);
    if (!raw || !ts) return null;
    return { data: JSON.parse(raw), timestamp: parseInt(ts, 10) };
  } catch {
    return null;
  }
}

function setCachedData(cacheKey, tsKey, dishes) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(dishes));
    localStorage.setItem(tsKey, String(Date.now()));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

function isCacheValid(tsKey) {
  const ts = localStorage.getItem(tsKey);
  if (!ts) return false;
  return Date.now() - parseInt(ts, 10) < CONFIG.CACHE_TTL;
}
```

- [ ] **Step 1.6: Rename `parseCSV` → `parseFoodCSV` and tag rows**

Rename the function on line 185:

```js
function parseFoodCSV(csvString) {
  const result = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    console.warn("CSV parse warnings:", result.errors);
  }

  return result.data
    .filter((row) => {
      const active = row.Active;
      return active === true || active === "TRUE" || active === "true";
    })
    .map(transformRow);
}
```

Then update `transformRow` (line 205) to stamp each dish with its department:

```js
function transformRow(row) {
  const category = String(row.Category || "").trim();
  const isPica = category.toLowerCase() === "pice";

  let price = Number(row.Price) || 0;
  let variants = parseVariants(row.Variants);

  if (isPica) {
    const picaSizes = parsePicaPrice(row.Price);
    if (picaSizes.length > 0) {
      variants = picaSizes;
      price = picaSizes[0].price;
    }
  }

  return {
    department: "food",
    category,
    sortOrder: Number(row.SortOrder) || 0,
    name: String(row.Name || "").trim(),
    description: String(row.Description || "").trim(),
    ingredients: String(row.Ingredients || "").trim(),
    allergens: String(row.Allergens || "").trim(),
    price,
    variants,
    imageUrl: String(row.ImageUrl || "").trim(),
    tags: parseTags(row.Tags),
  };
}
```

- [ ] **Step 1.7: Add drinks parser and transformer**

Add immediately after `transformRow`:

```js
function parseDrinksCSV(csvString) {
  const result = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    console.warn("Drinks CSV parse warnings:", result.errors);
  }

  return result.data
    .filter((row) => {
      const active = row.Active;
      return active === true || active === "TRUE" || active === "true";
    })
    .map(transformDrinkRow);
}

function transformDrinkRow(row) {
  return {
    department: "drinks",
    category: String(row.Category || "").trim(),
    sortOrder: Number(row.SortOrder) || 0,
    name: String(row.Name || "").trim(),
    description: "",
    ingredients: "",
    allergens: "",
    imageUrl: "",
    price: Number(row.Price) || 0,
    variants: parseVariants(row.Variants),
    tags: parseTags(row.Tags),
  };
}
```

- [ ] **Step 1.8: Replace every `allDishes` reference with `getActiveDishes()`**

Search `app.js` for `allDishes`. Replace each read site with `getActiveDishes()`. There should be no remaining `allDishes` identifier in the file (the variable was removed in step 1.2).

Specifically:

- `renderMenu(allDishes)` → `renderMenu(getActiveDishes())`
- `if (allDishes.length > 0) renderMenu(allDishes)` → `if (getActiveDishes().length > 0) renderMenu(getActiveDishes())`
- `buildCategoryFilter(allDishes)` → `buildCategoryFilter(getActiveDishes())`
- The line in `init` that read `allDishes = dishes` is already gone (init was replaced in step 1.3).

Use this grep to confirm zero hits when done:

```
Grep pattern: \ballDishes\b   path: app.js
```

- [ ] **Step 1.9: Verify**

Run `npx serve .` and open the URL in mobile-viewport DevTools.

Checklist:
- Food menu renders identically to before (same categories, same cards, same images).
- Console: zero errors, zero warnings (except possibly the existing "Drinks CSV parse warnings" if any unexpected message appears — there shouldn't be since URL is empty).
- localStorage `libero_menu_data` and `libero_menu_ts` keys still exist (open Application tab in DevTools → Local Storage).
- Search, sort, category filter all work on food as before.
- Cart still adds/removes food items and shows the waiter summary.

If any check fails, debug before continuing.

- [ ] **Step 1.10: STOP**

Do not commit. Report the verification result to the user and wait for the go-ahead.

---

## Task 2: Cart — add `department` field with back-fill migration

**Files:**
- Modify: `cart.js` — `loadCart`, `addToCart`

This task is small and isolated. It makes the cart aware of which department each item came from, and migrates any cart that was already in localStorage from a previous session. No visible change yet — the grouped rendering arrives in Task 6.

- [ ] **Step 2.1: Back-fill `department` on load**

Replace `loadCart` (cart.js lines 11-18):

```js
function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw);
    // Back-fill: items saved before the drinks feature existed had no department
    let mutated = false;
    items.forEach((item) => {
      if (!item.department) {
        item.department = "food";
        mutated = true;
      }
    });
    if (mutated) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    }
    return items;
  } catch {
    return [];
  }
}
```

- [ ] **Step 2.2: Capture `department` in `addToCart`**

Replace `addToCart` (cart.js lines 28-47):

```js
function addToCart(dish, variantIndex) {
  const variant = variantIndex !== null ? dish.variants[variantIndex] : null;
  const key = dish.name + (variant ? `|${variant.label}` : "");
  const existing = cart.find((item) => item.key === key);

  if (existing) {
    existing.qty++;
  } else {
    cart.push({
      key,
      department: dish.department || "food", // defensive default — every dish should have a department after Task 1
      name: dish.name,
      variant: variant ? variant.label : null,
      price: variant ? variant.price : dish.price,
      qty: 1,
      imageUrl: dish.imageUrl,
    });
  }
  saveCart();
  updateCartBadge();
}
```

- [ ] **Step 2.3: Verify**

Run `npx serve .` and open in browser.

Checklist:
- If the cart already had items from a previous session: open DevTools → Application → Local Storage → `libero_cart`. Every item should now have `"department":"food"`.
- Add a fresh food item to the cart. Inspect the JSON — the new item has `"department":"food"`.
- Cart sheet still opens correctly and shows items the same as before.
- Waiter summary still works.
- Console: zero errors.

- [ ] **Step 2.4: STOP**

Report and wait for go-ahead.

---

## Task 3: View-state machine + landing screen

**Files:**
- Modify: `index.html` — add `<section id="landing">` before `<header>`
- Modify: `style.css` — landing styles + `.view-landing` visibility rules
- Modify: `app.js` — `setDepartment`, `initLanding`, default `currentDepartment` to `null`, call `initLanding` in `init`

After this task, every page load shows the picker. Tapping HRANA reveals the food menu (works). Tapping PIĆE reveals an empty drinks menu state (expected — drinks URL still empty).

- [ ] **Step 3.1: Add landing markup**

Edit `index.html`. Insert this block immediately after the `<body>` opening tag, before the `<!-- Offline Badge -->` comment:

```html
  <!-- Landing Screen -->
  <section id="landing" class="landing" aria-label="Izaberite kategoriju">
    <button class="landing__panel landing__panel--food" data-dep="food" type="button">
      <svg class="landing__icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 11h18a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8z"></path>
        <path d="M7 7c0-1.5 1-3 3-3"></path>
        <path d="M12 7c0-1.5 1-3 3-3"></path>
        <path d="M17 7c0-1.5 1-3 3-3"></path>
      </svg>
      <span class="landing__label">HRANA</span>
    </button>
    <button class="landing__panel landing__panel--drinks" data-dep="drinks" type="button">
      <svg class="landing__icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 2h8l-1 6a4 4 0 0 1-3 4h-0a4 4 0 0 1-3-4z"></path>
        <line x1="12" y1="12" x2="12" y2="20"></line>
        <line x1="8" y1="22" x2="16" y2="22"></line>
      </svg>
      <span class="landing__label">PIĆE</span>
    </button>
  </section>
```

- [ ] **Step 3.2: Add landing CSS**

Append to `style.css`:

```css
/* ----------------------------------------------------------
   N. LANDING SCREEN (PIĆE / HRANA picker)
   ---------------------------------------------------------- */
.landing {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  grid-template-rows: 1fr 1fr;
  background: var(--color-bg);
}

@media (orientation: landscape) and (min-width: 600px) {
  .landing {
    grid-template-rows: none;
    grid-template-columns: 1fr 1fr;
  }
}

.landing__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-lg);
  border: none;
  cursor: pointer;
  transition: transform 150ms var(--ease-out), filter 150ms var(--ease-out);
  padding: var(--space-xl);
}

.landing__panel:active {
  transform: scale(0.97);
  filter: brightness(1.05);
}

.landing__panel--food {
  background: var(--color-text);
  color: var(--color-primary);
}

.landing__panel--drinks {
  background: var(--color-primary);
  color: var(--color-text);
}

.landing__icon {
  width: clamp(48px, 14vw, 96px);
  height: clamp(48px, 14vw, 96px);
}

.landing__label {
  font-family: var(--font-display);
  font-size: clamp(32px, 9vw, 64px);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Visibility rules — show landing only when no department picked */
.view-landing .header,
.view-landing .search-container,
.view-landing .filters-bar,
.view-landing .menu-container,
.view-landing .footer,
.view-landing #cart-fab,
.view-landing #offline-badge { display: none !important; }

body:not(.view-landing) #landing { display: none; }
```

(The `N` in the comment is a placeholder section number — pick the next sequential number based on the existing section headers in `style.css`.)

- [ ] **Step 3.3: Add `setDepartment` and `initLanding` to `app.js`**

Add this block after `initHeaderLinks` (around line 81):

```js
function setDepartment(dep) {
  currentDepartment = dep;

  document.body.classList.toggle("view-landing", dep === null);
  document.body.classList.toggle("view-food", dep === "food");
  document.body.classList.toggle("view-drinks", dep === "drinks");

  // Reset filters/search/sort whenever the department changes
  currentQuery = "";
  currentCategory = "all";
  currentSort = "recommended";

  const searchContainer = document.getElementById("search-container");
  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");
  if (searchContainer) searchContainer.hidden = true;
  if (searchInput) searchInput.value = "";
  if (searchClear) searchClear.hidden = true;

  // Sync sort buttons to default
  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.classList.toggle("sort-btn--active", btn.dataset.sort === "recommended");
  });

  // Sync dept toggle (will be a no-op until Task 4 wires it up)
  document.querySelectorAll(".dept-toggle__btn").forEach((btn) => {
    btn.classList.toggle("dept-toggle__btn--active", btn.dataset.dep === dep);
    btn.setAttribute("aria-selected", btn.dataset.dep === dep ? "true" : "false");
  });

  if (dep !== null) {
    const dishes = getActiveDishes();
    buildCategoryFilter(dishes);
    if (dishes.length > 0) {
      renderMenu(dishes);
    } else {
      removeSkeletons();
      renderEmptyState(
        dep === "drinks" ? "Piće uskoro" : "Meni jos nije dostupan",
        dep === "drinks"
          ? "Lista pića će biti dostupna uskoro."
          : "Proverite internet konekciju i pokusajte ponovo.",
      );
    }
    window.scrollTo({ top: 0 });
  }
}

function initLanding() {
  document.querySelectorAll(".landing__panel").forEach((panel) => {
    panel.addEventListener("click", () => {
      setDepartment(panel.dataset.dep);
    });
  });
}
```

- [ ] **Step 3.4: Wire the landing into `init`**

Update the state line in `app.js`:

```js
let currentDepartment = null; // null = landing screen visible
```

(This replaces the temporary `"food"` default added in Task 1.2.)

And update `init`:

```js
async function init() {
  initHeaderLinks();
  initSearch();
  initSort();
  initCategoryFilter();
  initOfflineDetection();
  initLanding();
  if (typeof initCart === "function") initCart();

  document.body.classList.add("view-landing");

  await fetchMenuData();
}
```

- [ ] **Step 3.5: Verify**

Run `npx serve .` and reload the page.

Checklist:
- The landing screen covers the entire viewport. Two stacked panels (mobile) or two side-by-side panels (landscape).
- HRANA panel: dark background, golden text + icon.
- PIĆE panel: golden background, dark text + icon.
- Header, filters bar, cart FAB, footer, offline badge — all hidden on landing.
- Tap HRANA → landing disappears → food menu renders normally. Cart FAB visible. Header visible. Filters bar visible.
- Reload the page → landing appears again (no persistence across reload).
- Tap PIĆE → landing disappears → empty state "Piće uskoro" appears (because drinks URL is empty).
- Console: zero errors.
- Cart from previous session still intact, opens correctly when on food view.

- [ ] **Step 3.6: STOP**

Report and wait for go-ahead.

---

## Task 4: Header dept toggle

**Files:**
- Modify: `index.html` — add `.dept-toggle` markup in `<header>`
- Modify: `style.css` — pill toggle styles
- Modify: `app.js` — `initDeptToggle`, call from `init`

This task adds the persistent HRANA / PIĆE toggle in the header. After this task, the user can flip between the two department views without going back to the landing screen.

- [ ] **Step 4.1: Add toggle markup**

In `index.html`, inside the existing `<header class="header">`, between the closing `</div>` of `.header__brand` and the opening `<div class="header__actions">`, add:

```html
    <div class="dept-toggle" role="tablist" aria-label="Meni">
      <button class="dept-toggle__btn" data-dep="food" role="tab" aria-selected="true" type="button">HRANA</button>
      <button class="dept-toggle__btn" data-dep="drinks" role="tab" aria-selected="false" type="button">PIĆE</button>
    </div>
```

- [ ] **Step 4.2: Add toggle CSS**

Append to `style.css`:

```css
/* ----------------------------------------------------------
   N. DEPARTMENT TOGGLE
   ---------------------------------------------------------- */
.dept-toggle {
  display: inline-flex;
  border: 1.5px solid var(--color-primary);
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: transparent;
}

.dept-toggle__btn {
  padding: 6px 14px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-primary);
  background: transparent;
  min-height: 36px;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.dept-toggle__btn--active {
  background: var(--color-primary);
  color: var(--color-text);
}
```

If the header layout breaks (header becomes too wide on small screens), adjust the existing `.header` CSS gap / wrap behavior — do not change the toggle structure.

- [ ] **Step 4.3: Wire `initDeptToggle`**

Add to `app.js`, after `initLanding`:

```js
function initDeptToggle() {
  document.querySelectorAll(".dept-toggle__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dep = btn.dataset.dep;
      if (dep === currentDepartment) return;
      setDepartment(dep);
    });
  });
}
```

And call it from `init`:

```js
async function init() {
  initHeaderLinks();
  initSearch();
  initSort();
  initCategoryFilter();
  initOfflineDetection();
  initLanding();
  initDeptToggle();
  if (typeof initCart === "function") initCart();

  document.body.classList.add("view-landing");

  await fetchMenuData();
}
```

- [ ] **Step 4.4: Verify**

Run `npx serve .` and reload.

Checklist:
- Landing screen still shows on load.
- Pick HRANA → header shows the dept toggle with HRANA active (filled golden).
- Tap PIĆE in the toggle → switches to drinks view. PIĆE becomes active in the toggle.
- Tap HRANA in the toggle → back to food. Search input is cleared, sort resets to "Sve", category filter resets.
- Header looks clean — toggle doesn't push the phone/maps/search icons off-screen on a 375px viewport.
- Console: zero errors.

- [ ] **Step 4.5: STOP**

Report and wait for go-ahead.

---

## Task 5: Drink card rendering

**Files:**
- Modify: `app.js` — `createDrinkCard`, branch in `createCategorySection`
- Modify: `style.css` — `.drink-card` styles

After this task, the PIĆE view shows real drink cards (once a drinks sheet URL is configured) or the empty state otherwise. Single-variant drinks add to the cart with one inline tap; multi-variant drinks open the existing dish detail sheet.

- [ ] **Step 5.1: Branch in `createCategorySection`**

Replace `createCategorySection` (app.js around line 379):

```js
function createCategorySection(category, dishes) {
  const section = document.createElement("section");
  section.className = "category-section";
  section.setAttribute("data-category", category);

  const header = document.createElement("h2");
  header.className = "category-header";
  header.textContent = category;

  section.appendChild(header);

  dishes.forEach((dish) => {
    let card;
    if (dish.department === "drinks") {
      card = createDrinkCard(dish);
    } else {
      card = createDishCard(dish);
      if (typeof makeDishCardTappable === "function") {
        makeDishCardTappable(card, dish);
      }
    }
    section.appendChild(card);
  });

  return section;
}
```

- [ ] **Step 5.2: Add `createDrinkCard`**

Add immediately after `createDishCard` (app.js around line 498):

```js
function createDrinkCard(dish) {
  const card = document.createElement("article");
  card.className = "drink-card";

  const body = document.createElement("div");
  body.className = "drink-card__body";

  const name = document.createElement("h3");
  name.className = "drink-card__name";
  name.textContent = dish.name;
  body.appendChild(name);

  const meta = document.createElement("div");
  meta.className = "drink-card__meta";

  const priceEl = document.createElement("span");
  priceEl.className = "drink-card__price";
  if (dish.variants.length > 0) {
    const minPrice = Math.min(...dish.variants.map((v) => v.price));
    priceEl.textContent = `od ${formatPrice(minPrice)}`;
  } else {
    priceEl.textContent = formatPrice(dish.price);
  }
  meta.appendChild(priceEl);

  if (dish.tags.length > 0) {
    dish.tags.forEach((tag) => meta.appendChild(createTagBadge(tag)));
  }

  body.appendChild(meta);
  card.appendChild(body);

  const addBtn = document.createElement("button");
  addBtn.className = "drink-card__add";
  addBtn.type = "button";
  addBtn.setAttribute("aria-label", `Dodaj ${dish.name}`);
  addBtn.textContent = "+";
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dish.variants.length >= 2) {
      // Multi-variant — open the existing dish sheet to pick size
      if (typeof openDishSheet === "function") openDishSheet(dish);
      return;
    }
    addToCart(dish, dish.variants.length === 1 ? 0 : null);
    flashAdded(addBtn);
  });
  card.appendChild(addBtn);

  return card;
}

function flashAdded(btn) {
  const original = btn.textContent;
  btn.textContent = "✓";
  btn.classList.add("drink-card__add--added");
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("drink-card__add--added");
  }, 600);
}
```

- [ ] **Step 5.3: Add drink card CSS**

Append to `style.css`:

```css
/* ----------------------------------------------------------
   N. DRINK CARD
   ---------------------------------------------------------- */
.drink-card {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: var(--space-md);
  margin-bottom: var(--space-sm);
  box-shadow: var(--shadow-sm);
}

.drink-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.drink-card__name {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.2;
}

.drink-card__meta {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.drink-card__price {
  font-weight: 700;
  font-size: 15px;
  color: var(--color-primary-dark);
}

.drink-card__add {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-text);
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 150ms var(--ease-out), background 150ms var(--ease-out);
}

.drink-card__add:active {
  transform: scale(0.92);
}

.drink-card__add--added {
  background: #10B981; /* success green */
  color: #fff;
}
```

- [ ] **Step 5.4: Verify (food side)**

Run `npx serve .` and reload.

Checklist:
- Landing → HRANA → food menu still renders identically. Dish cards unchanged.
- Search, sort, category filter still work on food.
- Console: zero errors.

- [ ] **Step 5.5: Verify (drinks side — requires URL)**

Add a real value to `CONFIG.SHEET_CSV_URL_DRINKS` in `app.js` if available. If not, skip this step and report to the user that drink-card rendering needs a test sheet URL to verify end-to-end. **Do not commit a placeholder URL.**

If a URL is available:
- Landing → PIĆE → drink cards render. Each card shows name on the left, price (or "od X RSD" for variants) and any tag badges below, and a circular `+` button on the right.
- Tap `+` on a single-price drink → cart badge increments, button flashes a green `✓` for ~600ms.
- Tap `+` on a drink with multiple variants → the existing dish sheet opens with the variant pickers; tapping a variant adds it and shows "✓ Dodato" feedback (same as food variants).
- Tap a drink card body (not the `+` button) → nothing happens. Only the `+` button is interactive.

- [ ] **Step 5.6: STOP**

Report and wait for go-ahead.

---

## Task 6: Cart sheet — group items by department

**Files:**
- Modify: `cart.js` — `openCartSheet`
- Modify: `style.css` — `.cart-group` header styles

After this task, the cart bottom sheet groups items under HRANA and PIĆE section headers. Items within each group preserve the existing layout (quantity controls, price). The underlying `cart` array is unchanged — partitioning is render-time only.

- [ ] **Step 6.1: Refactor `openCartSheet`**

Replace `openCartSheet` (cart.js around line 288) with:

```js
function openCartSheet() {
  const overlay = document.getElementById("cart-sheet-overlay");
  const content = document.getElementById("cart-sheet-content");

  if (cart.length === 0) {
    content.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty__icon">🛒</div>
        <h3 class="cart-empty__title">Narudžbina je prazna</h3>
        <p class="cart-empty__text">Dodajte jela iz menija</p>
      </div>
    `;
  } else {
    const foodItems = cart.filter((i) => i.department === "food");
    const drinkItems = cart.filter((i) => i.department === "drinks");

    const renderGroup = (label, items) => {
      if (items.length === 0) return "";
      return `
        <div class="cart-group">
          <h3 class="cart-group__header">${label}</h3>
          <div class="cart-items">
            ${items
              .map(
                (item) => `
              <div class="cart-item" data-key="${escapeHtml(item.key)}">
                <div class="cart-item__info">
                  <span class="cart-item__name">${escapeHtml(item.name)}</span>
                  ${item.variant ? `<span class="cart-item__variant">${escapeHtml(item.variant)}</span>` : ""}
                </div>
                <div class="cart-item__controls">
                  <button class="cart-item__qty-btn" data-action="minus" aria-label="Smanji">−</button>
                  <span class="cart-item__qty">${item.qty}</span>
                  <button class="cart-item__qty-btn" data-action="plus" aria-label="Povećaj">+</button>
                </div>
                <span class="cart-item__price">${formatPrice(item.price * item.qty)}</span>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      `;
    };

    content.innerHTML = `
      <h2 class="cart-header">Vaša narudžbina</h2>
      ${renderGroup("HRANA", foodItems)}
      ${renderGroup("PIĆE", drinkItems)}
      <div class="cart-footer">
        <div class="cart-total">
          <span>Ukupno:</span>
          <span class="cart-total__price">${formatPrice(getCartTotal())}</span>
        </div>
        <button class="cart-waiter-btn" id="cart-waiter-btn">Pokaži konobaru</button>
        <button class="cart-clear-btn" id="cart-clear-btn">Obriši sve</button>
      </div>
    `;

    // Bind quantity buttons (now scoped under .cart-group)
    content.querySelectorAll(".cart-item__qty-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.closest(".cart-item").dataset.key;
        const delta = btn.dataset.action === "plus" ? 1 : -1;
        updateCartQty(key, delta);
        openCartSheet(); // re-render
      });
    });

    document.getElementById("cart-waiter-btn").addEventListener("click", () => {
      closeCartSheet();
      setTimeout(openWaiterSummary, 300);
    });

    document.getElementById("cart-clear-btn").addEventListener("click", () => {
      clearCart();
      openCartSheet();
    });
  }

  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add("sheet-overlay--open"));
}
```

- [ ] **Step 6.2: Add group header CSS**

Append to `style.css`:

```css
/* ----------------------------------------------------------
   N. CART GROUP HEADERS (HRANA / PIĆE)
   ---------------------------------------------------------- */
.cart-group {
  margin-bottom: var(--space-md);
}

.cart-group__header {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-primary-dark);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-sm);
}
```

- [ ] **Step 6.3: Verify**

Run `npx serve .` and reload.

Setup the scenario:
1. Landing → HRANA → add a couple of food items to the cart.
2. Switch to PIĆE via the header toggle.
3. If a drinks sheet URL is set, add a couple of drinks. (If not, skip the drinks side and verify food-only renders correctly.)
4. Tap the cart FAB.

Checklist:
- Cart sheet shows a "HRANA" section header above the food items, and a "PIĆE" section header above the drinks. Each section uses the same row layout as before.
- If only one department has items, only that section header appears (no empty "PIĆE" header above nothing).
- Quantity +/− buttons still work — incrementing/decrementing re-renders the sheet with updated quantities.
- "Obriši sve" empties the cart and the sheet swaps to the empty state.
- "Pokaži konobaru" still opens the waiter summary (still flat — fixed in Task 7).
- Console: zero errors.

- [ ] **Step 6.4: STOP**

Report and wait for go-ahead.

---

## Task 7: Waiter summary — group items by department

**Files:**
- Modify: `cart.js` — `openWaiterSummary`
- Modify: `style.css` — `.waiter-summary__group-header` style

After this task, the waiter sees a clear HRANA / PIĆE split so they can hand drinks to the bar and food to the kitchen at a glance.

- [ ] **Step 7.1: Refactor `openWaiterSummary`**

Replace `openWaiterSummary` (cart.js around line 379) with:

```js
function openWaiterSummary() {
  const screen = document.getElementById("waiter-summary");

  const foodItems = cart.filter((i) => i.department === "food");
  const drinkItems = cart.filter((i) => i.department === "drinks");

  const renderGroup = (label, items) => {
    if (items.length === 0) return "";
    return `
      <h2 class="waiter-summary__group-header">${label}</h2>
      ${items
        .map(
          (item) => `
        <div class="waiter-item">
          <span class="waiter-item__qty">${item.qty}x</span>
          <span class="waiter-item__name">
            ${escapeHtml(item.name)}${item.variant ? ` — ${escapeHtml(item.variant)}` : ""}
          </span>
          <span class="waiter-item__price">${formatPrice(item.price * item.qty)}</span>
        </div>
      `,
        )
        .join("")}
    `;
  };

  screen.innerHTML = `
    <div class="waiter-summary__inner">
      <div class="waiter-summary__header">
        <h1 class="waiter-summary__title">Narudžbina</h1>
        <button class="waiter-summary__close" id="waiter-close" aria-label="Zatvori">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="waiter-summary__items">
        ${renderGroup("HRANA", foodItems)}
        ${renderGroup("PIĆE", drinkItems)}
      </div>
      <div class="waiter-summary__total">
        <span>Ukupno</span>
        <span>${formatPrice(getCartTotal())}</span>
      </div>
    </div>
  `;

  screen.hidden = false;
  requestAnimationFrame(() => screen.classList.add("waiter-summary--open"));

  document
    .getElementById("waiter-close")
    .addEventListener("click", closeWaiterSummary);
}
```

- [ ] **Step 7.2: Add group header CSS**

Append to `style.css`:

```css
/* ----------------------------------------------------------
   N. WAITER SUMMARY GROUP HEADERS
   ---------------------------------------------------------- */
.waiter-summary__group-header {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-primary);
  margin-top: var(--space-lg);
  margin-bottom: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 2px solid var(--color-primary);
}

.waiter-summary__group-header:first-child {
  margin-top: 0;
}
```

- [ ] **Step 7.3: Verify**

Run `npx serve .` and reload.

Setup:
1. Add a couple of food items.
2. Add a couple of drinks (if drinks URL is set) — otherwise verify with food-only.
3. Open cart sheet → tap "Pokaži konobaru".

Checklist:
- Waiter screen shows HRANA section with food items below it, then PIĆE section with drinks below it.
- Each section header is golden, uppercase, with an underline — visually distinct from item rows.
- Total at the bottom is the sum of everything.
- If only one department has items, only that header shows.
- Close button works.
- Console: zero errors.

- [ ] **Step 7.4: STOP**

Report and wait for go-ahead.

---

## Task 8: Cross-cutting polish & final sweep

**Files:**
- Modify: `app.js`, `cart.js`, `style.css`, `index.html` — surgical fixes only

This task catches anything that fell through the cracks. The big risk areas:

1. The dish sheet for multi-variant drinks (used by Task 5 multi-variant branch). The sheet was designed for food and includes an image wrapper. For drinks, `imageUrl` is empty so it falls back to the placeholder SVG.
2. The category filter `<select>` shows categories from the active department. Verify it rebuilds correctly when switching departments.
3. Search across the drinks side — search is scoped per-department, so searching for "pivo" in HRANA finds nothing (correct).
4. The offline badge behavior when one of two fetches fails.

- [ ] **Step 8.1: Hide the image wrapper in the dish sheet for drinks**

In `cart.js`, find `openDishSheet` (around line 145). Modify the rendered content so that for drinks the image block is suppressed:

Replace the `content.innerHTML` template line that includes `<div class="sheet-dish__image-wrap">` to conditionally omit the image wrapper:

```js
  const imageBlock =
    dish.department === "drinks"
      ? ""
      : `<div class="sheet-dish__image-wrap">
           <img class="sheet-dish__image" src="${imgSrc}" alt="${escapeHtml(dish.name)}"
             onerror="this.src='${CONFIG.PLACEHOLDER_IMAGE}'">
         </div>`;

  content.innerHTML = `
    <div class="sheet-dish">
      ${imageBlock}
      <h2 class="sheet-dish__name">${escapeHtml(dish.name)}</h2>
      ${tagsHtml}
      ${dish.description ? `<p class="sheet-dish__description">${escapeHtml(dish.description)}</p>` : ""}
      ${ingredientsHtml}
      ${allergensHtml}
      ${
        dish.variants.length === 0 && dish.price > 0
          ? `<p class="sheet-dish__price">${formatPrice(dish.price)}</p>`
          : ""
      }
      ${variantsHtml}
      ${
        dish.variants.length === 0
          ? `<button class="sheet-dish__add-btn" id="dish-add-btn">Dodaj u narudžbinu</button>`
          : ""
      }
    </div>
  `;
```

(The existing `imgSrc` line above the template is harmless when `imageBlock` is empty — no need to remove it.)

- [ ] **Step 8.2: Confirm category filter is rebuilt on department switch**

Open `app.js`. In `setDepartment` (added in Task 3.3), the line `buildCategoryFilter(dishes);` already runs when the department changes. Verify by inspection — no code change needed unless the category `<select>` shows stale options after switching. If it does, look for a stale-state bug in `buildCategoryFilter` or its `currentCategory` reset.

- [ ] **Step 8.3: Sweep for leftover `allDishes`**

Run:

```
Grep pattern: \ballDishes\b   path: .
```

Expected: zero hits across the entire project (excluding this plan file, the spec file, and any docs). If any hit appears in `app.js` or `cart.js`, fix it — replace with `getActiveDishes()` if it's a read site, or remove if it's a stale assignment.

- [ ] **Step 8.4: Full end-to-end verification**

Run `npx serve .` and reload. Walk through the entire user journey:

Checklist:
- Fresh page load → landing screen shows. Both panels styled correctly.
- Tap HRANA → food menu renders. All existing features work: search, sort, category filter, dish tap → sheet, add to cart, variants.
- Tap PIĆE in header toggle → drinks render (or empty state if URL not set). Inline `+` works for single-variant; sheet opens for multi-variant drinks; image area is suppressed in the sheet for drinks.
- Switch back to HRANA → search/sort/filter are reset to defaults. Menu re-renders correctly.
- Add items from both departments → cart FAB badge shows total combined count.
- Open cart → grouped sections appear.
- Tap "Pokaži konobaru" → waiter summary grouped, totals correct.
- Reload page (Cmd-R) → landing screen appears again. Cart is preserved (food + drinks).
- Open DevTools → Application → Local Storage. `libero_menu_data`, `libero_menu_ts`, `libero_drinks_data` (if URL set), `libero_drinks_ts` (if URL set), `libero_cart` all present.
- Open Network tab, throttle to "Offline" → reload → landing still works, cached menus still render after picking a department, offline badge appears.
- Restore network → reload → fresh data.
- Console: zero errors, zero unexpected warnings, across the whole journey.

- [ ] **Step 8.5: Update CLAUDE.md**

Add a one-line note to the existing "Architecture" section of `CLAUDE.md` to record the second sheet URL:

```markdown
**Two sheets:** Food and drinks live in separate Google Sheets. Configure both URLs in `CONFIG` (`SHEET_CSV_URL`, `SHEET_CSV_URL_DRINKS`). Drinks use a slimmer schema (no image / ingredients / allergens). Each department caches independently in localStorage.
```

Insert it right after the existing "Static site — vanilla HTML/CSS/JS…" line.

- [ ] **Step 8.6: STOP**

Report final state to the user. Do **not** commit. The user will:
- Review the diff manually
- Decide whether to populate `SHEET_CSV_URL_DRINKS`
- Commit everything in whatever shape they want

---

## Post-implementation notes for the user

- **Drinks sheet template:** the drinks Google Sheet needs columns `Category, CategoryEN, SortOrder, Name, NameEN, Variants, Price, Tags, Active`. `Description`, `Ingredients`, `Allergens`, `ImageUrl` are deliberately absent. Single-price drinks: leave `Variants` blank, fill `Price`. Multi-size drinks: leave `Price` blank, fill `Variants` like `0.33L 200|0.5L 250`.
- **Apps Script:** deploy the same kind of macro the food sheet uses (CSV passthrough), copy the URL into `SHEET_CSV_URL_DRINKS`.
- **Tags:** drink tags live in the same `tags-config.js`. If the client wants drink-specific badges (e.g. "Bez alkohola", "Hladan"), add them there.
