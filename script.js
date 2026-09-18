document.addEventListener('DOMContentLoaded', () => {
    // Polyfill requestIdleCallback if needed
    if (typeof window.requestIdleCallback !== 'function') {
        window.requestIdleCallback = function (cb, opts) {
            const timeout = (opts && opts.timeout) || 50;
            return setTimeout(function () {
                const start = Date.now();
                cb({
                    didTimeout: false,
                    timeRemaining: function () {
                        return Math.max(0, 50 - (Date.now() - start));
                    }
                });
            }, 1);
        };
        window.cancelIdleCallback = function (id) {
            clearTimeout(id);
        };
    }

    // =========================================================================
    // API & CONFIGURATION
    // =========================================================================
    let BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? ''
        : 'https://knd-stock.onrender.com';

    // =========================================================================
    // DOM ELEMENTS
    // =========================================================================
    // Screens & Top Navigation Tabs
    const catalogView = document.getElementById('catalog-view');
    const watchlistView = document.getElementById('watchlist-view');
    const tabCatalogBtn = document.getElementById('tab-catalog-btn');
    const tabWatchlistBtn = document.getElementById('tab-watchlist-btn');
    const watchlistCountBadge = document.getElementById('watchlist-count-badge');
    const logoutBtn = document.getElementById('logout-btn');
    const lockBtnText = document.getElementById('lock-btn-text');

    // Catalog Controls & Elements
    const catalogSearchInput = document.getElementById('catalog-search-input');
    const catalogClearSearch = document.getElementById('catalog-clear-search');
    const catalogSearchBtn = document.getElementById('catalog-search-btn');
    const searchSpinner = document.getElementById('search-spinner');

    const filterCategory = document.getElementById('filter-category');
    const filterBrand = document.getElementById('filter-brand');
    const filterSubcategory = document.getElementById('filter-subcategory');
    const catalogSortSelect = document.getElementById('catalog-sort-select');
    const filterResetBtn = document.getElementById('filter-reset-btn');

    const catalogCountText = document.getElementById('catalog-count-text');
    const catalogActiveFilterTags = document.getElementById('catalog-active-filter-tags');
    const catalogRefreshBtn = document.getElementById('catalog-refresh-btn');

    const catalogLoading = document.getElementById('catalog-loading');
    const catalogEmpty = document.getElementById('catalog-empty');
    const catalogEmptyResetBtn = document.getElementById('catalog-empty-reset-btn');
    const catalogGrid = document.getElementById('catalog-grid');
    const catalogPagination = document.getElementById('catalog-pagination');

    // Dedicated Watchlist Screen Elements
    const watchlistBackBtn = document.getElementById('watchlist-back-btn');
    const watchlistTotalCount = document.getElementById('watchlist-total-count');
    const watchlistCheckAllBtn = document.getElementById('watchlist-check-all-btn');
    const watchlistCheckBtnText = document.getElementById('watchlist-check-btn-text');
    const watchlistExportBtn = document.getElementById('watchlist-export-btn');
    const watchlistImportBtn = document.getElementById('watchlist-import-btn');
    const watchlistFileInput = document.getElementById('watchlist-file-input');
    const watchlistClearAllBtn = document.getElementById('watchlist-clear-all-btn');
    const watchlistFilterInput = document.getElementById('watchlist-filter-input');
    const watchlistProgressWrap = document.getElementById('watchlist-progress-wrap');
    const watchlistProgressFill = document.getElementById('watchlist-progress-fill');
    const watchlistProgressText = document.getElementById('watchlist-progress-text');
    const watchlistEmpty = document.getElementById('watchlist-empty');
    const watchlistExploreBtn = document.getElementById('watchlist-explore-btn');
    const watchlistList = document.getElementById('watchlist-list');

    // Auth Gate Elements
    const authGateModal = document.getElementById('auth-gate-modal');
    const gateForm = document.getElementById('gate-login-form');
    const gateInput = document.getElementById('gate-password-input');
    const gateToggleBtn = document.getElementById('gate-toggle-pw-btn');
    const gateToggleIcon = document.getElementById('gate-toggle-pw-icon');
    const gateSubmitBtn = document.getElementById('gate-submit-btn');
    const gateBtnSpinner = document.getElementById('gate-btn-spinner');
    const gateError = document.getElementById('gate-error');
    const gateErrorMsg = document.getElementById('gate-error-msg');

    // Toast Container
    const toastContainer = document.getElementById('toast-container');

    // =========================================================================
    // STATE
    // =========================================================================
    const catalogState = {
        page: 1,
        limit: 24,
        category: 'cars',
        brand: 'all',
        subcategory: 'all',
        sort: 'latest',
        search: '',
        totalPages: 1,
        totalCount: 0,
        loading: false
    };

    let liveCategoriesTree = [];
    let isCheckingWatchlist = false;
    let isAppInitialized = false;

    // =========================================================================
    // UTILITIES
    // =========================================================================
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function showToast(msg, type = 'info') {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        const icon = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info');
        toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(msg)}</span>`;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, 2800);
    }

    function formatProductTitle(title) {
        if (!title) return 'Diecast Model';
        let clean = title.replace(/\s+/g, ' ').trim();
        return clean;
    }

    function parseUrlTitle(url) {
        try {
            const parsed = new URL(url);
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (parts.length > 0) {
                let slug = parts[parts.length - 1];
                if (slug.length > 30 && parts.length > 1) {
                    slug = parts[parts.length - 2];
                }
                return slug.replace(/[-_+]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            }
        } catch { }
        return 'Diecast Casting';
    }

    function isKndUrl(str) {
        if (!str) return false;
        return str.includes('karzanddolls.com') || str.startsWith('/details/') || str.startsWith('details/');
    }

    // =========================================================================
    // AUTHENTICATION & SESSION
    // =========================================================================
    function getAuthToken() {
        return localStorage.getItem('knd_session_token') || '';
    }

    function setAuthToken(token) {
        if (token) {
            localStorage.setItem('knd_session_token', token);
            document.body.classList.remove('not-authenticated');
        } else {
            localStorage.removeItem('knd_session_token');
            document.body.classList.add('not-authenticated');
        }
        updateLockBtnState();
    }

    function getAuthHeaders(extraHeaders = {}) {
        const token = getAuthToken();
        const headers = { ...extraHeaders };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    function updateLockBtnState() {
        if (!logoutBtn) return;
        const token = getAuthToken();
        if (token) {
            logoutBtn.title = "Lock session";
            if (lockBtnText) lockBtnText.textContent = "Lock";
        } else {
            logoutBtn.title = "Unlock session";
            if (lockBtnText) lockBtnText.textContent = "Unlock";
        }
    }

    function enforceAuthenticated() {
        document.body.classList.remove('not-authenticated');
        hideAuthGate();
        updateLockBtnState();
    }

    function enforceUnauthenticated() {
        setAuthToken('');
        isAppInitialized = false;
        document.body.classList.add('not-authenticated');
        showAuthGate();
        updateLockBtnState();
    }

    function handleApiUnauthorized() {
        enforceUnauthenticated();
        showToast('Authentication required. Please enter password.', 'error');
    }

    function showAuthGate() {
        if (authGateModal) {
            authGateModal.classList.remove('hidden');
            authGateModal.style.display = 'flex';
            if (gateError) gateError.classList.remove('visible');
            if (gateInput) {
                gateInput.value = '';
                setTimeout(() => gateInput.focus(), 150);
            }
        }
        updateLockBtnState();
    }

    function hideAuthGate() {
        if (authGateModal) {
            authGateModal.classList.add('hidden');
            authGateModal.style.display = 'none';
        }
        updateLockBtnState();
    }

    if (!getAuthToken()) {
        enforceUnauthenticated();
    } else {
        updateLockBtnState();
    }

    if (gateToggleBtn && gateInput) {
        gateToggleBtn.addEventListener('click', () => {
            const isPw = gateInput.type === 'password';
            gateInput.type = isPw ? 'text' : 'password';
            gateToggleIcon.className = isPw ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
            gateInput.focus();
        });
    }

    if (gateForm) {
        gateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = (gateInput.value || '').trim();
            if (!password) return;

            if (gateError) gateError.classList.remove('visible');
            gateSubmitBtn.disabled = true;
            if (gateBtnSpinner) gateBtnSpinner.style.display = 'block';

            try {
                const res = await fetch(`${BACKEND_URL}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                    credentials: 'include'
                });
                const data = await res.json();
                if (res.ok && data.success && data.token) {
                    setAuthToken(data.token);
                    enforceAuthenticated();
                    showToast('Access unlocked! Session active for 7 days.', 'success');
                    initApp();
                } else {
                    if (gateError) {
                        if (gateErrorMsg) gateErrorMsg.textContent = data.message || 'Incorrect password.';
                        gateError.classList.add('visible');
                    }
                    if (gateInput) {
                        gateInput.value = '';
                        gateInput.focus();
                    }
                }
            } catch {
                if (gateError) {
                    if (gateErrorMsg) gateErrorMsg.textContent = 'Network error while contacting server.';
                    gateError.classList.add('visible');
                }
            } finally {
                gateSubmitBtn.disabled = false;
                if (gateBtnSpinner) gateBtnSpinner.style.display = 'none';
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const token = getAuthToken();
            if (!token) {
                enforceUnauthenticated();
                return;
            }
            if (confirm('Lock this session? You will need to enter the password to check stock.')) {
                try {
                    await fetch(`${BACKEND_URL}/api/logout`, {
                        method: 'POST',
                        credentials: 'include'
                    });
                } catch { }
                enforceUnauthenticated();
                showToast('Session locked.', 'info');
            }
        });
    }

    // =========================================================================
    // VIEW SWITCHING (Catalog vs Dedicated Watchlist Screen)
    // =========================================================================
    function switchView(viewName) {
        if (document.body.classList.contains('not-authenticated')) {
            showAuthGate();
            return;
        }
        if (viewName === 'watchlist') {
            catalogView.classList.add('hidden');
            watchlistView.classList.remove('hidden');
            tabCatalogBtn.classList.remove('active');
            tabWatchlistBtn.classList.add('active');
            renderWatchlistUI();
            window.location.hash = 'watchlist';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            watchlistView.classList.add('hidden');
            catalogView.classList.remove('hidden');
            tabWatchlistBtn.classList.remove('active');
            tabCatalogBtn.classList.add('active');
            window.location.hash = 'catalog';
        }
    }

    if (tabCatalogBtn) tabCatalogBtn.addEventListener('click', () => switchView('catalog'));
    if (tabWatchlistBtn) tabWatchlistBtn.addEventListener('click', () => switchView('watchlist'));
    if (watchlistBackBtn) watchlistBackBtn.addEventListener('click', () => switchView('catalog'));
    if (watchlistExploreBtn) watchlistExploreBtn.addEventListener('click', () => switchView('catalog'));

    // Handle initial URL hash
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#watchlist') {
            switchView('watchlist');
        } else {
            switchView('catalog');
        }
    });

    // =========================================================================
    // WATCHLIST SYSTEM (LocalStorage + JSON Export/Import + Live Re-check)
    // =========================================================================
    const WATCHLIST_KEY = 'knd_watchlist_v1';

    function getWatchlist() {
        try {
            const raw = localStorage.getItem(WATCHLIST_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function saveWatchlist(list) {
        try {
            localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
            updateWatchlistBadge();
        } catch { }
    }

    function isWatchlisted(url) {
        if (!url) return false;
        return getWatchlist().some(item => item.url === url);
    }

    function toggleWatchlistItem(product) {
        if (!product || !product.url) return false;
        let list = getWatchlist();
        const existingIdx = list.findIndex(x => x.url === product.url);
        let added = false;

        if (existingIdx > -1) {
            list.splice(existingIdx, 1);
            added = false;
        } else {
            list.unshift({
                url: product.url,
                product_name: product.product_name || parseUrlTitle(product.url),
                image: product.image || '',
                price: product.price || '',
                last_stock: typeof product.stock_quantity === 'number' ? product.stock_quantity : (product.last_stock || 0),
                prev_stock: typeof product.stock_quantity === 'number' ? product.stock_quantity : (product.prev_stock || 0),
                last_checked: Date.now()
            });
            added = true;
        }

        saveWatchlist(list);
        updateAllCardStarStates();
        renderWatchlistUI();
        return added;
    }

    function updateWatchlistBadge() {
        if (!watchlistCountBadge) return;
        const count = getWatchlist().length;
        watchlistCountBadge.textContent = count;
        if (watchlistTotalCount) {
            watchlistTotalCount.textContent = `${count} item${count === 1 ? '' : 's'}`;
        }
    }

    function updateAllCardStarStates() {
        document.querySelectorAll('.card-star-btn').forEach(star => {
            const card = star.closest('.result-card');
            const cardUrl = card ? card.getAttribute('data-url') : null;
            if (cardUrl) {
                const saved = isWatchlisted(cardUrl);
                star.classList.toggle('is-active', saved);
                star.title = saved ? 'Remove from Watchlist' : 'Save to Watchlist';
                star.innerHTML = `<i class="${saved ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>`;
            }
        });
    }

    function updateWatchlistCardElement(card, item) {
        if (!card) return;
        const inStock = item.last_stock > 0 || item.last_stock === -1;
        const isLow = item.last_stock > 0 && item.last_stock <= 3;
        const isUnknownQty = item.last_stock === -1;
        const isRestocked = item.prev_stock === 0 && inStock;

        const bannerClass = inStock ? (isLow ? 'stock-banner--low' : 'stock-banner--in') : 'stock-banner--out';
        const statusLabel = inStock ? (isLow ? 'Low Stock' : 'In Stock') : 'Out of Stock';
        const icon = inStock ? (isLow ? 'fa-bolt' : 'fa-circle-check') : 'fa-circle-xmark';
        const qtyText = inStock ? (isUnknownQty ? 'Available' : `${item.last_stock} available`) : '0 available';

        const banner = card.querySelector('.stock-banner');
        if (banner) {
            banner.className = `stock-banner ${bannerClass}`;
            const statusDiv = banner.querySelector('.stock-banner__status');
            if (statusDiv) {
                const restockTag = isRestocked ? '<span class="restock-badge"><i class="fa-solid fa-sparkles"></i> Restocked!</span>' : '';
                statusDiv.innerHTML = `<i class="fa-solid ${icon}"></i><span>${statusLabel}</span>${restockTag}`;
            }
            const countSpan = banner.querySelector('.stock-banner__count');
            if (countSpan) {
                countSpan.textContent = qtyText;
            }
        }

        if (item.image) {
            const showcase = card.querySelector('.card-showcase');
            const placeholder = showcase ? showcase.querySelector('.card-showcase-placeholder') : null;
            if (placeholder) {
                placeholder.remove();
                const img = document.createElement('img');
                img.src = item.image;
                img.className = 'card-showcase-img';
                img.alt = item.product_name || 'Diecast Model';
                img.loading = 'lazy';
                showcase.appendChild(img);
            }
        }
    }

    function renderWatchlistUI() {
        if (!watchlistList || !watchlistEmpty) return;
        const query = (watchlistFilterInput ? watchlistFilterInput.value : '').toLowerCase().trim();
        let list = getWatchlist();

        if (query) {
            list = list.filter(item => (item.product_name || '').toLowerCase().includes(query));
        }

        if (list.length === 0) {
            watchlistEmpty.classList.remove('hidden');
            watchlistList.innerHTML = '';
            return;
        }

        watchlistEmpty.classList.add('hidden');
        watchlistList.innerHTML = '';

        list.forEach(item => {
            const card = document.createElement('div');
            card.className = 'result-card';
            card.setAttribute('data-url', item.url);

            const inStock = item.last_stock > 0 || item.last_stock === -1;
            const isUnknownQty = item.last_stock === -1;
            const isRestocked = item.prev_stock === 0 && inStock;

            const imgHtml = item.image
                ? `<img src="${escapeHtml(item.image)}" class="card-showcase-img" alt="${escapeHtml(item.product_name)}" loading="lazy" />`
                : `<div class="card-showcase-placeholder"><i class="fa-solid fa-car"></i></div>`;

            const priceHtml = item.price ? `<div class="floating-price-tag">${escapeHtml(item.price)}</div>` : '';

            const bannerClass = inStock ? (item.last_stock > 0 && item.last_stock <= 3 ? 'stock-banner--low' : 'stock-banner--in') : 'stock-banner--out';
            const statusLabel = inStock ? (item.last_stock > 0 && item.last_stock <= 3 ? 'Low Stock' : 'In Stock') : 'Out of Stock';
            const icon = inStock ? (item.last_stock > 0 && item.last_stock <= 3 ? 'fa-bolt' : 'fa-circle-check') : 'fa-circle-xmark';
            const qtyText = inStock ? (isUnknownQty ? 'Available' : `${item.last_stock} available`) : '0 available';
            const restockTag = isRestocked ? '<span class="restock-badge"><i class="fa-solid fa-sparkles"></i> Restocked!</span>' : '';

            card.innerHTML = `
                <div class="card-showcase">
                    ${priceHtml}
                    ${imgHtml}
                </div>
                <div class="card-details">
                    <div class="card-title" title="${escapeHtml(item.product_name)}">${escapeHtml(formatProductTitle(item.product_name))}</div>
                    <div class="stock-banner ${bannerClass}">
                        <div class="stock-banner__status">
                            <i class="fa-solid ${icon}"></i>
                            <span>${statusLabel}</span>
                            ${restockTag}
                        </div>
                        <div class="stock-banner__qty">
                            <span class="stock-banner__count">${qtyText}</span>
                        </div>
                    </div>
                </div>
                <div class="card-footer">
                    <a href="${escapeHtml(item.url)}" target="_blank" class="cta-btn cta-btn--primary" title="View on Karz and Dolls">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> View Store
                    </a>
                    <button type="button" class="wl-single-check-btn" title="Check live stock now">
                        <i class="fa-solid fa-rotate-right"></i> Check
                    </button>
                    <button type="button" class="wl-remove-btn" title="Remove from Watchlist">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;

            // Single check button with width lock and in-place DOM update
            const singleCheckBtn = card.querySelector('.wl-single-check-btn');
            singleCheckBtn.addEventListener('click', async () => {
                if (document.body.classList.contains('not-authenticated')) {
                    showAuthGate();
                    return;
                }
                const btnW = singleCheckBtn.offsetWidth;
                if (btnW > 0) singleCheckBtn.style.minWidth = `${btnW}px`;
                const origHtml = singleCheckBtn.innerHTML;
                singleCheckBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking…`;
                singleCheckBtn.disabled = true;

                try {
                    const res = await fetch(`${BACKEND_URL}/api/check-stock?url=${encodeURIComponent(item.url)}`, {
                        credentials: 'include',
                        headers: getAuthHeaders()
                    });
                    if (res.status === 401) {
                        handleApiUnauthorized();
                        return;
                    }
                    const data = await res.json();
                    if (data.success) {
                        item.prev_stock = item.last_stock;
                        item.last_stock = data.stock_quantity;
                        if (data.image && !item.image) item.image = data.image;
                        saveWatchlist(list);

                        // In-place DOM update prevents view shrinking/jumping
                        updateWatchlistCardElement(card, item);
                        showToast(data.stock_quantity === -1 ? 'In Stock (qty hidden by store)' : `Updated stock: ${data.stock_quantity} available`, 'success');
                    } else {
                        showToast(data.message || 'Lookup failed', 'error');
                    }
                } catch {
                    showToast('Failed to check stock', 'error');
                } finally {
                    singleCheckBtn.disabled = false;
                    singleCheckBtn.innerHTML = origHtml;
                    singleCheckBtn.style.minWidth = '';
                }
            });

            // Remove button
            const removeBtn = card.querySelector('.wl-remove-btn');
            removeBtn.addEventListener('click', () => {
                toggleWatchlistItem(item);
                showToast('Removed from Watchlist', 'info');
            });

            watchlistList.appendChild(card);
        });
    }

    if (watchlistFilterInput) {
        watchlistFilterInput.addEventListener('input', () => {
            renderWatchlistUI();
        });
    }

    // Watchlist JSON Export
    if (watchlistExportBtn) {
        watchlistExportBtn.addEventListener('click', () => {
            if (document.body.classList.contains('not-authenticated')) {
                showAuthGate();
                return;
            }
            const list = getWatchlist();
            if (list.length === 0) {
                showToast('Your watchlist is empty to export.', 'info');
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(list, null, 2));
            const downloadAnchor = document.createElement('a');
            const dateStr = new Date().toISOString().slice(0, 10);
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `knd-watchlist-${dateStr}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            showToast(`Exported ${list.length} watchlist items!`, 'success');
        });
    }

    // Watchlist JSON Import
    if (watchlistImportBtn && watchlistFileInput) {
        watchlistImportBtn.addEventListener('click', () => {
            if (document.body.classList.contains('not-authenticated')) {
                showAuthGate();
                return;
            }
            watchlistFileInput.click();
        });

        watchlistFileInput.addEventListener('change', (e) => {
            if (document.body.classList.contains('not-authenticated')) {
                showAuthGate();
                return;
            }
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const imported = JSON.parse(event.target.result);
                    if (Array.isArray(imported)) {
                        let existing = getWatchlist();
                        let addedCount = 0;
                        imported.forEach(it => {
                            if (it.url && !existing.some(x => x.url === it.url)) {
                                existing.unshift({
                                    url: it.url,
                                    product_name: it.product_name || parseUrlTitle(it.url),
                                    image: it.image || '',
                                    price: it.price || '',
                                    last_stock: it.last_stock || 0,
                                    prev_stock: it.prev_stock || 0,
                                    last_checked: Date.now()
                                });
                                addedCount++;
                            }
                        });
                        saveWatchlist(existing);
                        renderWatchlistUI();
                        updateAllCardStarStates();
                        showToast(`Imported ${addedCount} items into watchlist!`, 'success');
                    } else {
                        showToast('Invalid watchlist JSON structure.', 'error');
                    }
                } catch {
                    showToast('Failed to parse JSON file.', 'error');
                }
            };
            reader.readAsText(file);
            watchlistFileInput.value = '';
        });
    }

    // Watchlist Clear All
    if (watchlistClearAllBtn) {
        watchlistClearAllBtn.addEventListener('click', () => {
            if (document.body.classList.contains('not-authenticated')) {
                showAuthGate();
                return;
            }
            const list = getWatchlist();
            if (list.length === 0) return;
            if (confirm(`Remove all ${list.length} items from your watchlist?`)) {
                saveWatchlist([]);
                renderWatchlistUI();
                updateAllCardStarStates();
                showToast('Watchlist cleared.', 'info');
            }
        });
    }

    // Watchlist Check All Stock Now
    if (watchlistCheckAllBtn) {
        watchlistCheckAllBtn.addEventListener('click', async () => {
            if (document.body.classList.contains('not-authenticated')) {
                showAuthGate();
                return;
            }
            const list = getWatchlist();
            if (list.length === 0) {
                showToast('Watchlist is empty. Add some items to check stock.', 'info');
                return;
            }
            if (isCheckingWatchlist) return;

            const origBtnW = watchlistCheckAllBtn.offsetWidth;
            if (origBtnW > 0) watchlistCheckAllBtn.style.minWidth = `${origBtnW}px`;

            isCheckingWatchlist = true;
            watchlistCheckAllBtn.disabled = true;
            if (watchlistCheckBtnText) watchlistCheckBtnText.textContent = 'Checking Stock…';
            if (watchlistProgressWrap) watchlistProgressWrap.classList.remove('hidden');

            let completed = 0;
            let inStockCount = 0;
            let restockedCount = 0;
            const total = list.length;

            const updateProg = () => {
                const pct = Math.round((completed / total) * 100);
                if (watchlistProgressFill) watchlistProgressFill.style.width = `${pct}%`;
                if (watchlistProgressText) watchlistProgressText.textContent = `${completed} / ${total}`;
            };
            updateProg();

            const queue = [...list];
            const CONCURRENCY = 3;

            async function worker() {
                while (queue.length > 0) {
                    const item = queue.shift();
                    try {
                        const res = await fetch(`${BACKEND_URL}/api/check-stock?url=${encodeURIComponent(item.url)}`, {
                            credentials: 'include',
                            headers: getAuthHeaders()
                        });
                        if (res.status === 401) {
                            handleApiUnauthorized();
                            return;
                        }
                        const data = await res.json();
                        if (data.success) {
                            if (item.last_stock === 0 && (data.stock_quantity > 0 || data.stock_quantity === -1)) {
                                restockedCount++;
                            }
                            item.prev_stock = item.last_stock;
                            item.last_stock = data.stock_quantity;
                            if (data.image && !item.image) item.image = data.image;
                            if (data.stock_quantity > 0 || data.stock_quantity === -1) inStockCount++;
                        }
                    } catch { }
                    completed++;
                    updateProg();
                    await new Promise(r => setTimeout(r, 150));
                }
            }

            const workers = Array(Math.min(CONCURRENCY, total)).fill(null).map(() => worker());
            await Promise.all(workers);

            saveWatchlist(list);
            renderWatchlistUI();

            isCheckingWatchlist = false;
            watchlistCheckAllBtn.disabled = false;
            if (watchlistCheckBtnText) watchlistCheckBtnText.textContent = 'Check All Stock Now';
            watchlistCheckAllBtn.style.minWidth = '';
            setTimeout(() => {
                if (watchlistProgressWrap) watchlistProgressWrap.classList.add('hidden');
            }, 1200);

            let msg = `Check complete! ${inStockCount} of ${total} in stock.`;
            if (restockedCount > 0) msg += ` 🎉 ${restockedCount} Restocked!`;
            showToast(msg, 'success');
        });
    }

    // =========================================================================
    // CATEGORIES TREE & 3-TIER DROPDOWNS
    // =========================================================================
    async function fetchCategoriesTree() {
        try {
            const res = await fetch(`${BACKEND_URL}/api/categories`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.status === 401) {
                handleApiUnauthorized();
                return;
            }
            const json = await res.json();
            if (json.success && Array.isArray(json.categories)) {
                liveCategoriesTree = json.categories;
                populateBrandDropdown(true);
                populateSubcategoryDropdown(true);
            }
        } catch (err) {
            console.warn('Could not fetch categories tree', err);
        }
    }

    function getSelectedCategoryObj() {
        const catSlug = filterCategory ? filterCategory.value : 'cars';
        return liveCategoriesTree.find(c => c.slug === catSlug) || null;
    }

    function populateBrandDropdown(forceSelectFirst = false) {
        if (!filterBrand) return;
        const previousBrand = filterBrand.value;
        filterBrand.innerHTML = '';

        const catObj = getSelectedCategoryObj();
        if (catObj && Array.isArray(catObj.subcategories) && catObj.subcategories.length > 0) {
            catObj.subcategories.forEach(sub => {
                const opt = document.createElement('option');
                opt.value = sub.slug;
                opt.textContent = sub.name;
                filterBrand.appendChild(opt);
            });
        }

        const hasPrevious = !forceSelectFirst && Array.from(filterBrand.options).some(o => o.value === previousBrand);
        if (hasPrevious) {
            filterBrand.value = previousBrand;
        } else if (filterBrand.options.length > 0) {
            filterBrand.value = filterBrand.options[0].value;
        } else {
            filterBrand.value = '';
        }
        catalogState.brand = filterBrand.value;
    }

    function populateSubcategoryDropdown(forceSelectFirst = false) {
        if (!filterSubcategory) return;
        const previousSub = filterSubcategory.value;
        filterSubcategory.innerHTML = '';

        const catObj = getSelectedCategoryObj();
        const brandSlug = filterBrand ? filterBrand.value : '';

        if (catObj && brandSlug) {
            const brandObj = (catObj.subcategories || []).find(s => s.slug === brandSlug);
            if (brandObj) {
                if (Array.isArray(brandObj.series) && brandObj.series.length > 0) {
                    brandObj.series.forEach(ser => {
                        const opt = document.createElement('option');
                        opt.value = ser.slug || brandSlug;
                        opt.textContent = ser.name;
                        filterSubcategory.appendChild(opt);
                    });
                }
                if (filterSubcategory.options.length === 0) {
                    const opt = document.createElement('option');
                    opt.value = brandObj.slug || brandSlug;
                    opt.textContent = brandObj.name;
                    filterSubcategory.appendChild(opt);
                }
            }
        }

        const hasPrevious = !forceSelectFirst && Array.from(filterSubcategory.options).some(o => o.value === previousSub);
        if (hasPrevious) {
            filterSubcategory.value = previousSub;
        } else if (filterSubcategory.options.length > 0) {
            filterSubcategory.value = filterSubcategory.options[0].value;
        } else {
            filterSubcategory.value = '';
        }
        catalogState.subcategory = filterSubcategory.value;
    }

    // Filter event listeners
    if (filterCategory) {
        filterCategory.addEventListener('change', () => {
            catalogState.category = filterCategory.value;
            populateBrandDropdown(true);
            populateSubcategoryDropdown(true);
            catalogState.page = 1;
            fetchCatalog();
        });
    }

    if (filterBrand) {
        filterBrand.addEventListener('change', () => {
            catalogState.brand = filterBrand.value;
            populateSubcategoryDropdown(true);
            catalogState.page = 1;
            fetchCatalog();
        });
    }

    if (filterSubcategory) {
        filterSubcategory.addEventListener('change', () => {
            catalogState.subcategory = filterSubcategory.value;
            catalogState.page = 1;
            fetchCatalog();
        });
    }

    if (catalogSortSelect) {
        catalogSortSelect.addEventListener('change', () => {
            catalogState.sort = catalogSortSelect.value;
            catalogState.page = 1;
            fetchCatalog();
        });
    }

    if (filterResetBtn) {
        filterResetBtn.addEventListener('click', () => {
            resetCatalogFilters();
        });
    }

    if (catalogEmptyResetBtn) {
        catalogEmptyResetBtn.addEventListener('click', () => {
            resetCatalogFilters();
        });
    }

    function resetCatalogFilters() {
        if (filterCategory) filterCategory.value = 'cars';
        catalogState.category = 'cars';
        populateBrandDropdown(true);
        populateSubcategoryDropdown(true);
        if (catalogSortSelect) catalogSortSelect.value = 'latest';
        catalogState.sort = 'latest';
        if (catalogSearchInput) catalogSearchInput.value = '';
        if (catalogClearSearch) catalogClearSearch.classList.add('hidden');
        catalogState.search = '';
        catalogState.page = 1;
        fetchCatalog();
    }

    if (catalogRefreshBtn) {
        catalogRefreshBtn.addEventListener('click', () => {
            fetchCatalog();
        });
    }

    // =========================================================================
    // SEARCH & DIRECT LINK PASTING
    // =========================================================================
    if (catalogSearchInput) {
        catalogSearchInput.addEventListener('input', () => {
            const hasVal = Boolean(catalogSearchInput.value.trim());
            if (catalogClearSearch) catalogClearSearch.classList.toggle('hidden', !hasVal);
        });

        catalogSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSearchOrLookup();
            }
        });
    }

    if (catalogClearSearch) {
        catalogClearSearch.addEventListener('click', () => {
            catalogSearchInput.value = '';
            catalogClearSearch.classList.add('hidden');
            catalogState.search = '';
            catalogState.page = 1;
            fetchCatalog();
        });
    }

    if (catalogSearchBtn) {
        catalogSearchBtn.addEventListener('click', () => {
            handleSearchOrLookup();
        });
    }

    async function handleSearchOrLookup() {
        const query = (catalogSearchInput ? catalogSearchInput.value : '').trim();
        if (!query) {
            catalogState.search = '';
            catalogState.page = 1;
            fetchCatalog();
            return;
        }

        // Case 1: Pasted direct product link
        if (query.includes('/details/') || query.includes('karzanddolls.com/details/')) {
            await lookupSingleDirectLink(query);
            return;
        }

        // Case 2: Pasted category / lineup link (e.g. karzanddolls.com/mini-gt/kaido-house)
        if (query.includes('karzanddolls.com/')) {
            try {
                const u = new URL(query.startsWith('http') ? query : `https://${query}`);
                const parts = u.pathname.split('/').filter(Boolean);
                if (parts.length >= 1) {
                    const candidateBrand = parts[0];
                    const candidateSub = parts[1] || '';

                    // Try to match in dropdowns
                    if (filterBrand) {
                        const opt = Array.from(filterBrand.options).find(o => o.value.toLowerCase() === candidateBrand.toLowerCase());
                        if (opt) {
                            filterBrand.value = opt.value;
                            catalogState.brand = opt.value;
                            populateSubcategoryDropdown();
                        }
                    }
                    if (candidateSub && filterSubcategory) {
                        const subOpt = Array.from(filterSubcategory.options).find(o => o.value.toLowerCase() === candidateSub.toLowerCase());
                        if (subOpt) {
                            filterSubcategory.value = subOpt.value;
                            catalogState.subcategory = subOpt.value;
                        }
                    }
                    catalogState.search = '';
                    catalogState.page = 1;
                    fetchCatalog();
                    showToast(`Loaded collection: ${candidateBrand}${candidateSub ? ' / ' + candidateSub : ''}`, 'info');
                    return;
                }
            } catch { }
        }

        // Case 3: Keyword search
        catalogState.search = query;
        catalogState.page = 1;
        fetchCatalog();
    }

    async function lookupSingleDirectLink(targetUrl) {
        if (document.body.classList.contains('not-authenticated')) {
            showAuthGate();
            return;
        }
        if (catalogGrid) {
            const currentH = catalogGrid.offsetHeight;
            if (currentH > 200) catalogGrid.style.minHeight = `${currentH}px`;
        }
        if (searchSpinner) searchSpinner.classList.remove('hidden');
        const searchIcon = catalogSearchBtn ? catalogSearchBtn.querySelector('.btn-icon') : null;
        if (searchIcon) searchIcon.classList.add('hidden');
        if (catalogSearchBtn) catalogSearchBtn.disabled = true;
        if (catalogLoading) catalogLoading.classList.remove('hidden');
        if (catalogGrid) catalogGrid.innerHTML = '';
        if (catalogPagination) catalogPagination.innerHTML = '';

        try {
            const res = await fetch(`${BACKEND_URL}/api/check-stock?url=${encodeURIComponent(targetUrl)}`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.status === 401) {
                handleApiUnauthorized();
                return;
            }
            const data = await res.json();
            if (catalogLoading) catalogLoading.classList.add('hidden');

            if (data) {
                const product = {
                    product_name: data.product_name || parseUrlTitle(targetUrl),
                    url: targetUrl,
                    stock_quantity: data.stock_quantity != null ? data.stock_quantity : 0,
                    in_stock: Boolean(data.stock_quantity > 0 || data.stock_quantity === -1),
                    price: '',
                    numeric_price: 0.0,
                    image: data.image || '',
                    brand: '',
                    subcategory: ''
                };
                catalogGrid.appendChild(createProductCard(product));
                if (catalogCountText) catalogCountText.textContent = `Showing 1 direct product lookup`;
                const stockMsg = data.stock_quantity === -1 ? 'In Stock (qty hidden by store)' : `Live stock count: ${data.stock_quantity}`;
                showToast(stockMsg, 'success');
            } else {
                if (catalogEmpty) catalogEmpty.classList.remove('hidden');
            }
        } catch {
            showToast('Failed to lookup product URL', 'error');
            if (catalogLoading) catalogLoading.classList.add('hidden');
            if (catalogEmpty) catalogEmpty.classList.remove('hidden');
        } finally {
            if (catalogGrid) catalogGrid.style.minHeight = '';
            if (searchSpinner) searchSpinner.classList.add('hidden');
            if (searchIcon) searchIcon.classList.remove('hidden');
            if (catalogSearchBtn) catalogSearchBtn.disabled = false;
        }
    }

    // =========================================================================
    // CATALOG FETCHER & RENDERER
    // =========================================================================
    async function fetchCatalog() {
        if (document.body.classList.contains('not-authenticated')) {
            showAuthGate();
            return;
        }
        if (catalogState.loading) return;
        catalogState.loading = true;

        if (catalogGrid) {
            const currentH = catalogGrid.offsetHeight;
            if (currentH > 200) catalogGrid.style.minHeight = `${currentH}px`;
        }

        if (catalogLoading) catalogLoading.classList.remove('hidden');
        if (catalogEmpty) catalogEmpty.classList.add('hidden');
        if (catalogGrid) catalogGrid.innerHTML = '';
        if (catalogPagination) catalogPagination.innerHTML = '';
        if (searchSpinner) searchSpinner.classList.remove('hidden');
        const searchIcon = catalogSearchBtn ? catalogSearchBtn.querySelector('.btn-icon') : null;
        if (searchIcon) searchIcon.classList.add('hidden');
        if (catalogSearchBtn) catalogSearchBtn.disabled = true;

        updateActiveFilterTags();

        const params = new URLSearchParams({
            category: catalogState.category,
            brand: catalogState.brand,
            subcategory: catalogState.subcategory === 'all' ? '' : catalogState.subcategory,
            search: catalogState.search,
            sort: catalogState.sort,
            page: catalogState.page,
            limit: catalogState.limit
        });

        try {
            const res = await fetch(`${BACKEND_URL}/api/catalog?${params.toString()}`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });

            if (res.status === 401) {
                handleApiUnauthorized();
                return;
            }

            const data = await res.json();
            if (catalogLoading) catalogLoading.classList.add('hidden');

            if (data.success && Array.isArray(data.products) && data.products.length > 0) {
                catalogState.totalPages = data.total_pages || 1;
                catalogState.totalCount = data.total || data.products.length;

                renderCatalogGrid(data.products);
                renderPagination(data.page, data.total_pages, data.total);

                const startIdx = (data.page - 1) * catalogState.limit + 1;
                const endIdx = Math.min(startIdx + data.products.length - 1, data.total);
                if (catalogCountText) {
                    catalogCountText.textContent = `Showing ${startIdx}–${endIdx} of ${data.total} products`;
                }
            } else {
                if (catalogEmpty) catalogEmpty.classList.remove('hidden');
                if (catalogCountText) catalogCountText.textContent = `0 products found`;
            }
        } catch (err) {
            console.error(err);
            if (catalogLoading) catalogLoading.classList.add('hidden');
            if (catalogEmpty) catalogEmpty.classList.remove('hidden');
            showToast('Network error while connecting to catalog.', 'error');
        } finally {
            catalogState.loading = false;
            if (catalogGrid) catalogGrid.style.minHeight = '';
            if (searchSpinner) searchSpinner.classList.add('hidden');
            if (searchIcon) searchIcon.classList.remove('hidden');
            if (catalogSearchBtn) catalogSearchBtn.disabled = false;
        }
    }

    function updateActiveFilterTags() {
        if (!catalogActiveFilterTags) return;
        catalogActiveFilterTags.innerHTML = '';

        if (catalogState.search) {
            const tag = document.createElement('span');
            tag.className = 'catalog-filter-tag catalog-filter-tag--search';
            tag.innerHTML = `Search: "${escapeHtml(catalogState.search)}" <i class="fa-solid fa-xmark"></i>`;
            tag.title = 'Click to clear search';
            tag.addEventListener('click', () => {
                if (catalogSearchInput) catalogSearchInput.value = '';
                if (catalogClearSearch) catalogClearSearch.classList.add('hidden');
                catalogState.search = '';
                catalogState.page = 1;
                fetchCatalog();
            });
            catalogActiveFilterTags.appendChild(tag);
        }

        if (catalogState.brand && catalogState.brand !== 'all') {
            const tag = document.createElement('span');
            tag.className = 'catalog-filter-tag';
            const brandName = filterBrand?.options[filterBrand.selectedIndex]?.textContent || catalogState.brand;
            tag.textContent = `Brand: ${brandName}`;
            catalogActiveFilterTags.appendChild(tag);
        }

        if (catalogState.subcategory && catalogState.subcategory !== 'all') {
            const tag = document.createElement('span');
            tag.className = 'catalog-filter-tag';
            const subName = filterSubcategory?.options[filterSubcategory.selectedIndex]?.textContent || catalogState.subcategory;
            tag.textContent = `Lineup: ${subName}`;
            catalogActiveFilterTags.appendChild(tag);
        }
    }

    let activeBatchStockController = null;

    function updateCatalogCardStock(card, stockQty) {
        if (!card) return;
        const inStock = stockQty > 0 || stockQty === -1;
        const isLow = stockQty > 0 && stockQty <= 3;
        const isUnknownQty = stockQty === -1;
        const bannerClass = inStock ? (isLow ? 'stock-banner--low' : 'stock-banner--in') : 'stock-banner--out';
        const statusLabel = inStock ? (isLow ? 'Low Stock' : 'In Stock') : 'Out of Stock';
        const icon = inStock ? (isLow ? 'fa-bolt' : 'fa-circle-check') : 'fa-circle-xmark';
        const qtyText = inStock ? (isUnknownQty ? 'Available' : (isLow ? `Only ${stockQty} left` : `${Number(stockQty).toLocaleString()} available`)) : '0 available';

        const banner = card.querySelector('.stock-banner');
        if (banner) {
            banner.className = `stock-banner ${bannerClass}`;
            const statusDiv = banner.querySelector('.stock-banner__status');
            if (statusDiv) {
                const restockTag = banner.querySelector('.restock-badge');
                const restockHtml = restockTag ? restockTag.outerHTML : '';
                statusDiv.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${statusLabel}</span> ${restockHtml}`;
            }
            const countSpan = banner.querySelector('.stock-banner__count');
            if (countSpan) {
                countSpan.textContent = qtyText;
            }
        }

        const ctaBtn = card.querySelector('.cta-btn');
        if (ctaBtn) {
            ctaBtn.className = `cta-btn ${inStock ? 'cta-btn--primary' : 'cta-btn--ghost'}`;
            ctaBtn.innerHTML = `<i class="fa-solid ${inStock ? 'fa-cart-shopping' : 'fa-arrow-up-right-from-square'}"></i> ${inStock ? 'Buy on Store' : 'View on Store'}`;
        }
    }

    async function resolveCatalogStockCounts(products) {
        if (!Array.isArray(products) || !catalogGrid) return;
        const unknownItems = products.filter(p => p.stock_quantity === -1 && p.product_id);
        if (unknownItems.length === 0) return;

        if (activeBatchStockController) {
            activeBatchStockController.abort();
        }
        activeBatchStockController = new AbortController();

        const ids = unknownItems.map(p => p.product_id).join(',');
        try {
            const res = await fetch(`${BACKEND_URL}/api/batch-stock?ids=${ids}`, {
                credentials: 'include',
                headers: getAuthHeaders(),
                signal: activeBatchStockController.signal
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.stocks) {
                Object.entries(data.stocks).forEach(([pidStr, qty]) => {
                    const pid = Number(pidStr);
                    const item = products.find(p => p.product_id === pid);
                    if (item) item.stock_quantity = qty;
                    const card = catalogGrid.querySelector(`[data-product-id="${pid}"]`);
                    if (card) {
                        updateCatalogCardStock(card, qty);
                    }
                });
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                // Silently keep "Available" label
            }
        }
    }

    function renderCatalogGrid(products) {
        if (!catalogGrid) return;
        catalogGrid.innerHTML = '';
        products.forEach(p => {
            catalogGrid.appendChild(createProductCard(p));
        });
        updateAllCardStarStates();
        resolveCatalogStockCounts(products);
    }

    function createProductCard(product) {
        const card = document.createElement('div');
        card.className = 'result-card';
        card.setAttribute('data-url', product.url);
        if (product.product_id) {
            card.setAttribute('data-product-id', product.product_id);
        }

        const inStock = product.stock_quantity > 0 || product.stock_quantity === -1;
        const isLow = product.stock_quantity > 0 && product.stock_quantity <= 3;
        const isUnknownQty = product.stock_quantity === -1;
        const bannerClass = inStock ? (isLow ? 'stock-banner--low' : 'stock-banner--in') : 'stock-banner--out';
        const statusLabel = inStock ? (isLow ? 'Low Stock' : 'In Stock') : 'Out of Stock';
        const icon = inStock ? (isLow ? 'fa-bolt' : 'fa-circle-check') : 'fa-circle-xmark';
        const qtyText = inStock ? (isUnknownQty ? 'Available' : (isLow ? `Only ${product.stock_quantity} left` : `${Number(product.stock_quantity).toLocaleString()} available`)) : '0 available';

        const watchlistItem = getWatchlist().find(w => w.url === product.url);
        const isRestocked = watchlistItem && watchlistItem.prev_stock === 0 && inStock;
        const restockTag = isRestocked ? '<span class="restock-badge"><i class="fa-solid fa-sparkles"></i> Restocked!</span>' : '';

        const priceHtml = product.price ? `<div class="floating-price-tag">${escapeHtml(product.price)}</div>` : '';
        const imgHtml = product.image
            ? `<img src="${escapeHtml(product.image)}" class="card-showcase-img" alt="${escapeHtml(product.product_name)}" loading="lazy" />`
            : `<div class="card-showcase-placeholder"><i class="fa-solid fa-car"></i></div>`;

        const saved = isWatchlisted(product.url);

        card.innerHTML = `
            <div class="card-showcase">
                ${priceHtml}
                ${imgHtml}
            </div>
            <div class="card-details">
                <div class="card-title" title="${escapeHtml(product.product_name)}">${escapeHtml(formatProductTitle(product.product_name))}</div>
                <div class="stock-banner ${bannerClass}">
                    <div class="stock-banner__status">
                        <i class="fa-solid ${icon}"></i>
                        <span>${statusLabel}</span>
                        ${restockTag}
                    </div>
                    <div class="stock-banner__qty">
                        <span class="stock-banner__count">${qtyText}</span>
                    </div>
                </div>
            </div>
            <div class="card-footer">
                <a href="${escapeHtml(product.url)}" target="_blank" class="cta-btn ${inStock ? 'cta-btn--primary' : 'cta-btn--ghost'}" rel="noopener" title="Open on Karz and Dolls">
                    <i class="fa-solid ${inStock ? 'fa-cart-shopping' : 'fa-arrow-up-right-from-square'}"></i> ${inStock ? 'Buy on Store' : 'View on Store'}
                </a>
                <button type="button" class="card-icon-btn card-star-btn ${saved ? 'is-active' : ''}" title="${saved ? 'Remove from Watchlist' : 'Save to Watchlist'}">
                    <i class="${saved ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>
                </button>
                <button type="button" class="card-icon-btn copy-link-btn" title="Copy direct link">
                    <i class="fa-regular fa-clone"></i>
                </button>
            </div>
        `;

        // Star Bookmark Button
        const starBtn = card.querySelector('.card-star-btn');
        starBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const added = toggleWatchlistItem(product);
            showToast(added ? 'Added to Watchlist ⭐' : 'Removed from Watchlist', added ? 'success' : 'info');
        });

        // Copy Link Button
        const copyBtn = card.querySelector('.copy-link-btn');
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (navigator.clipboard) {
                navigator.clipboard.writeText(product.url);
                showToast('Product link copied to clipboard!', 'success');
            }
        });

        return card;
    }

    function renderPagination(currentPage, totalPages, totalCount) {
        if (!catalogPagination) return;
        catalogPagination.innerHTML = '';

        if (totalPages <= 1) return;

        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'page-btn';
        prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
        prevBtn.disabled = currentPage <= 1;
        prevBtn.title = 'Previous Page';
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                catalogState.page = currentPage - 1;
                fetchCatalog();
                window.scrollTo({ top: catalogView.offsetTop - 20, behavior: 'smooth' });
            }
        });
        catalogPagination.appendChild(prevBtn);

        // Page number pills with smart ellipsis
        const pages = [];
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            pages.push(1);
            if (currentPage > 3) pages.push('...');
            const start = Math.max(2, currentPage - 1);
            const end = Math.min(totalPages - 1, currentPage + 1);
            for (let i = start; i <= end; i++) pages.push(i);
            if (currentPage < totalPages - 2) pages.push('...');
            pages.push(totalPages);
        }

        pages.forEach(p => {
            if (p === '...') {
                const ell = document.createElement('span');
                ell.className = 'page-ellipsis';
                ell.textContent = '…';
                catalogPagination.appendChild(ell);
            } else {
                const pBtn = document.createElement('button');
                pBtn.type = 'button';
                pBtn.className = `page-btn ${p === currentPage ? 'active' : ''}`;
                pBtn.textContent = p;
                pBtn.addEventListener('click', () => {
                    if (p !== currentPage) {
                        catalogState.page = p;
                        fetchCatalog();
                        window.scrollTo({ top: catalogView.offsetTop - 20, behavior: 'smooth' });
                    }
                });
                catalogPagination.appendChild(pBtn);
            }
        });

        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'page-btn';
        nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.title = 'Next Page';
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                catalogState.page = currentPage + 1;
                fetchCatalog();
                window.scrollTo({ top: catalogView.offsetTop - 20, behavior: 'smooth' });
            }
        });
        catalogPagination.appendChild(nextBtn);
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    async function initApp() {
        if (isAppInitialized) return;
        isAppInitialized = true;
        updateWatchlistBadge();
        await fetchCategoriesTree();
        await fetchCatalog();
    }

    // Launch initial setup with strict authentication verification
    async function startApplication() {
        const token = getAuthToken();
        if (!token) {
            enforceUnauthenticated();
            return;
        }

        try {
            const res = await fetch(`${BACKEND_URL}/api/auth-status`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            const data = await res.json();
            if (res.ok && data.authenticated) {
                enforceAuthenticated();
                initApp();
            } else {
                enforceUnauthenticated();
            }
        } catch {
            // If network failure on auth check, permit local token and let subsequent API calls validate
            enforceAuthenticated();
            initApp();
        }
    }

    startApplication();
});
