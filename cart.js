/* ==========================================================
   LiberoMenu — Cart & Silent Order
   ========================================================== */

// ----------------------------------------------------------
// 1. CART STATE
// ----------------------------------------------------------
const CART_STORAGE_KEY = "libero_cart";
let cart = loadCart();

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    /* fail silently */
  }
}

function addToCart(dish, variantIndex) {
  const variant = variantIndex !== null ? dish.variants[variantIndex] : null;
  const key = dish.name + (variant ? `|${variant.label}` : "");
  const existing = cart.find((item) => item.key === key);

  if (existing) {
    existing.qty++;
  } else {
    cart.push({
      key,
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

function removeFromCart(key) {
  cart = cart.filter((item) => item.key !== key);
  saveCart();
  updateCartBadge();
}

function updateCartQty(key, delta) {
  const item = cart.find((i) => i.key === key);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(key);
  } else {
    saveCart();
    updateCartBadge();
  }
}

function clearCart() {
  cart = [];
  saveCart();
  updateCartBadge();
}

function getCartTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function getCartCount() {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

// ----------------------------------------------------------
// 2. FLOATING CART BUTTON
// ----------------------------------------------------------
function initCart() {
  // Create floating button
  const fab = document.createElement("button");
  fab.id = "cart-fab";
  fab.className = "cart-fab";
  fab.setAttribute("aria-label", "Pogledaj narudžbinu");
  fab.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <path d="M16 10a4 4 0 0 1-8 0"></path>
    </svg>
    <span class="cart-fab__badge" id="cart-badge">0</span>
  `;
  document.body.appendChild(fab);

  fab.addEventListener("click", openCartSheet);
  updateCartBadge();

  // Create cart bottom sheet
  createCartSheet();

  // Create dish detail bottom sheet
  createDishSheet();

  // Create waiter summary
  createWaiterSummary();
}

function updateCartBadge() {
  const badge = document.getElementById("cart-badge");
  const fab = document.getElementById("cart-fab");
  if (!badge || !fab) return;
  const count = getCartCount();
  badge.textContent = count;
  fab.classList.toggle("cart-fab--has-items", count > 0);
  badge.hidden = count === 0;
}

// ----------------------------------------------------------
// 3. DISH DETAIL BOTTOM SHEET
// ----------------------------------------------------------
function createDishSheet() {
  const overlay = document.createElement("div");
  overlay.id = "dish-sheet-overlay";
  overlay.className = "sheet-overlay";
  overlay.hidden = true;

  overlay.innerHTML = `
    <div class="sheet" id="dish-sheet">
      <div class="sheet__handle"></div>
      <div class="sheet__content" id="dish-sheet-content"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDishSheet();
  });
}

function openDishSheet(dish) {
  const overlay = document.getElementById("dish-sheet-overlay");
  const content = document.getElementById("dish-sheet-content");

  const imgSrc = dish.imageUrl
    ? CONFIG.IMAGE_BASE_PATH + dish.imageUrl
    : CONFIG.PLACEHOLDER_IMAGE;

  let tagsHtml = "";
  if (dish.tags.length > 0) {
    tagsHtml = `<div class="sheet-dish__tags">
      ${dish.tags
        .map((tag) => {
          const normalized = tag.toLowerCase().replace(/[^a-z]/g, "");
          const config =
            typeof TAGS_CONFIG !== "undefined" && TAGS_CONFIG[normalized];
          const bg = config ? config.bg : "var(--color-primary-light)";
          const color = config ? config.color : "var(--color-text)";
          const label = config ? config.label : tag;
          return `<span class="tag-badge" style="background:${bg};color:${color}">${label}</span>`;
        })
        .join("")}
    </div>`;
  }

  let variantsHtml = "";
  if (dish.variants.length > 0) {
    variantsHtml = `
      <div class="sheet-dish__variants">
        <p class="sheet-dish__label">Izaberite varijantu:</p>
        <div class="sheet-dish__variant-list">
          ${dish.variants
            .map(
              (v, i) => `
            <button class="sheet-dish__variant-btn" data-variant="${i}">
              <span>${v.label}</span>
              <span class="sheet-dish__variant-price">${formatPrice(v.price)}</span>
            </button>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  let allergensHtml = "";
  if (dish.allergens) {
    allergensHtml = `<p class="sheet-dish__allergens">⚠ ${escapeHtml(dish.allergens)}</p>`;
  }

  let ingredientsHtml = "";
  if (dish.ingredients) {
    ingredientsHtml = `<p class="sheet-dish__ingredients"><strong>Sastojci:</strong> ${escapeHtml(dish.ingredients)}</p>`;
  }

  content.innerHTML = `
    <div class="sheet-dish">
      <div class="sheet-dish__image-wrap">
        <img class="sheet-dish__image" src="${imgSrc}" alt="${escapeHtml(dish.name)}"
          onerror="this.src='${CONFIG.PLACEHOLDER_IMAGE}'">
      </div>
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

  // Bind add button (no variants)
  const addBtn = document.getElementById("dish-add-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      addToCart(dish, null);
      animateAddFeedback(addBtn);
    });
  }

  // Bind variant buttons
  content.querySelectorAll(".sheet-dish__variant-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const vi = parseInt(btn.dataset.variant, 10);
      addToCart(dish, vi);
      animateAddFeedback(btn);
    });
  });

  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add("sheet-overlay--open"));
}

function closeDishSheet() {
  const overlay = document.getElementById("dish-sheet-overlay");
  overlay.classList.remove("sheet-overlay--open");
  setTimeout(() => {
    overlay.hidden = true;
  }, 300);
}

function animateAddFeedback(btn) {
  const original = btn.textContent;
  btn.textContent = "✓ Dodato";
  btn.classList.add("sheet-dish__add-btn--added");
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("sheet-dish__add-btn--added");
  }, 1000);
}

// ----------------------------------------------------------
// 4. CART BOTTOM SHEET
// ----------------------------------------------------------
function createCartSheet() {
  const overlay = document.createElement("div");
  overlay.id = "cart-sheet-overlay";
  overlay.className = "sheet-overlay";
  overlay.hidden = true;

  overlay.innerHTML = `
    <div class="sheet sheet--tall" id="cart-sheet">
      <div class="sheet__handle"></div>
      <div class="sheet__content" id="cart-sheet-content"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeCartSheet();
  });
}

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
    content.innerHTML = `
      <h2 class="cart-header">Vaša narudžbina</h2>
      <div class="cart-items" id="cart-items">
        ${cart
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
      <div class="cart-footer">
        <div class="cart-total">
          <span>Ukupno:</span>
          <span class="cart-total__price">${formatPrice(getCartTotal())}</span>
        </div>
        <button class="cart-waiter-btn" id="cart-waiter-btn">Pokaži konobaru</button>
        <button class="cart-clear-btn" id="cart-clear-btn">Obriši sve</button>
      </div>
    `;

    // Bind quantity buttons
    content.querySelectorAll(".cart-item__qty-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.closest(".cart-item").dataset.key;
        const delta = btn.dataset.action === "plus" ? 1 : -1;
        updateCartQty(key, delta);
        openCartSheet(); // re-render
      });
    });

    // Bind waiter button
    document.getElementById("cart-waiter-btn").addEventListener("click", () => {
      closeCartSheet();
      setTimeout(openWaiterSummary, 300);
    });

    // Bind clear button
    document.getElementById("cart-clear-btn").addEventListener("click", () => {
      clearCart();
      openCartSheet(); // re-render as empty
    });
  }

  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add("sheet-overlay--open"));
}

function closeCartSheet() {
  const overlay = document.getElementById("cart-sheet-overlay");
  overlay.classList.remove("sheet-overlay--open");
  setTimeout(() => {
    overlay.hidden = true;
  }, 300);
}

// ----------------------------------------------------------
// 5. WAITER SUMMARY (FULLSCREEN)
// ----------------------------------------------------------
function createWaiterSummary() {
  const screen = document.createElement("div");
  screen.id = "waiter-summary";
  screen.className = "waiter-summary";
  screen.hidden = true;
  document.body.appendChild(screen);
}

function openWaiterSummary() {
  const screen = document.getElementById("waiter-summary");

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
        ${cart
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

function closeWaiterSummary() {
  const screen = document.getElementById("waiter-summary");
  screen.classList.remove("waiter-summary--open");
  setTimeout(() => {
    screen.hidden = true;
  }, 300);
}

// ----------------------------------------------------------
// 6. WIRE UP DISH CARD TAPS
// ----------------------------------------------------------
function makeDishCardTappable(card, dish) {
  card.style.cursor = "pointer";
  card.addEventListener("click", () => openDishSheet(dish));
}
