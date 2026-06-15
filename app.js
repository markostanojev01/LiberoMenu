/* ==========================================================
   LiberoMenu — Application Logic
   ========================================================== */

// ----------------------------------------------------------
// 1. CONFIGURATION
// ----------------------------------------------------------
const CONFIG = {
  // Food sheet — existing endpoint
  SHEET_CSV_URL:
    "https://script.google.com/macros/s/AKfycbyjuDHlU4XfkdfIZXBqk7XTHHnVa4WhvoNlnGBt-oaFo97UXsknKqOjTW94No3IFfzP/exec",
  // Drinks sheet — set this once the second Apps Script is deployed
  SHEET_CSV_URL_DRINKS:
    "https://script.google.com/macros/s/AKfycbxDPOqgA1rM0Esr-fPDfr62JfLXYeU7WvaA6JmXt_y8xYNslQxU2vodtflrJ-8IjBhEFg/exec",
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
  PHONE_NUMBER_DRINKS: "019290349",
  MAPS_URL_DRINKS:
    "https://www.google.com/maps/place/Caffe+Libero/@43.9023973,22.2790735,128m/data=!3m1!1e3!4m6!3m5!1s0x475473b69a96bffd:0x58ffa77267108121!8m2!3d43.9023373!4d22.2795993!16s%2Fg%2F11rnk0dgbk?entry=ttu&g_ep=EgoyMDI2MDYxMC4wIKXMDSoASAFQAw%3D%3D",
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
let foodDishes = [];
let drinkDishes = [];
let currentDepartment = null; // null = landing screen visible
let currentSort = "recommended";
let currentQuery = "";
let currentCategory = "all";
let lazyObserver = null;

function getActiveDishes() {
  if (currentDepartment === "drinks") return drinkDishes;
  if (currentDepartment === "food") return foodDishes;
  return [];
}

// ----------------------------------------------------------
// 3. INITIALIZATION
// ----------------------------------------------------------
document.addEventListener("DOMContentLoaded", init);

async function init() {
  updateHeaderLinks("food");
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

function updateHeaderLinks(dep) {
  const phoneLink = document.getElementById("phone-link");
  const mapsLink = document.getElementById("maps-link");
  const phone = dep === "drinks" ? CONFIG.PHONE_NUMBER_DRINKS : CONFIG.PHONE_NUMBER;
  const maps = dep === "drinks" ? CONFIG.MAPS_URL_DRINKS : CONFIG.MAPS_URL;
  if (phoneLink && phone) phoneLink.href = `tel:${phone}`;
  if (mapsLink && maps) mapsLink.href = maps;
}

function setDepartment(dep) {
  currentDepartment = dep;

  document.body.classList.toggle("view-landing", dep === null);
  document.body.classList.toggle("view-food", dep === "food");
  document.body.classList.toggle("view-drinks", dep === "drinks");

  updateHeaderLinks(dep);

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

  // Sync dept toggle visual + a11y state
  document.querySelectorAll(".dept-toggle__btn").forEach((btn) => {
    const isActive = btn.dataset.dep === dep;
    btn.classList.toggle("dept-toggle__btn--active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
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

function initDeptToggle() {
  document.querySelectorAll(".dept-toggle__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dep = btn.dataset.dep;
      if (dep === currentDepartment) return;
      setDepartment(dep);
    });
  });
}

// ----------------------------------------------------------
// 4. DATA FETCHING & CACHING
// ----------------------------------------------------------
async function fetchMenuData() {
  // Fire both fetches in parallel. Each one independently updates its
  // department array and triggers a render if it's the active department.
  await Promise.all([
    fetchDepartment("food"),
    fetchDepartment("drinks"),
  ]);
}

async function fetchDepartment(dep) {
  const { url, cacheKey, tsKey, parser } = getDepartmentConfig(dep);

  // No URL configured — render empty state only if this is the active dept
  if (!url) {
    if (dep === "food" && currentDepartment === "food") {
      removeSkeletons();
      renderEmptyState(
        "Meni jos nije povezan",
        "Dodajte Google Sheet CSV URL u app.js konfiguraciju.",
      );
    }
    setDepartmentData(dep, []);
    return;
  }

  const cached = getCachedData(cacheKey, tsKey);

  if (cached) {
    applyDepartmentData(dep, cached.data);
    if (isCacheValid(tsKey)) return;
    // Stale — refresh in background
    fetchFresh(dep, cached);
    return;
  }

  // No cache — wait for network
  await fetchFresh(dep, null);
}

async function fetchFresh(dep, cached) {
  const { url, parser, cacheKey, tsKey } = getDepartmentConfig(dep);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    const dishes = parser(csvText);
    setCachedData(cacheKey, tsKey, dishes);

    if (cached) {
      const changed = JSON.stringify(dishes) !== JSON.stringify(cached.data);
      if (changed) {
        applyDepartmentData(dep, dishes);
      }
    } else {
      applyDepartmentData(dep, dishes, { progressive: true });
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

function applyDepartmentData(dep, dishes, { progressive = false } = {}) {
  setDepartmentData(dep, dishes);
  if (currentDepartment !== dep) return;
  const active = getActiveDishes();
  buildCategoryFilter(active);
  if (progressive) {
    renderMenuProgressive(active);
  } else {
    renderMenu(active);
  }
}

function getDepartmentConfig(dep) {
  if (dep === "food") {
    return {
      url: CONFIG.SHEET_CSV_URL,
      cacheKey: CONFIG.CACHE_KEY_FOOD,
      tsKey: CONFIG.CACHE_TS_FOOD,
      parser: parseFoodCSV,
    };
  }
  return {
    url: CONFIG.SHEET_CSV_URL_DRINKS,
    cacheKey: CONFIG.CACHE_KEY_DRINKS,
    tsKey: CONFIG.CACHE_TS_DRINKS,
    parser: parseDrinksCSV,
  };
}

function getCachedData(cacheKey, tsKey) {
  try {
    const raw = localStorage.getItem(cacheKey);
    const ts = localStorage.getItem(tsKey);
    if (!raw || !ts) return null;
    return { data: JSON.parse(raw) };
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

// ----------------------------------------------------------
// 5. CSV PARSING
// ----------------------------------------------------------
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

function parsePriceCell(val) {
  if (val == null || val === "") return 0;
  if (typeof val === "number") return val;
  const match = String(val).match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
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
    price: parsePriceCell(row.Price),
    variants: parseVariants(row.Variants),
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
  if (dish.variants.length >= 2) {
    const minPrice = Math.min(...dish.variants.map((v) => v.price));
    priceEl.textContent = `od ${formatPrice(minPrice)}`;
  } else if (dish.variants.length === 1) {
    priceEl.textContent = formatPrice(dish.variants[0].price);
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
  // Reentrancy-safe: cancel any in-flight restore and capture the resting label only when not mid-flash.
  if (btn._flashTimer) clearTimeout(btn._flashTimer);
  if (!btn.classList.contains("drink-card__add--added")) {
    btn._flashRestore = btn.textContent;
    btn.classList.add("drink-card__add--added");
  }
  btn.textContent = "✓";
  btn._flashTimer = setTimeout(() => {
    btn.textContent = btn._flashRestore;
    btn.classList.remove("drink-card__add--added");
    btn._flashTimer = null;
  }, 600);
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
      if (getActiveDishes().length > 0) renderMenu(getActiveDishes());
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
      if (getActiveDishes().length > 0) renderMenu(getActiveDishes());
    }, 300),
  );

  clearBtn.addEventListener("click", () => {
    input.value = "";
    currentQuery = "";
    clearBtn.hidden = true;
    if (getActiveDishes().length > 0) renderMenu(getActiveDishes());
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
    if (getActiveDishes().length > 0) renderMenu(getActiveDishes());
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

      if (getActiveDishes().length > 0) renderMenu(getActiveDishes());
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
  // Attempt a background refresh — fetchMenuData re-renders internally if data changed
  fetchMenuData();
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
