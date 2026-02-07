/* ==========================================================
   LiberoMenu — Application Logic
   ========================================================== */

// ----------------------------------------------------------
// 1. CONFIGURATION
// ----------------------------------------------------------
const CONFIG = {
  // Replace with your published Google Sheet CSV URL
  SHEET_CSV_URL:
    "https://script.google.com/macros/s/AKfycbyjuDHlU4XfkdfIZXBqk7XTHHnVa4WhvoNlnGBt-oaFo97UXsknKqOjTW94No3IFfzP/exec",
  CACHE_KEY: "libero_menu_data",
  CACHE_TIMESTAMP_KEY: "libero_menu_ts",
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  IMAGE_BASE_PATH: "assets/images/",
  PLACEHOLDER_IMAGE: "assets/images/placeholder.svg",
  CURRENCY: "RSD",
  PHONE_NUMBER: "+381693336303",
  MAPS_URL:
    "https://www.google.com/maps/place/Libero+Fast+Food/@43.902285,22.27958,20z/data=!4m6!3m5!1s0x475473005fce1ab9:0x5deb13694bb3f3f9!8m2!3d43.9021943!4d22.2796925!16s%2Fg%2F11xvbp01kn?entry=ttu&g_ep=EgoyMDI2MDIwNC4wIKXMDSoASAFQAw%3D%3D",
};

/** Pica (pizza) size order; price format from sheet is "1200/1500/2000" → S/M/XL. Non-numeric segment = size not available. */
const PICA_SIZE_LABELS = ["S", "M", "XL"];

function parsePicaPrice(val) {
  if (val == null || val === "") return [];
  const str = String(val).trim();
  if (!str.includes("/")) return [];
  const parts = str.split("/").map((p) => p.trim());
  const result = [];
  PICA_SIZE_LABELS.forEach((label, i) => {
    const part = parts[i];
    const num = part != null ? Number(part) : NaN;
    if (Number.isFinite(num) && num > 0) {
      result.push({ label, price: num });
    }
  });
  return result;
}

// ----------------------------------------------------------
// 2. STATE
// ----------------------------------------------------------
let allDishes = [];
let currentSort = "recommended";
let currentQuery = "";
let currentCategory = "all";
let lazyObserver = null;

// ----------------------------------------------------------
// 3. INITIALIZATION
// ----------------------------------------------------------
document.addEventListener("DOMContentLoaded", init);

async function init() {
  initHeaderLinks();
  initSearch();
  initSort();
  initCategoryFilter();
  initOfflineDetection();
  if (typeof initCart === "function") initCart();

  const dishes = await fetchMenuData();
  if (dishes && dishes.length > 0) {
    allDishes = dishes;
    buildCategoryFilter(allDishes);
    renderMenu(allDishes);
  }
}

function initHeaderLinks() {
  const phoneLink = document.getElementById("phone-link");
  const mapsLink = document.getElementById("maps-link");
  if (phoneLink && CONFIG.PHONE_NUMBER) {
    phoneLink.href = `tel:${CONFIG.PHONE_NUMBER}`;
  }
  if (mapsLink && CONFIG.MAPS_URL) {
    mapsLink.href = CONFIG.MAPS_URL;
  }
}

// ----------------------------------------------------------
// 4. DATA FETCHING & CACHING
// ----------------------------------------------------------
async function fetchMenuData() {
  // If no Sheet URL configured, show a setup message
  if (!CONFIG.SHEET_CSV_URL) {
    removeSkeletons();
    renderEmptyState(
      "Meni jos nije povezan",
      "Dodajte Google Sheet CSV URL u app.js konfiguraciju.",
    );
    return [];
  }

  const cached = getCachedData();

  // Always show cached data first (instant render), then refresh silently
  if (cached) {
    allDishes = cached.data;
    renderMenu(allDishes);

    // If cache is fresh, we're done
    if (isCacheValid()) return cached.data;

    // Cache is stale — silently refresh in background
    fetchFresh(cached);
    return cached.data;
  }

  // No cache — must wait for network (skeletons are visible)
  return await fetchFresh(null);
}

async function fetchFresh(cached) {
  try {
    const response = await fetch(CONFIG.SHEET_CSV_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    const dishes = parseCSV(csvText);
    setCachedData(dishes);

    // If we already rendered stale cache, only re-render if data changed
    if (cached) {
      const changed = JSON.stringify(dishes) !== JSON.stringify(cached.data);
      if (changed) {
        allDishes = dishes;
        buildCategoryFilter(allDishes);
        renderMenu(allDishes);
      }
    } else {
      // First load (no cache) — render progressively
      allDishes = dishes;
      buildCategoryFilter(allDishes);
      renderMenuProgressive(allDishes);
    }
    return dishes;
  } catch (error) {
    console.error("Menu fetch failed:", error);

    if (cached) {
      renderOfflineBadge(true);
      return cached.data;
    }

    removeSkeletons();
    renderEmptyState(
      "Meni trenutno nije dostupan",
      "Proverite internet konekciju i pokusajte ponovo.",
    );
    return [];
  }
}

function getCachedData() {
  try {
    const raw = localStorage.getItem(CONFIG.CACHE_KEY);
    const ts = localStorage.getItem(CONFIG.CACHE_TIMESTAMP_KEY);
    if (!raw || !ts) return null;
    return { data: JSON.parse(raw), timestamp: parseInt(ts, 10) };
  } catch {
    return null;
  }
}

function setCachedData(dishes) {
  try {
    localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify(dishes));
    localStorage.setItem(CONFIG.CACHE_TIMESTAMP_KEY, String(Date.now()));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

function isCacheValid() {
  const cached = getCachedData();
  if (!cached) return false;
  return Date.now() - cached.timestamp < CONFIG.CACHE_TTL;
}

// ----------------------------------------------------------
// 5. CSV PARSING
// ----------------------------------------------------------
function parseCSV(csvString) {
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

function parseTags(tagString) {
  if (!tagString || typeof tagString !== "string") return [];
  return tagString
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseVariants(variantString) {
  if (!variantString || typeof variantString !== "string") return [];
  return variantString
    .split("|")
    .map((v) => {
      const trimmed = v.trim();
      if (!trimmed) return null;
      // Match "Label Price" pattern, e.g., "Mali 650" or "0.25L 200"
      const match = trimmed.match(/^(.+?)\s+(\d+)$/);
      if (match) {
        return { label: match[1].trim(), price: Number(match[2]) };
      }
      return { label: trimmed, price: 0 };
    })
    .filter(Boolean);
}

// ----------------------------------------------------------
// 6. RENDERING
// ----------------------------------------------------------
function renderMenu(dishes) {
  removeSkeletons();

  const container = document.getElementById("menu-container");
  container.innerHTML = "";

  let filtered = filterByCategory(filterByQuery(dishes, currentQuery));
  const grouped = groupByCategory(filtered);

  if (grouped.length === 0) {
    if (currentQuery) {
      renderEmptyState(
        `Nema rezultata za "${escapeHtml(currentQuery)}"`,
        "Pokusajte sa drugim pojmom za pretragu.",
      );
    }
    return;
  }

  grouped.forEach(({ category, items }) => {
    const sorted = sortDishes(items, currentSort);
    const section = createCategorySection(category, sorted);
    container.appendChild(section);
  });

  initLazyLoading();
}

function renderMenuProgressive(dishes) {
  removeSkeletons();

  const container = document.getElementById("menu-container");
  container.innerHTML = "";

  const filtered = filterByCategory(filterByQuery(dishes, currentQuery));
  const grouped = groupByCategory(filtered);

  if (grouped.length === 0) {
    if (currentQuery) {
      renderEmptyState(
        `Nema rezultata za "${escapeHtml(currentQuery)}"`,
        "Pokusajte sa drugim pojmom za pretragu.",
      );
    }
    return;
  }

  // Render first category immediately, rest with staggered rAF delays
  let index = 0;

  function renderNextCategory() {
    if (index >= grouped.length) {
      initLazyLoading();
      return;
    }
    const { category, items } = grouped[index];
    const sorted = sortDishes(items, currentSort);
    const section = createCategorySection(category, sorted);
    container.appendChild(section);
    index++;

    // Lazy-load images for this batch right away
    section.querySelectorAll(".dish-card__image[data-src]").forEach((img) => {
      if (lazyObserver) lazyObserver.observe(img);
    });

    if (index < grouped.length) {
      requestAnimationFrame(renderNextCategory);
    } else {
      initLazyLoading();
    }
  }

  renderNextCategory();
}

function groupByCategory(dishes) {
  const categoryOrder = [];
  const groups = {};

  dishes.forEach((dish) => {
    const cat = dish.category || "Ostalo";
    if (!groups[cat]) {
      groups[cat] = [];
      categoryOrder.push(cat);
    }
    groups[cat].push(dish);
  });

  return categoryOrder.map((cat) => ({
    category: cat,
    items: groups[cat],
  }));
}

function sortDishes(dishes, mode) {
  const sorted = [...dishes];
  switch (mode) {
    case "price-asc":
      sorted.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
      break;
    case "price-desc":
      sorted.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));
      break;
    default: // 'recommended'
      sorted.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return sorted;
}

function getEffectivePrice(dish) {
  if (dish.variants.length > 0) {
    return Math.min(...dish.variants.map((v) => v.price));
  }
  return dish.price;
}

function createCategorySection(category, dishes) {
  const section = document.createElement("section");
  section.className = "category-section";
  section.setAttribute("data-category", category);

  const header = document.createElement("h2");
  header.className = "category-header";
  header.textContent = category;

  section.appendChild(header);

  dishes.forEach((dish) => {
    const card = createDishCard(dish);
    if (typeof makeDishCardTappable === "function") {
      makeDishCardTappable(card, dish);
    }
    section.appendChild(card);
  });

  return section;
}

function createDishCard(dish) {
  const card = document.createElement("article");
  card.className = "dish-card";

  // Image
  const imageWrap = document.createElement("div");
  imageWrap.className = "dish-card__image-wrap";

  const img = document.createElement("img");
  img.className = "dish-card__image";
  img.alt = dish.name;
  img.width = 76;
  img.height = 76;
  if (dish.imageUrl) {
    img.setAttribute("data-src", CONFIG.IMAGE_BASE_PATH + dish.imageUrl);
  } else {
    img.setAttribute("data-src", CONFIG.PLACEHOLDER_IMAGE);
  }
  imageWrap.appendChild(img);

  // Info block
  const info = document.createElement("div");
  info.className = "dish-card__info";

  const name = document.createElement("h3");
  name.className = "dish-card__name";
  name.textContent = dish.name;
  info.appendChild(name);

  if (dish.description) {
    const desc = document.createElement("p");
    desc.className = "dish-card__description";
    desc.textContent = dish.description;
    info.appendChild(desc);
  }

  // Tags
  if (dish.tags.length > 0) {
    const meta = document.createElement("div");
    meta.className = "dish-card__meta";
    dish.tags.forEach((tag) => {
      meta.appendChild(createTagBadge(tag));
    });
    info.appendChild(meta);
  }

  // Pica: special size strip (S / M / XL)
  if (dish.category === "Pica" && dish.variants.length > 0) {
    const pizzaSizes = document.createElement("div");
    pizzaSizes.className = "pizza-sizes";
    dish.variants.forEach((v, i) => {
      const chip = document.createElement("span");
      chip.className = "pizza-size-chip";
      chip.innerHTML = `<span class="pizza-size-chip__label">${v.label}</span><span class="pizza-size-chip__price">${formatPrice(v.price)}</span>`;
      pizzaSizes.appendChild(chip);
      if (i < dish.variants.length - 1) {
        const sep = document.createElement("span");
        sep.className = "pizza-sizes__sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "·";
        pizzaSizes.appendChild(sep);
      }
    });
    info.appendChild(pizzaSizes);
  } else if (dish.variants.length > 0) {
    // Standard variants
    const variantList = document.createElement("div");
    variantList.className = "variant-list";
    dish.variants.forEach((v) => {
      const pill = document.createElement("span");
      pill.className = "variant-pill";
      pill.textContent = `${v.label} ${formatPrice(v.price)}`;
      variantList.appendChild(pill);
    });
    info.appendChild(variantList);
  }

  // Allergens
  if (dish.allergens) {
    const allergens = document.createElement("span");
    allergens.className = "dish-card__allergens";
    allergens.textContent = dish.allergens;
    info.appendChild(allergens);
  }

  // Price (hidden if variants exist)
  card.appendChild(imageWrap);
  card.appendChild(info);

  if (dish.variants.length === 0 && dish.price > 0) {
    const price = document.createElement("span");
    price.className = "dish-card__price";
    price.textContent = formatPrice(dish.price);
    card.appendChild(price);
  }

  return card;
}

function createTagBadge(tag) {
  const badge = document.createElement("span");
  const normalized = tag.toLowerCase().replace(/[^a-z]/g, "");
  badge.className = "tag-badge";

  // Look up config from tags-config.js
  const config = typeof TAGS_CONFIG !== "undefined" && TAGS_CONFIG[normalized];

  if (config) {
    badge.textContent = config.label || tag;
    badge.style.background = config.bg;
    badge.style.color = config.color;
  } else {
    badge.textContent = tag;
  }

  return badge;
}

function removeSkeletons() {
  const skeleton = document.getElementById("skeleton-loader");
  if (skeleton) skeleton.remove();
}

function renderEmptyState(title, text) {
  const container = document.getElementById("menu-container");
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">🍽</div>
      <h2 class="empty-state__title">${title}</h2>
      <p class="empty-state__text">${text || ""}</p>
    </div>
  `;
}

// ----------------------------------------------------------
// 7. SEARCH
// ----------------------------------------------------------
function initSearch() {
  const toggle = document.getElementById("search-toggle");
  const container = document.getElementById("search-container");
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("search-clear");

  toggle.addEventListener("click", () => {
    const isHidden = container.hidden;
    container.hidden = !isHidden;
    if (!isHidden) {
      // Closing search
      input.value = "";
      currentQuery = "";
      clearBtn.hidden = true;
      if (allDishes.length > 0) renderMenu(allDishes);
    } else {
      // Opening search
      setTimeout(() => input.focus(), 100);
    }
  });

  input.addEventListener(
    "input",
    debounce(() => {
      currentQuery = input.value.trim();
      clearBtn.hidden = !currentQuery;
      if (allDishes.length > 0) renderMenu(allDishes);
    }, 300),
  );

  clearBtn.addEventListener("click", () => {
    input.value = "";
    currentQuery = "";
    clearBtn.hidden = true;
    if (allDishes.length > 0) renderMenu(allDishes);
    input.focus();
  });
}

function filterByQuery(dishes, query) {
  if (!query || query.length < 3) return dishes;
  const normalized = normalizeText(query);
  return dishes.filter((dish) => {
    return (
      normalizeText(dish.name).includes(normalized) ||
      normalizeText(dish.description).includes(normalized) ||
      normalizeText(dish.ingredients).includes(normalized)
    );
  });
}

function normalizeText(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ----------------------------------------------------------
// 8. CATEGORY FILTER
// ----------------------------------------------------------
function initCategoryFilter() {
  const select = document.getElementById("category-select");
  select.addEventListener("change", () => {
    currentCategory = select.value;
    if (allDishes.length > 0) renderMenu(allDishes);
  });
}

function buildCategoryFilter(dishes) {
  const select = document.getElementById("category-select");

  // Get distinct categories in sheet order
  const categories = [];
  dishes.forEach((d) => {
    if (d.category && !categories.includes(d.category)) {
      categories.push(d.category);
    }
  });

  // Preserve current selection if it still exists
  const previousValue = currentCategory;

  // Rebuild options
  select.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "Sve kategorije";
  select.appendChild(allOption);

  categories.forEach((cat) => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });

  // Restore selection
  if (categories.includes(previousValue) || previousValue === "all") {
    select.value = previousValue;
  } else {
    select.value = "all";
    currentCategory = "all";
  }
}

function filterByCategory(dishes) {
  if (currentCategory === "all") return dishes;
  return dishes.filter((d) => d.category === currentCategory);
}

// ----------------------------------------------------------
// 9. SORT
// ----------------------------------------------------------
function initSort() {
  const buttons = document.querySelectorAll(".sort-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.sort;
      if (mode === currentSort) return;

      currentSort = mode;
      buttons.forEach((b) => b.classList.remove("sort-btn--active"));
      btn.classList.add("sort-btn--active");

      if (allDishes.length > 0) renderMenu(allDishes);
    });
  });
}

// ----------------------------------------------------------
// 9. LAZY IMAGE LOADING
// ----------------------------------------------------------
function initLazyLoading() {
  const images = document.querySelectorAll(".dish-card__image[data-src]");
  if ("IntersectionObserver" in window) {
    // Reuse or create observer
    if (!lazyObserver) {
      lazyObserver = new IntersectionObserver(onImageIntersect, {
        rootMargin: "200px 0px",
        threshold: 0.01,
      });
    }
    images.forEach((img) => lazyObserver.observe(img));
  } else {
    // Fallback: load all images immediately
    images.forEach((img) => {
      img.src = img.dataset.src;
      img.removeAttribute("data-src");
      img.classList.add("loaded");
    });
  }
}

function onImageIntersect(entries, observer) {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const img = entry.target;
    img.src = img.dataset.src;
    img.removeAttribute("data-src");
    img.addEventListener("load", () => img.classList.add("loaded"), {
      once: true,
    });
    img.addEventListener("error", () => handleImageError(img), { once: true });
    observer.unobserve(img);
  });
}

function handleImageError(img) {
  img.src = CONFIG.PLACEHOLDER_IMAGE;
  img.classList.add("loaded");
}

// ----------------------------------------------------------
// 10. OFFLINE DETECTION
// ----------------------------------------------------------
function initOfflineDetection() {
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  if (!navigator.onLine) {
    renderOfflineBadge(true);
  }
}

function handleOnline() {
  renderOfflineBadge(false);
  // Attempt a background refresh
  fetchMenuData().then((dishes) => {
    if (dishes && dishes.length > 0) {
      allDishes = dishes;
      renderMenu(allDishes);
    }
  });
}

function handleOffline() {
  renderOfflineBadge(true);
}

function renderOfflineBadge(show) {
  const badge = document.getElementById("offline-badge");
  if (badge) {
    badge.hidden = !show;
  }
}

// ----------------------------------------------------------
// 11. UTILITIES
// ----------------------------------------------------------
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatPrice(price) {
  if (!price || price <= 0) return "";
  return `${price} ${CONFIG.CURRENCY}`;
}
