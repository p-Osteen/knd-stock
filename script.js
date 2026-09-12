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
    const retryFailedBtn = document.getElementById('retry-failed-btn');
    const progressIndicator = document.getElementById('progress-indicator');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const resultsToolbar = document.getElementById('results-toolbar');
    const filterInput = document.getElementById('results-filter-input');
    const sortSelect = document.getElementById('results-sort-select');
    const emptyState = document.getElementById('empty-state');
    const resultsGrid = document.getElementById('results-grid');
    const toastContainer = document.getElementById('toast-container');

    const countAll = document.getElementById('count-all');
    const countInstock = document.getElementById('count-instock');
    const countOutofstock = document.getElementById('count-outofstock');
    const countFailed = document.getElementById('count-failed');

    let BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '' : 'https://knd-stock.onrender.com';

    let resultsData = [];
    let completedCount = 0;
    let totalCount = 0;
    let urls = [];
    let searchTimer = null;
    let activeFilter = 'all';

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

    superInput.addEventListener('paste', (e) => {
        const pasteText = (e.clipboardData || window.clipboardData).getData('text');
        if (pasteText && (pasteText.includes('\n') || pasteText.includes('\r'))) {
            e.preventDefault();
            addUrls(pasteText);
            if (batchPanel.classList.contains('hidden')) {
                batchPanel.classList.remove('hidden');
                toggleBatchBtn.classList.add('expanded');
            }
            superInput.value = '';
            showToast('Batch links queued', 'info');
        }
    });

    document.addEventListener('click', (e) => {
        if (!superInput.contains(e.target) && !searchDropdown.contains(e.target)) {
            hideSearchDropdown();
        }
    });

    let searchIdCounter = 0;

    function showSearchLoading() {
        searchResultsList.innerHTML = `
            <div class="search-loading">
                <div class="search-loading-spinner"></div>
                <span>Searching Karz &amp; Dolls…</span>
            </div>
        `;
        searchDropdown.classList.remove('hidden');
    }

    async function performLiveSearch(term) {
        const thisSearchId = ++searchIdCounter;
        showSearchLoading();
        try {
            const res = await fetch(`${BACKEND_URL}/api/search?term=${encodeURIComponent(term)}`);
            if (thisSearchId !== searchIdCounter) return;
            const data = await res.json();
            if (thisSearchId !== searchIdCounter) return;
            if (data.success && data.products && data.products.length > 0) {
                renderSearchDropdown(data.products);
            } else {
                searchResultsList.innerHTML = `
                    <div class="search-loading">
                        <span>No products found for "${escapeHtml(term)}"</span>
                    </div>
                `;
            }
        } catch {
            if (thisSearchId === searchIdCounter) hideSearchDropdown();
        }
    }

    function renderSearchDropdown(products) {
        searchResultsList.innerHTML = '';
        products.slice(0, 8).forEach(p => {
            const item = document.createElement('div');
            const isSelected = p.url && urls.includes(p.url);
            item.className = 'search-item' + (isSelected ? ' selected' : '');

            const imgHtml = p.image
                ? `<img src="${escapeHtml(p.image)}" class="search-item-img" alt="" />`
                : `<div class="search-item-img" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);"><i class="fa-solid fa-car"></i></div>`;

            const actionText = isSelected
                ? '<i class="fa-solid fa-circle-check"></i> Added'
                : '<i class="fa-solid fa-plus"></i> Add';

            item.innerHTML = `
                ${imgHtml}
                <div class="search-item-info">
                    <div class="search-item-title">${escapeHtml(formatProductTitle(p.product_name))}</div>
                    <div class="search-item-meta">
                        ${p.price ? `<span class="search-item-price">${escapeHtml(p.price)}</span>` : ''}
                    </div>
                </div>
                <div class="search-item-action ${isSelected ? 'added' : ''}">${actionText}</div>
            `;

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!p.url || !isKndUrl(p.url)) return;

                const idx = urls.indexOf(p.url);
                if (idx > -1) {
                    urls.splice(idx, 1);
                    item.classList.remove('selected');
                    item.querySelector('.search-item-action').innerHTML = '<i class="fa-solid fa-plus"></i> Add';
                    item.querySelector('.search-item-action').classList.remove('added');
                } else {
                    urls.push(p.url);
                    item.classList.add('selected');
                    item.querySelector('.search-item-action').innerHTML = '<i class="fa-solid fa-circle-check"></i> Added';
                    item.querySelector('.search-item-action').classList.add('added');
                    showToast('Added to check queue', 'success');
                }
                renderChips();
                updateCounters();
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
        showToast('Cleared queued links', 'info');
    }

    function renderChips() {
        chipsList.innerHTML = '';
        urls.forEach((url, idx) => {
            const chip = document.createElement('div');
            chip.className = 'url-chip';
            chip.innerHTML = `
                <span>${escapeHtml(formatProductTitle(parseUrlTitle(url)))}</span>
                <button type="button" class="url-chip__remove" data-index="${idx}">&times;</button>
            `;
            chip.querySelector('.url-chip__remove').addEventListener('click', () => removeUrl(idx));
            chipsList.appendChild(chip);
        });
    }

    function formatProductTitle(title) {
        if (!title) return 'Unknown Product';
        const words = String(title).trim().split(/\s+/);
        const acronyms = new Set([
            'LB*WORKS', 'LBWK', 'GT-R', 'GTR', 'R34', 'R35', 'R32', 'R33', 'R30',
            'F1', 'GP', 'ID.', 'BUZZ', 'MINI', 'GT', 'USA', 'V1', 'V2', 'V3',
            'TRD', 'DBS', 'ZR1', 'S15', 'BMW', 'M3', 'M4', 'RS', 'AMG', '2ND', '1ST', '3RD', '40'
        ]);

        return words.map(w => {
            const upper = w.toUpperCase();
            if (acronyms.has(upper)) return upper;
            if (/^#?\d+([A-Z]+)?$/i.test(w)) return upper;
            if (w.length <= 2 && !['A', 'AN', 'OF', 'IN', 'ON', 'AT', 'TO'].includes(upper)) return upper;
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).join(' ');
    }

    function parseUrlTitle(url) {
        try {
            let decoded = url;
            try {
                decoded = decodeURIComponent(url);
            } catch { }
            const parsed = new URL(decoded);
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (parts.length > 0) {
                let slug = parts[parts.length - 1];
                if (/^\d+$/.test(slug) && parts.length > 1) {
                    slug = parts[parts.length - 2];
                }
                slug = slug.replace(/%C2%A0/gi, ' ')
                    .replace(/\u00a0/g, ' ')
                    .replace(/[+_\-]+/g, ' ');
                slug = slug.replace(/\s+/g, ' ').trim();
                return slug.split(' ')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                    .join(' ');
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

    function updateFilterCounts() {
        const total = resultsData.length;
        const inStockItems = resultsData.filter(d => d.success && d.stock_quantity > 0);
        const outStockItems = resultsData.filter(d => d.success && d.stock_quantity === 0);
        const inStock = inStockItems.length;
        const outStock = outStockItems.length;
        const failed = resultsData.filter(d => !d.success).length;

        if (countAll) countAll.textContent = total;
        if (countInstock) countInstock.textContent = inStock;
        if (countOutofstock) countOutofstock.textContent = outStock;
        if (countFailed) countFailed.textContent = failed;

        if (resultsCount) {
            resultsCount.textContent = `(${total} item${total === 1 ? '' : 's'})`;
        }


        if (retryFailedBtn) {
            if (failed > 0) {
                const retryText = document.getElementById('retry-failed-text');
                if (retryText) retryText.textContent = `Retry Failed (${failed})`;
                retryFailedBtn.classList.remove('hidden');
            } else {
                retryFailedBtn.classList.add('hidden');
            }
        }
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
                showToast('Pasted from clipboard', 'info');
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
            showToast(`Loaded links from ${file.name}`, 'success');
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
                superInput.value = '';
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
                    superInput.value = '';
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

    function renderSkeletonPlaceholders(count) {
        resultsGrid.innerHTML = '';
        const num = Math.min(count, 8);
        for (let i = 0; i < num; i++) {
            const sk = document.createElement('div');
            sk.className = 'skeleton-card';
            sk.innerHTML = `
                <div class="skeleton-showcase"></div>
                <div class="skeleton-line skeleton-line--title"></div>
                <div class="skeleton-line skeleton-line--sub"></div>
                <div class="skeleton-line skeleton-line--btn"></div>
            `;
            resultsGrid.appendChild(sk);
        }
    }

    async function startBatchCheck() {
        if (urls.length === 0) return;
        resultsData = [];
        await runBatchQueue([...urls], true);
    }

    async function runBatchQueue(targetUrls, isNewBatch) {
        if (targetUrls.length === 0) return;
        setLoading(true);
        hideNotification();
        emptyState.classList.add('hidden');

        if (isNewBatch) {
            completedCount = 0;
            totalCount = targetUrls.length;
            renderSkeletonPlaceholders(totalCount);
        } else {
            totalCount = targetUrls.length;
            completedCount = 0;
        }

        resultsHeader.classList.remove('hidden');
        if (resultsToolbar) resultsToolbar.classList.remove('hidden');
        progressIndicator.classList.remove('hidden');
        updateProgress();
        updateFilterCounts();

        const queue = [...targetUrls];
        const CONCURRENCY = 3;
        let skeletonsCleared = !isNewBatch;

        async function worker(workerId) {
            if (workerId > 0) {
                await new Promise(r => setTimeout(r, workerId * 200));
            }

            while (queue.length > 0) {
                const targetUrl = queue.shift();
                let itemData = null;

                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        const res = await fetch(`${BACKEND_URL}/api/check-stock?url=${encodeURIComponent(targetUrl)}`);
                        if (!res.ok) {
                            let errMsg = `HTTP ${res.status}`;
                            try {
                                const errJson = await res.json();
                                errMsg = errJson.error || errJson.detail || errJson.message || errMsg;
                            } catch { }
                            itemData = {
                                url: targetUrl,
                                product_name: parseUrlTitle(targetUrl),
                                stock_quantity: 0,
                                success: false,
                                message: errMsg
                            };
                        } else {
                            itemData = await res.json();
                            itemData.url = targetUrl;
                            if (!itemData.product_name || itemData.product_name === 'Unknown' || itemData.product_name.trim() === '') {
                                itemData.product_name = parseUrlTitle(targetUrl);
                            }
                        }
                    } catch (err) {
                        itemData = {
                            url: targetUrl,
                            product_name: parseUrlTitle(targetUrl),
                            stock_quantity: 0,
                            success: false,
                            message: err.message || 'Network connection failed'
                        };
                    }

                    if (itemData && itemData.success) {
                        break;
                    }
                    if (attempt === 0) {
                        await new Promise(r => setTimeout(r, 800));
                    }
                }

                if (!skeletonsCleared && isNewBatch) {
                    resultsGrid.innerHTML = '';
                    skeletonsCleared = true;
                }

                const existingIdx = resultsData.findIndex(d => d.url === targetUrl);
                if (existingIdx > -1) {
                    resultsData[existingIdx] = itemData;
                    const existingCard = resultsGrid.querySelector(`[data-url="${CSS.escape(targetUrl)}"]`);
                    if (existingCard) {
                        const newCard = createResultCard(itemData);
                        existingCard.replaceWith(newCard);
                    } else if (matchesCurrentFilter(itemData)) {
                        resultsGrid.appendChild(createResultCard(itemData));
                    }
                } else {
                    resultsData.push(itemData);
                    if (matchesCurrentFilter(itemData)) {
                        resultsGrid.appendChild(createResultCard(itemData));
                    }
                }

                completedCount++;
                updateProgress();
                updateFilterCounts();
                await new Promise(r => setTimeout(r, 200));
            }
        }

        const workers = Array(Math.min(CONCURRENCY, queue.length)).fill(null).map((_, i) => worker(i));
        await Promise.all(workers);

        if (!skeletonsCleared && resultsData.length > 0) {
            filterResults();
        }

        setLoading(false);
        progressIndicator.classList.add('hidden');
        updateFilterCounts();
    }

    function matchesCurrentFilter(item) {
        const query = filterInput ? filterInput.value.toLowerCase().trim() : '';
        const name = (item.product_name || '').toLowerCase();
        if (query && !name.includes(query)) return false;

        if (activeFilter === 'instock') return item.success && item.stock_quantity > 0;
        if (activeFilter === 'outofstock') return item.success && item.stock_quantity === 0;
        if (activeFilter === 'error') return !item.success;
        return true;
    }

    function createResultCard(item) {
        const card = document.createElement('div');
        const inStock = item.success && item.stock_quantity > 0;
        const outOfStock = item.success && item.stock_quantity === 0;
        const isError = !item.success;

        card.className = 'result-card' + (isError ? ' is-error' : '');
        card.setAttribute('data-url', item.url || '');

        const rawTitle = item.product_name && item.product_name !== 'Unknown'
            ? item.product_name
            : parseUrlTitle(item.url || '');
        const displayTitle = formatProductTitle(rawTitle);

        let stockBannerHtml = '';
        let actionHtml = '';

        if (inStock) {
            const isLow = item.stock_quantity <= 3;
            const bannerClass = isLow ? 'stock-banner--low' : 'stock-banner--in';
            const icon = isLow ? 'fa-bolt' : 'fa-circle-check';
            const statusLabel = isLow ? 'Low Stock' : 'In Stock';
            const qtyText = isLow ? `Only ${item.stock_quantity} left` : `${Number(item.stock_quantity).toLocaleString()} available`;

            stockBannerHtml = `
                <div class="stock-banner ${bannerClass}">
                    <div class="stock-banner__status">
                        <i class="fa-solid ${icon}"></i>
                        <span>${statusLabel}</span>
                    </div>
                    <div class="stock-banner__qty">
                        <span class="stock-banner__count">${qtyText}</span>
                    </div>
                </div>
            `;

            actionHtml = `
                <a href="${escapeHtml(item.url || '#')}" target="_blank" class="cta-btn cta-btn--primary" rel="noopener" title="Buy on Karz and Dolls">
                    <i class="fa-solid fa-cart-shopping"></i> Buy on Karz &amp; Dolls
                </a>
                <button type="button" class="card-icon-btn copy-link-btn" title="Copy product link">
                    <i class="fa-regular fa-clone"></i>
                </button>
            `;
        } else if (outOfStock) {
            stockBannerHtml = `
                <div class="stock-banner stock-banner--out">
                    <div class="stock-banner__status">
                        <i class="fa-solid fa-circle-xmark"></i>
                        <span>Out of Stock</span>
                    </div>
                    <div class="stock-banner__qty">
                        <span class="stock-banner__count">0 available</span>
                    </div>
                </div>
            `;
            actionHtml = `
                <a href="${escapeHtml(item.url || '#')}" target="_blank" class="cta-btn cta-btn--ghost" rel="noopener" title="View product on Karz and Dolls">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> View on Site
                </a>
                <button type="button" class="card-icon-btn copy-link-btn" title="Copy product link">
                    <i class="fa-regular fa-clone"></i>
                </button>
            `;
        } else {
            const rawError = item.message || 'Lookup Failed';
            let displayBadgeText = 'Lookup Failed';
            let iconClass = 'fa-triangle-exclamation';

            const lower = rawError.toLowerCase();
            if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('curl: (28)')) {
                displayBadgeText = 'Timed Out';
                iconClass = 'fa-clock';
            } else if (lower.includes('rate limit') || lower.includes('429')) {
                displayBadgeText = 'Rate Limited';
                iconClass = 'fa-hand';
            } else if (lower.includes('404')) {
                displayBadgeText = 'Not Found (404)';
                iconClass = 'fa-circle-xmark';
            }

            stockBannerHtml = `
                <div class="stock-banner stock-banner--error" title="${escapeHtml(rawError)}">
                    <div class="stock-banner__status">
                        <i class="fa-solid ${iconClass}"></i>
                        <span>${escapeHtml(displayBadgeText)}</span>
                    </div>
                    <div class="stock-banner__qty">
                        <span class="stock-banner__count">Check Failed</span>
                    </div>
                </div>
            `;
            actionHtml = `
                <button type="button" class="card-retry-btn" title="Retry this item">
                    <i class="fa-solid fa-rotate-right"></i> Retry
                </button>
                <a href="${escapeHtml(item.url || '#')}" target="_blank" class="cta-btn cta-btn--ghost" rel="noopener" title="Open product page">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Open
                </a>
            `;
        }

        const imgHtml = item.image
            ? `<img src="${escapeHtml(item.image)}" class="card-showcase-img" alt="${escapeHtml(displayTitle)}" loading="lazy" />`
            : `<div class="card-showcase-placeholder"><i class="fa-solid ${isError ? 'fa-triangle-exclamation' : 'fa-car'}"></i></div>`;

        const priceHtml = item.price ? `<div class="floating-price-tag">${escapeHtml(item.price)}</div>` : '';

        card.innerHTML = `
            <div class="card-showcase">
                ${priceHtml}
                ${imgHtml}
            </div>
            <div class="card-details">
                <div class="card-title" title="${escapeHtml(rawTitle)}">${escapeHtml(displayTitle)}</div>
                ${stockBannerHtml}
            </div>
            <div class="card-footer">
                ${actionHtml}
            </div>
        `;

        const retryBtn = card.querySelector('.card-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                retrySingleCard(item.url, card);
            });
        }

        const copyBtn = card.querySelector('.copy-link-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!item.url) return;
                try {
                    await navigator.clipboard.writeText(item.url);
                    showToast('Product link copied to clipboard!', 'success');
                    copyBtn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--emerald-light);"></i>';
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i class="fa-regular fa-clone"></i>';
                    }, 1500);
                } catch {
                    showToast('Failed to copy to clipboard', 'error');
                }
            });
        }

        return card;
    }

    async function retrySingleCard(targetUrl, cardElement) {
        const retryBtn = cardElement.querySelector('.card-retry-btn');
        if (retryBtn) {
            retryBtn.disabled = true;
            retryBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Retrying…';
        }
        try {
            let data = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const res = await fetch(`${BACKEND_URL}/api/check-stock?url=${encodeURIComponent(targetUrl)}`);
                    if (!res.ok) {
                        let errMsg = `HTTP ${res.status}`;
                        try {
                            const errJson = await res.json();
                            errMsg = errJson.error || errJson.detail || errJson.message || errMsg;
                        } catch { }
                        data = {
                            url: targetUrl,
                            product_name: parseUrlTitle(targetUrl),
                            stock_quantity: 0,
                            success: false,
                            message: errMsg
                        };
                    } else {
                        data = await res.json();
                        data.url = targetUrl;
                        if (!data.product_name || data.product_name === 'Unknown' || data.product_name.trim() === '') {
                            data.product_name = parseUrlTitle(targetUrl);
                        }
                    }
                } catch (err) {
                    data = {
                        url: targetUrl,
                        product_name: parseUrlTitle(targetUrl),
                        stock_quantity: 0,
                        success: false,
                        message: err.message || 'Network connection failed'
                    };
                }

                if (data && data.success) break;
                if (attempt === 0) await new Promise(r => setTimeout(r, 600));
            }

            const idx = resultsData.findIndex(d => d.url === targetUrl);
            if (idx > -1) {
                resultsData[idx] = data;
            } else {
                resultsData.push(data);
            }

            const newCard = createResultCard(data);
            cardElement.replaceWith(newCard);
            updateFilterCounts();
            showToast(data.success ? 'Stock updated successfully' : 'Retry completed', data.success ? 'success' : 'info');
        } catch (err) {
            if (retryBtn) {
                retryBtn.disabled = false;
                retryBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry';
            }
        }
    }

    if (retryFailedBtn) {
        retryFailedBtn.addEventListener('click', async () => {
            const failedItems = resultsData.filter(d => !d.success);
            if (failedItems.length === 0) return;
            const failedUrls = failedItems.map(d => d.url);
            showToast(`Retrying ${failedUrls.length} failed item(s)…`, 'info');
            await runBatchQueue(failedUrls, false);
        });
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
            const name = (item.product_name || parseUrlTitle(item.url || '')).toLowerCase();
            const matchesQuery = !query || name.includes(query);
            if (!matchesQuery) return false;

            if (activeFilter === 'instock') return item.success && item.stock_quantity > 0;
            if (activeFilter === 'outofstock') return item.success && item.stock_quantity === 0;
            if (activeFilter === 'error') return !item.success;
            return true;
        });

        if (sortVal === 'qty-desc') {
            filtered.sort((a, b) => (b.stock_quantity || 0) - (a.stock_quantity || 0));
        } else if (sortVal === 'qty-asc') {
            filtered.sort((a, b) => (a.stock_quantity || 0) - (b.stock_quantity || 0));
        } else if (sortVal === 'name-asc') {
            filtered.sort((a, b) => {
                const nameA = a.product_name || parseUrlTitle(a.url || '');
                const nameB = b.product_name || parseUrlTitle(b.url || '');
                return nameA.localeCompare(nameB);
            });
        }

        resultsGrid.innerHTML = '';
        filtered.forEach(item => {
            resultsGrid.appendChild(createResultCard(item));
        });
    }
});
