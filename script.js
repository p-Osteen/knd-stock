document.addEventListener('DOMContentLoaded', () => {
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

    const form = document.getElementById('check-form');
    const urlsInput = document.getElementById('product-urls');
    const superInput = document.getElementById('product-urls-input');
    const submitBtn = document.getElementById('submit-btn');
    const btnLoader = document.getElementById('btn-loader');
    
    const searchDropdown = document.getElementById('knd-search-dropdown');
    const searchResultsList = document.getElementById('knd-search-results');

    const toggleBatchBtn = document.getElementById('toggle-batch-btn');
    const batchToggleText = document.getElementById('batch-toggle-text');
    const batchChevron = document.getElementById('batch-chevron');
    const batchPanel = document.getElementById('batch-panel');

    const chipsList = document.getElementById('url-chips-list');
    const chipsScroll = document.getElementById('url-chips-scroll');
    const clearBtn = document.getElementById('clear-btn');
    const pasteBtn = document.getElementById('paste-btn');
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-upload-input');
    const notificationArea = document.getElementById('notification-area');
    const notificationMsg = document.getElementById('notification-msg');
    const urlCounter = document.getElementById('url-counter');
    const charCounter = document.getElementById('char-counter');

    const resultsHeader = document.getElementById('results-header');
    const resultsCount = document.getElementById('results-count');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const retryFailedBtn = document.getElementById('retry-failed-btn');
    const progressIndicator = document.getElementById('progress-indicator');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const resultsToolbar = document.getElementById('results-toolbar');
    const filterInput = document.getElementById('results-filter-input');
    const sortSelect = document.getElementById('results-sort-select');
    const emptyState = document.getElementById('empty-state');
    const resultsGrid = document.getElementById('results-grid');

    let BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '' : 'https://knd-stock.onrender.com';

    let resultsData = [];
    let completedCount = 0;
    let totalCount = 0;
    let urls = [];
    let searchTimer = null;
    let activeFilter = 'all';

    if (toggleBatchBtn) {
        toggleBatchBtn.addEventListener('click', () => {
            const isHidden = batchPanel.classList.contains('hidden');
            if (isHidden) {
                batchPanel.classList.remove('hidden');
                toggleBatchBtn.classList.add('expanded');
            } else {
                batchPanel.classList.add('hidden');
                toggleBatchBtn.classList.remove('expanded');
            }
        });
    }

    function isKndUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.hostname === 'karzanddolls.com' || parsed.hostname.endsWith('.karzanddolls.com');
        } catch {
            return false;
        }
    }

    superInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (searchTimer) clearTimeout(searchTimer);

        if (!val || isKndUrl(val) || val.startsWith('http://') || val.startsWith('https://')) {
            hideSearchDropdown();
            return;
        }

        if (val.length < 2) {
            hideSearchDropdown();
            return;
        }

        searchTimer = setTimeout(() => {
            performLiveSearch(val);
        }, 150);
    });

    document.addEventListener('click', (e) => {
        if (!superInput.contains(e.target) && !searchDropdown.contains(e.target)) {
            hideSearchDropdown();
        }
    });

    async function performLiveSearch(term) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/search?term=${encodeURIComponent(term)}`);
            const data = await res.json();
            if (data.success && data.products && data.products.length > 0) {
                renderSearchDropdown(data.products);
            } else {
                hideSearchDropdown();
            }
        } catch {
            hideSearchDropdown();
        }
    }

    function renderSearchDropdown(products) {
        searchResultsList.innerHTML = '';
        products.slice(0, 6).forEach(p => {
            const item = document.createElement('div');
            item.className = 'search-item';
            
            const imgHtml = p.image ? `<img src="${escapeHtml(p.image)}" class="search-item-img" alt="" />` : `<div class="search-item-img" style="display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-car"></i></div>`;
            const stockClass = p.in_stock ? 'in-stock' : 'out-stock';
            const stockText = p.in_stock ? `In Stock (${p.stock_quantity})` : 'Out of Stock';

            item.innerHTML = `
                ${imgHtml}
                <div class="search-item-info">
                    <div class="search-item-title">${escapeHtml(p.product_name)}</div>
                    <div class="search-item-meta">
                        ${p.price ? `<span class="search-item-price">${escapeHtml(p.price)}</span>` : ''}
                        <span class="search-item-stock ${stockClass}">${stockText}</span>
                    </div>
                </div>
                <div class="search-item-action">Check Stock</div>
            `;

            item.addEventListener('click', () => {
                superInput.value = p.url || p.product_name;
                hideSearchDropdown();
                if (p.url && isKndUrl(p.url)) {
                    addUrls(p.url);
                    startBatchCheck();
                }
            });

            searchResultsList.appendChild(item);
        });
        searchDropdown.classList.remove('hidden');
    }

    function hideSearchDropdown() {
        searchDropdown.classList.add('hidden');
        searchResultsList.innerHTML = '';
    }

    function addUrls(text) {
        const candidates = text.split(/[\n\r]+/)
            .map(u => u.trim())
            .filter(u => u.length > 0 && !urls.includes(u));

        if (candidates.length === 0) return;

        const valid = [];
        const invalid = [];
        candidates.forEach(u => {
            if (isKndUrl(u)) {
                valid.push(u);
            } else {
                invalid.push(u);
            }
        });

        if (invalid.length > 0) {
            showNotification(`${invalid.length} non-karzanddolls.com link(s) skipped.`);
        } else {
            hideNotification();
        }

        valid.forEach(u => urls.push(u));
        renderChips();
        updateCounters();
    }

    function removeUrl(index) {
        urls.splice(index, 1);
        renderChips();
        updateCounters();
    }

    function clearAllUrls() {
        urls = [];
        renderChips();
        updateCounters();
    }

    function renderChips() {
        chipsList.innerHTML = '';
        urls.forEach((url, idx) => {
            const chip = document.createElement('div');
            chip.className = 'url-chip';
            chip.innerHTML = `
                <span>${escapeHtml(parseUrlTitle(url))}</span>
                <button type="button" class="url-chip__remove" data-index="${idx}">&times;</button>
            `;
            chip.querySelector('.url-chip__remove').addEventListener('click', () => removeUrl(idx));
            chipsList.appendChild(chip);
        });
    }

    function parseUrlTitle(url) {
        try {
            const parsed = new URL(url);
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (parts.length > 0) {
                return parts[parts.length - 1].replace(/-/g, ' ');
            }
            return parsed.hostname;
        } catch {
            return url;
        }
    }

    function updateCounters() {
        const count = urls.length;
        urlCounter.textContent = `${count} Link${count === 1 ? '' : 's'} Queued`;
        batchToggleText.textContent = `Multiple links queued (${count})`;
        
        let totalLen = urls.reduce((acc, u) => acc + u.length, 0);
        charCounter.textContent = `${totalLen} chars`;
    }

    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                addUrls(text);
                if (batchPanel.classList.contains('hidden')) {
                    batchPanel.classList.remove('hidden');
                    toggleBatchBtn.classList.add('expanded');
                }
            }
        } catch {
            showNotification('Clipboard access denied. Paste directly into input.');
        }
    });

    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            addUrls(evt.target.result);
            if (batchPanel.classList.contains('hidden')) {
                batchPanel.classList.remove('hidden');
                toggleBatchBtn.classList.add('expanded');
            }
        };
        reader.readAsText(file);
    });

    clearBtn.addEventListener('click', clearAllUrls);

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const inputVal = superInput.value.trim();
        if (inputVal) {
            if (isKndUrl(inputVal)) {
                if (!urls.includes(inputVal)) urls.push(inputVal);
            }
        }

        if (urls.length === 0 && inputVal) {
            performLiveSearchAndCheckFirst(inputVal);
            return;
        }

        if (urls.length === 0) {
            showNotification('Please enter a product name or link to check.');
            return;
        }

        startBatchCheck();
    });

    async function performLiveSearchAndCheckFirst(term) {
        setLoading(true);
        try {
            const res = await fetch(`${BACKEND_URL}/api/search?term=${encodeURIComponent(term)}`);
            const data = await res.json();
            if (data.success && data.products && data.products.length > 0) {
                const first = data.products[0];
                if (first.url) {
                    urls.push(first.url);
                    startBatchCheck();
                    return;
                }
            }
            showNotification(`No products found for "${term}".`);
        } catch {
            showNotification('Error performing search.');
        } finally {
            setLoading(false);
        }
    }

    async function startBatchCheck() {
        if (urls.length === 0) return;
        setLoading(true);
        hideNotification();
        emptyState.classList.add('hidden');
        resultsGrid.innerHTML = '';
        resultsData = [];
        completedCount = 0;
        totalCount = urls.length;

        resultsHeader.classList.remove('hidden');
        resultsToolbar.classList.remove('hidden');
        progressIndicator.classList.remove('hidden');
        updateProgress();

        const queue = [...urls];
        const CONCURRENCY = 3;

        async function worker() {
            while (queue.length > 0) {
                const targetUrl = queue.shift();
                try {
                    const res = await fetch(`${BACKEND_URL}/api/check-stock?url=${encodeURIComponent(targetUrl)}`);
                    const data = await res.json();
                    data.url = targetUrl;
                    resultsData.push(data);
                    renderResultCard(data);
                } catch (err) {
                    const errData = {
                        url: targetUrl,
                        product_name: parseUrlTitle(targetUrl),
                        stock_quantity: 0,
                        success: false,
                        message: err.message || 'Network error'
                    };
                    resultsData.push(errData);
                    renderResultCard(errData);
                } finally {
                    completedCount++;
                    updateProgress();
                }
            }
        }

        const workers = Array(Math.min(CONCURRENCY, queue.length)).fill(null).map(() => worker());
        await Promise.all(workers);

        setLoading(false);
        progressIndicator.classList.add('hidden');
        resultsCount.textContent = `(${resultsData.length} item${resultsData.length === 1 ? '' : 's'})`;
    }

    function renderResultCard(item) {
        const card = document.createElement('div');
        card.className = 'result-card';

        const inStock = item.success && item.stock_quantity > 0;
        const outOfStock = item.success && item.stock_quantity === 0;

        const imgHtml = item.image
            ? `<img src="${escapeHtml(item.image)}" class="card-img" alt="${escapeHtml(item.product_name)}" />`
            : `<div class="card-img-placeholder"><i class="fa-solid fa-box-open"></i></div>`;

        let badgeHtml = '';
        if (inStock) {
            badgeHtml = `<div class="stock-badge-giant in-stock"><i class="fa-solid fa-circle-check"></i> IN STOCK — ${item.stock_quantity} Available</div>`;
        } else if (outOfStock) {
            badgeHtml = `<div class="stock-badge-giant out-stock"><i class="fa-solid fa-circle-xmark"></i> OUT OF STOCK</div>`;
        } else {
            badgeHtml = `<div class="stock-badge-giant out-stock"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(item.message || 'Error')}</div>`;
        }

        const buyUrl = item.url || '#';

        card.innerHTML = `
            <div class="card-top">
                <div class="card-img-wrapper">${imgHtml}</div>
                <div class="card-info">
                    <div class="card-title">${escapeHtml(item.product_name)}</div>
                </div>
            </div>
            ${badgeHtml}
            <a href="${buyUrl}" target="_blank" class="buy-now-btn" rel="noopener">
                <i class="fa-solid fa-cart-shopping"></i> Buy on Karz and Dolls
            </a>
        `;

        card.addEventListener('click', (e) => {
            if (!e.target.closest('a')) {
                window.open(buyUrl, '_blank', 'noopener');
            }
        });

        resultsGrid.appendChild(card);
    }

    function updateProgress() {
        const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
        progressBarFill.style.width = `${pct}%`;
        progressText.textContent = `${completedCount} / ${totalCount}`;
    }

    function setLoading(isLoading) {
        if (isLoading) {
            submitBtn.disabled = true;
            btnLoader.classList.remove('hidden');
            submitBtn.querySelector('.btn__text').textContent = 'Checking…';
            submitBtn.querySelector('.btn__icon').classList.add('hidden');
        } else {
            submitBtn.disabled = false;
            btnLoader.classList.add('hidden');
            submitBtn.querySelector('.btn__text').textContent = 'Check Stock';
            submitBtn.querySelector('.btn__icon').classList.remove('hidden');
        }
    }

    function showNotification(msg) {
        notificationMsg.textContent = msg;
        notificationArea.classList.remove('hidden');
    }

    function hideNotification() {
        notificationArea.classList.add('hidden');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    document.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.filter;
            filterResults();
        });
    });

    if (filterInput) {
        filterInput.addEventListener('input', filterResults);
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', filterResults);
    }

    function filterResults() {
        const query = filterInput ? filterInput.value.toLowerCase().trim() : '';
        const sortVal = sortSelect ? sortSelect.value : 'default';

        let filtered = resultsData.filter(item => {
            const matchesQuery = !query || item.product_name.toLowerCase().includes(query);
            if (!matchesQuery) return false;

            if (activeFilter === 'instock') return item.success && item.stock_quantity > 0;
            if (activeFilter === 'outofstock') return item.success && item.stock_quantity === 0;
            if (activeFilter === 'error') return !item.success;
            return true;
        });

        if (sortVal === 'qty-desc') {
            filtered.sort((a, b) => b.stock_quantity - a.stock_quantity);
        } else if (sortVal === 'qty-asc') {
            filtered.sort((a, b) => a.stock_quantity - b.stock_quantity);
        } else if (sortVal === 'name-asc') {
            filtered.sort((a, b) => a.product_name.localeCompare(b.product_name));
        }

        resultsGrid.innerHTML = '';
        filtered.forEach(renderResultCard);
    }
});
