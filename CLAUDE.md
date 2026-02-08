# LiberoMenu

QR code restaurant menu web app for **Libero Fast Food** (Zajecar, Serbia).
Live at: https://libero-zajecar.com

## Architecture

Static site — vanilla HTML/CSS/JS, no build step, hosted on GitHub Pages (main branch, root `/`).

- `index.html` — single-page entry point
- `style.css` — full design system with CSS custom properties
- `app.js` — core logic: data fetching, CSV parsing, rendering, search, sort, category filter, lazy loading, offline detection
- `cart.js` — "silent order" cart: dish detail sheet, cart sheet, waiter summary (no payment processing)
- `tags-config.js` — tag badge colors/labels (editable by client)
- `assets/images/` — dish images (WebP, 400x400, <50KB) + `LogoLibero.svg` + `placeholder.svg`
- `assets/favicon/` — favicons + webmanifest

## Data Pipeline

Menu data comes from Google Sheets via a Google Apps Script macro URL (configured in `CONFIG.SHEET_CSV_URL` in app.js). The script returns CSV which is parsed by PapaParse.

**Column schema:** Category, CategoryEN, SortOrder, Name, NameEN, Description, DescriptionEN, Ingredients, Allergens, Price, Variants, ImageUrl, Tags, Active

- `Active=FALSE` rows are filtered out
- Category order = first-appearance order in the sheet
- Variants format: `"Label Price|Label Price"` (e.g., `"Mali 650|Veliki 850"`)
- Pizza ("Pice" category) uses special price format: `"1200/1500/2000"` → S/M/XL sizes via `parsePicaPrice()`
- Tags are comma-separated, matched case-insensitively against `TAGS_CONFIG` keys

## Caching

localStorage with 5-minute TTL, stale-while-revalidate pattern:
- Cache exists & fresh → render cached, done
- Cache exists & stale → render cached immediately, fetch fresh in background, re-render only if data changed
- No cache → show skeleton loading, fetch, render progressively (one category per rAF)

## Key Patterns

- **Images:** lazy-loaded via IntersectionObserver (200px rootMargin), `data-src` → `src` swap, `onerror` → placeholder.svg
- **Search:** debounced 300ms, requires 3+ characters, diacritic-insensitive (NFD normalization)
- **XSS prevention:** `escapeHtml()` via `textContent`/`innerHTML` for all Google Sheet data
- **Restaurant config:** phone number, maps URL, sheet URL all in `CONFIG` object at top of app.js
- **Cart state:** persisted in localStorage under `libero_cart`
- **Bottom sheets:** CSS transitions with overlay, 300ms close animation delay

## Local Development

Use any static file server:
```bash
npx serve .
# or
python -m http.server
```
No install, no build step needed. PapaParse and Google Fonts are loaded from CDN.

## Brand

- Primary color: `#FFCF40` (golden yellow)
- Fonts: Playfair Display (headings) + DM Sans (body)
- Currency: RSD (e.g., "850 RSD")
- Language: Serbian (Latin script)

## Scripts Load Order

`PapaParse CDN` → `tags-config.js` → `app.js` → `cart.js` (all `defer`)

cart.js depends on app.js globals: `CONFIG`, `formatPrice()`, `escapeHtml()`, `TAGS_CONFIG`.
app.js calls `initCart()` and `makeDishCardTappable()` from cart.js (checked with `typeof` guard).
