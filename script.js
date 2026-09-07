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
    const urlInlineInput = document.getElementById('product-urls-input');
    const chipsList = document.getElementById('url-chips-list');
    const chipsScroll = document.getElementById('url-chips-scroll');
    const resultsGrid = document.getElementById('results-grid');
    const submitBtn = document.getElementById('submit-btn');
    const clearBtn = document.getElementById('clear-btn');
    const pasteBtn = document.getElementById('paste-btn');
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-upload-input');
    const notificationArea = document.getElementById('notification-area');
    const urlCounter = document.getElementById('url-counter');
    const charCounter = document.getElementById('char-counter');
    const resultsHeader = document.getElementById('results-header');
    const resultsCount = document.getElementById('results-count');
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const emptyState = document.getElementById('empty-state');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const retryFailedBtn = document.getElementById('retry-failed-btn');
    const progressIndicator = document.getElementById('progress-indicator');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');

    let BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '' : 'https://knd-stock.onrender.com';

    let resultsData = [];
    let completedCount = 0;
    let totalCount = 0;

    let urls = [];

    let parsedUrlCache = [];
    let totalChars = 0;

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    themeIcon.className = currentTheme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';

    themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem('knd-theme', next);
    });

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        themeIcon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }

    function isKndUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.hostname === 'karzanddolls.com' || parsed.hostname.endsWith('.karzanddolls.com');
        } catch {
            return false;
        }
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
            const msg = invalid.length === 1
                ? 'Only karzanddolls.com URLs are allowed.'
                : `${invalid.length} non-karzanddolls.com URLs were rejected.`;
            showNotification(msg, 'error');
        }

        if (valid.length === 0) return;

        if (invalid.length === 0) hideNotification();

        for (const u of valid) {
            urls.push(u);
            parsedUrlCache.push(parseUrlParts(u));
            totalChars += u.length;
        }
        if (urls.length > valid.length) {
            totalChars += valid.length;
        } else {
            totalChars += valid.length - 1;
        }

        renderChips();
        syncHiddenTextareaDeferred();
        updateCounters();

        requestAnimationFrame(() => {
            chipsScroll.scrollTop = chipsScroll.scrollHeight;
        });
    }

    function removeUrl(index) {
        const removed = urls[index];
        totalChars -= removed.length;
        if (urls.length > 1) totalChars -= 1;

        urls.splice(index, 1);
        parsedUrlCache.splice(index, 1);
        renderChips();
        syncHiddenTextareaDeferred();
        updateCounters();

        requestAnimationFrame(() => {
            const nextChip = chipsList.querySelector('.url-chip__remove');
            if (nextChip) {
                nextChip.focus();
            } else {
                urlInlineInput.focus();
            }
        });
    }

    function clearAllUrls() {
        urls = [];
        parsedUrlCache = [];
        totalChars = 0;
        renderChips();
        syncHiddenTextareaDeferred();
        updateCounters();
    }

    let syncTimerId = null;
    function syncHiddenTextareaDeferred() {
        if (syncTimerId) cancelIdleCallback(syncTimerId);
        syncTimerId = requestIdleCallback(() => {
            syncTimerId = null;
            urlsInput.value = urls.join('\n');
            if (urls.length > 0) {
                urlsInput.removeAttribute('required');
            } else {
                urlsInput.setAttribute('required', '');
            }
        }, { timeout: 300 });
    }

    function syncHiddenTextareaImmediate() {
        if (syncTimerId) {
            cancelIdleCallback(syncTimerId);
            syncTimerId = null;
        }
        urlsInput.value = urls.join('\n');
        if (urls.length > 0) {
            urlsInput.removeAttribute('required');
        } else {
            urlsInput.setAttribute('required', '');
        }
    }

    function parseUrlParts(url) {
        try {
            const parsed = new URL(url);
            return {
                domain: escapeHtml(parsed.hostname),
                path: escapeHtml(parsed.pathname + parsed.search)
            };
        } catch {
            return { domain: '', path: escapeHtml(url) };
        }
    }

    const CHIP_HEIGHT = 44;
    const CHIP_BUFFER = 10;

    let chipRenderRAF = null;
    let isScrollRender = false;

    let lastStartIdx = -1, lastEndIdx = -1, lastUrlsLength = -1;

    function renderChips() {
        if (chipRenderRAF) cancelAnimationFrame(chipRenderRAF);
        chipRenderRAF = requestAnimationFrame(_renderChipsVirtual);
    }

    function _renderChipsVirtual() {
        chipRenderRAF = null;
        const scrollTop = chipsScroll.scrollTop;
        const viewHeight = chipsScroll.clientHeight;

        let startIdx = Math.floor(scrollTop / CHIP_HEIGHT) - CHIP_BUFFER;
        let endIdx = Math.ceil((scrollTop + viewHeight) / CHIP_HEIGHT) + CHIP_BUFFER;
        startIdx = Math.max(0, startIdx);
        endIdx = Math.min(urls.length, endIdx);

        if (startIdx === lastStartIdx && endIdx === lastEndIdx && urls.length === lastUrlsLength) {
            isScrollRender = false;
            return;
        }
        lastStartIdx = startIdx;
        lastEndIdx = endIdx;
        lastUrlsLength = urls.length;

        const fragment = document.createDocumentFragment();

        const topSpacer = document.createElement('div');
        topSpacer.style.height = `${startIdx * CHIP_HEIGHT}px`;
        topSpacer.style.flexShrink = '0';
        fragment.appendChild(topSpacer);

        for (let index = startIdx; index < endIdx; index++) {
            const cached = parsedUrlCache[index];
            const chip = _createChipElement(index, cached, isScrollRender);
            fragment.appendChild(chip);
        }

        const bottomSpacer = document.createElement('div');
        bottomSpacer.style.height = `${(urls.length - endIdx) * CHIP_HEIGHT}px`;
        bottomSpacer.style.flexShrink = '0';
        fragment.appendChild(bottomSpacer);

        chipsList.replaceChildren(fragment);

        isScrollRender = false;
    }

    function _createChipElement(index, cached, skipAnimation) {
        const chip = document.createElement('div');
        chip.className = 'url-chip';
        chip.style.cursor = 'pointer';
        chip.setAttribute('role', 'option');
        chip.setAttribute('tabindex', '0');
        chip.setAttribute('aria-label', `URL ${index + 1}: ${urls[index]}`);

        if (skipAnimation) {
            chip.style.animation = 'none';
        } else {
            chip.style.animationDelay = `${Math.min(index, 15) * 0.03}s`;
        }

        const idx = document.createElement('span');
        idx.className = 'url-chip__index';
        idx.textContent = index + 1;

        const textSpan = document.createElement('span');
        textSpan.className = 'url-chip__text';

        const domain = document.createElement('span');
        domain.className = 'url-chip__domain';
        domain.innerHTML = cached.domain;

        const path = document.createElement('span');
        path.className = 'url-chip__path';
        path.innerHTML = cached.path;

        textSpan.appendChild(domain);
        textSpan.appendChild(path);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'url-chip__remove';
        btn.title = 'Remove URL';
        btn.setAttribute('aria-label', `Remove URL ${index + 1}`);
        btn.dataset.index = index;
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        chip.appendChild(idx);
        chip.appendChild(textSpan);
        chip.appendChild(btn);

        return chip;
    }

    chipsScroll.addEventListener('scroll', () => {
        isScrollRender = true;
        renderChips();
    }, { passive: true });

    chipsList.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.url-chip__remove');
        if (removeBtn) {
            e.stopPropagation();
            const idx = parseInt(removeBtn.dataset.index, 10);
            removeUrl(idx);
            return;
        }
        const chip = e.target.closest('.url-chip');
        if (chip) {
            const idx = parseInt(chip.querySelector('.url-chip__index').textContent, 10) - 1;
            if (urls[idx]) window.open(urls[idx], '_blank');
        }
    });

    chipsList.addEventListener('keydown', (e) => {
        const chip = e.target.closest('.url-chip');
        if (!chip) return;

        const idx = parseInt(chip.querySelector('.url-chip__index').textContent, 10) - 1;

        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (urls[idx]) window.open(urls[idx], '_blank');
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            removeUrl(idx);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            const next = chip.nextElementSibling;
            if (next && next.classList.contains('url-chip')) next.focus();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const prev = chip.previousElementSibling;
            if (prev && prev.classList.contains('url-chip')) prev.focus();
        }
    });

    const _escapeDiv = document.createElement('div');
    function escapeHtml(str) {
        _escapeDiv.textContent = str;
        return _escapeDiv.innerHTML;
    }

    urlInlineInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (text.trim()) {
            addUrls(text);
            urlInlineInput.value = '';
        }
    });

    urlInlineInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = urlInlineInput.value.trim();
            if (val) {
                addUrls(val);
                urlInlineInput.value = '';
            }
        }
        if (e.key === 'Backspace' && urlInlineInput.value === '' && urls.length > 0) {
            removeUrl(urls.length - 1);
        }
    });

    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text.trim()) {
                addUrls(text);
                urlInlineInput.value = '';
                urlInlineInput.focus();
            }
        } catch {
            urlInlineInput.focus();
        }
    });

    let xlsxLoadPromise = null;
    function ensureXLSXLoaded() {
        if (typeof XLSX !== 'undefined') return Promise.resolve();
        if (xlsxLoadPromise) return xlsxLoadPromise;
        xlsxLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load Excel parser. Check your internet connection.'));
            document.head.appendChild(script);
        });
        return xlsxLoadPromise;
    }

    const FILE_UPLOAD_CONFIG = {
        maxSizeBytes: 5 * 1024 * 1024,
        maxSizeLabel: '5MB',
        allowedExtensions: ['.csv', '.txt', '.xlsx', '.xls'],
        allowedMimeTypes: [
            'text/csv',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/octet-stream',
        ],
        magicBytes: {
            xlsx: [0x50, 0x4B, 0x03, 0x04],
            xls:  [0xD0, 0xCF, 0x11, 0xE0],
        },
        dangerousPatterns: [
            /<script[\s>]/i,
            /javascript:/i,
            /on\w+\s*=/i,
            /data:\s*text\/html/i,
            /vbscript:/i,
            /expression\s*\(/i,
            /<iframe/i,
            /<object/i,
            /<embed/i,
            /<link[\s>]/i,
            /<import/i,
        ],
    };

    uploadBtn.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            await processUploadedFile(file);
        } catch (err) {
            showNotification(err.message || 'File processing failed.', 'error');
        }
    });

    async function processUploadedFile(file) {
        const fileName = file.name.toLowerCase();
        const ext = '.' + fileName.split('.').pop();
        if (!FILE_UPLOAD_CONFIG.allowedExtensions.includes(ext)) {
            throw new Error(`Invalid file type "${ext}". Only CSV, TXT, XLSX, and XLS files are allowed.`);
        }

        const parts = fileName.split('.');
        if (parts.length > 2) {
            const dangerousExts = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.js', '.vbs',
                '.wsf', '.msi', '.com', '.hta', '.ps1', '.sh', '.html', '.htm', '.php',
                '.asp', '.aspx', '.jsp', '.svg', '.xml'];
            for (let i = 1; i < parts.length - 1; i++) {
                if (dangerousExts.includes('.' + parts[i])) {
                    throw new Error('Suspicious file rejected: possible double-extension attack.');
                }
            }
        }

        if (file.type && !FILE_UPLOAD_CONFIG.allowedMimeTypes.includes(file.type)) {
            throw new Error(`Unsupported MIME type "${file.type}". Upload a CSV, TXT, or Excel file.`);
        }

        if (file.size > FILE_UPLOAD_CONFIG.maxSizeBytes) {
            throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${FILE_UPLOAD_CONFIG.maxSizeLabel}.`);
        }

        if (file.size === 0) {
            throw new Error('File is empty.');
        }

        const arrayBuffer = await file.arrayBuffer();
        const header = new Uint8Array(arrayBuffer.slice(0, 8));

        if (ext === '.xlsx') {
            if (!matchesMagicBytes(header, FILE_UPLOAD_CONFIG.magicBytes.xlsx)) {
                throw new Error('File content does not match XLSX format. The file may be corrupted or disguised.');
            }
        } else if (ext === '.xls') {
            if (!matchesMagicBytes(header, FILE_UPLOAD_CONFIG.magicBytes.xls)) {
                throw new Error('File content does not match XLS format. The file may be corrupted or disguised.');
            }
        } else {
            const sample = new Uint8Array(arrayBuffer.slice(0, 8192));
            if (containsNullBytes(sample)) {
                throw new Error('File appears to be binary, not a text file. Upload was rejected.');
            }
        }

        let textContent;
        if (ext === '.xlsx' || ext === '.xls') {
            await ensureXLSXLoaded();
            textContent = extractTextFromExcel(arrayBuffer);
        } else {
            textContent = new TextDecoder('utf-8').decode(arrayBuffer);
        }

        for (const pattern of FILE_UPLOAD_CONFIG.dangerousPatterns) {
            if (pattern.test(textContent)) {
                throw new Error('File contains potentially malicious content and was rejected.');
            }
        }

        const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
        if (textContent.length > MAX_TEXT_LENGTH) {
            throw new Error('File content is too large to process safely.');
        }

        const extractedUrls = extractUrlsFromText(textContent);

        if (extractedUrls.length === 0) {
            showNotification('No URLs found in the uploaded file.', 'warning');
            return;
        }

        addUrls(extractedUrls.join('\n'));

        showNotification(
            `Processed "${file.name}" — found ${extractedUrls.length} URL${extractedUrls.length !== 1 ? 's' : ''}.`,
            'success'
        );
    }

    function matchesMagicBytes(header, expected) {
        return expected.every((byte, i) => header[i] === byte);
    }

    function containsNullBytes(bytes) {
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] === 0) return true;
        }
        return false;
    }

    function extractTextFromExcel(arrayBuffer) {
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel parser failed to load. Please check your connection and try again.');
        }
        const workbook = XLSX.read(arrayBuffer, { type: 'array', cellText: true, cellDates: false });
        const lines = [];
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
            lines.push(csv);
        }
        return lines.join('\n');
    }

    function extractUrlsFromText(text) {
        const urlRegex = /https?:\/\/[^\s,;"'<>()[\]{}|\\^`]+/gi;
        const matches = text.match(urlRegex) || [];
        const cleaned = matches.map(u => u.replace(/[.,;:!?)\]]+$/, ''));
        return [...new Set(cleaned)];
    }

    function updateCounters() {
        const count = urls.length;
        urlCounter.textContent = `${count} URL${count !== 1 ? 's' : ''}`;
        charCounter.textContent = `${Math.max(0, totalChars)} chars`;
    }

    function showNotification(message, type = 'error') {
        const textEl = notificationArea.querySelector('.notification__text');
        const iconEl = notificationArea.querySelector('.notification__icon');
        textEl.textContent = message;
        notificationArea.className = `notification ${type}`;

        const iconMap = {
            error: 'fa-solid fa-circle-exclamation',
            warning: 'fa-solid fa-triangle-exclamation',
            success: 'fa-solid fa-circle-check',
        };
        iconEl.className = `notification__icon ${iconMap[type] || iconMap.error}`;
    }

    function hideNotification() {
        notificationArea.className = 'notification hidden';
    }

    clearBtn.addEventListener('click', () => {
        clearAllUrls();
        urlInlineInput.value = '';
        resultsGrid.innerHTML = '';
        resultsData = [];
        hideNotification();
        clearBtn.classList.add('hidden');
        exportCsvBtn.classList.add('hidden');
        retryFailedBtn.classList.add('hidden');
        progressIndicator.classList.add('hidden');
        resultsHeader.classList.add('hidden');
        emptyState.classList.remove('hidden');
        urlInlineInput.focus();
    });

    function updateProgress() {
        completedCount++;
        const pct = Math.round((completedCount / totalCount) * 100);
        progressBarFill.style.width = `${pct}%`;
        progressText.textContent = `${completedCount} / ${totalCount}`;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideNotification();

        syncHiddenTextareaImmediate();

        const pendingInput = urlInlineInput.value.trim();
        if (pendingInput) {
            addUrls(pendingInput);
            urlInlineInput.value = '';
        }

        if (urls.length === 0) {
            showNotification('Please enter at least one URL.', 'error');
            return;
        }

        const uniqueUrls = [...new Set(urls.filter(url => url.startsWith('http')))];

        if (uniqueUrls.length === 0) {
            showNotification('No valid HTTP/HTTPS URLs found.', 'error');
            return;
        }

        setLoading(true);

        resultsGrid.innerHTML = '';
        resultsData = [];
        completedCount = 0;
        totalCount = uniqueUrls.length;

        emptyState.classList.add('hidden');
        resultsHeader.classList.remove('hidden');
        resultsCount.textContent = `${uniqueUrls.length} product${uniqueUrls.length !== 1 ? 's' : ''}`;
        exportCsvBtn.classList.add('hidden');
        retryFailedBtn.classList.add('hidden');

        progressIndicator.classList.remove('hidden');
        progressBarFill.style.width = '0%';
        progressText.textContent = `0 / ${totalCount}`;

        const fragment = document.createDocumentFragment();
        const cardMeta = uniqueUrls.map((url, index) => {
            const cardId = `card-${Date.now()}-${index}`;
            const cardElement = createLoadingCard(cardId, url, index);
            fragment.appendChild(cardElement);
            return { url, cardId };
        });
        resultsGrid.appendChild(fragment);

        await runWithConcurrency(cardMeta, ({ url, cardId }) => fetchStock(url, cardId), 10);

        setLoading(false);
        clearBtn.classList.remove('hidden');

        progressIndicator.classList.add('hidden');
        exportCsvBtn.classList.remove('hidden');

        const failedCount = resultsData.filter(r => !r.success).length;
        if (failedCount > 0) {
            retryFailedBtn.classList.remove('hidden');
        }
    });

    function setLoading(loading) {
        submitBtn.disabled = loading;
        urlInlineInput.disabled = loading;

        chipsList.querySelectorAll('.url-chip__remove').forEach(btn => {
            btn.disabled = loading;
            btn.style.pointerEvents = loading ? 'none' : '';
            btn.style.opacity = loading ? '0.3' : '';
        });

        const btnText = submitBtn.querySelector('.btn__text');
        const btnIcon = submitBtn.querySelector('.btn__icon');
        const btnLoader = submitBtn.querySelector('.btn__loader');

        if (loading) {
            btnText.textContent = 'Checking…';
            btnIcon.classList.add('hidden');
            btnLoader.classList.remove('hidden');
            clearBtn.classList.add('hidden');
        } else {
            btnText.textContent = 'Check Stock';
            btnIcon.classList.remove('hidden');
            btnLoader.classList.add('hidden');
        }
    }

    async function fetchStock(url, cardId) {
        const card = document.getElementById(cardId);
        const nameEl = card.querySelector('.product-name');
        const badgeEl = card.querySelector('.badge');
        const stockDisplayEl = card.querySelector('.stock-display');
        const qtyEl = card.querySelector('.stock-quantity');
        const errorEl = card.querySelector('.error-text');
        const loadingEl = card.querySelector('.loading-state');
        const retryBtn = card.querySelector('.card-retry-btn');

        try {
            const response = await fetch(`${BACKEND_URL}/api/check-stock?url=${encodeURIComponent(url)}`);
            const data = await response.json();

            loadingEl.style.display = 'none';

            if (data.success) {
                stockDisplayEl.style.display = 'flex';
                nameEl.textContent = data.product_name;

                animateValue(qtyEl, 0, data.stock_quantity, 900);

                let actionBtn = card.querySelector('.card-action-btn');
                if (!actionBtn) {
                    actionBtn = document.createElement('a');
                    actionBtn.target = '_blank';
                    actionBtn.rel = 'noopener noreferrer';
                    actionBtn.href = url;
                    card.appendChild(actionBtn);
                }

                if (data.stock_quantity > 0) {
                    badgeEl.textContent = 'In Stock';
                    badgeEl.className = 'badge in-stock';
                    actionBtn.className = 'card-action-btn buy-now-btn';
                    actionBtn.innerHTML = '<i class="fa-solid fa-cart-shopping"></i> Buy Now';
                } else {
                    badgeEl.textContent = 'Out of Stock';
                    badgeEl.className = 'badge out-of-stock';
                    actionBtn.className = 'card-action-btn view-page-btn';
                    actionBtn.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i> View Page';
                }

                resultsData.push({
                    url,
                    product_name: data.product_name,
                    stock_quantity: data.stock_quantity,
                    success: true,
                    message: '',
                    cardId,
                });
                if (retryBtn) retryBtn.classList.add('hidden');
            } else {
                showCardError(card, loadingEl, stockDisplayEl, badgeEl, nameEl, errorEl, data.message);
                resultsData.push({
                    url,
                    product_name: 'Unknown',
                    stock_quantity: 0,
                    success: false,
                    message: data.message,
                    cardId,
                });
                if (retryBtn) retryBtn.classList.remove('hidden');
            }
        } catch (error) {
            showCardError(card, loadingEl, stockDisplayEl, badgeEl, nameEl, errorEl, 'Failed to connect to server.');
            resultsData.push({
                url,
                product_name: 'Unknown',
                stock_quantity: 0,
                success: false,
                message: 'Failed to connect to server.',
                cardId,
            });
            if (retryBtn) retryBtn.classList.remove('hidden');
        }

        updateProgress();
    }

    function showCardError(card, loadingEl, stockDisplayEl, badgeEl, nameEl, errorEl, message) {
        loadingEl.style.display = 'none';
        stockDisplayEl.style.display = 'none';
        badgeEl.textContent = 'Error';
        badgeEl.className = 'badge out-of-stock';
        nameEl.textContent = 'Lookup Failed';
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    }

    function createLoadingCard(id, url, index) {
        const card = document.createElement('div');
        card.className = 'card';
        card.id = id;
        card.style.animationDelay = `${Math.min(index, 40) * 0.08}s`;
        card.setAttribute('data-url', url);

        const shortUrl = url.length > 55 ? url.substring(0, 55) + '…' : url;

        card.innerHTML = `
            <div class="card-header">
                <h2 class="product-name" title="${escapeHtml(url)}">Loading…</h2>
                <span class="badge pending">Pending</span>
            </div>

            <div class="loading-state">
                <div class="loading-dots">
                    <span></span><span></span><span></span>
                </div>
                <p>Fetching stock data…</p>
            </div>

            <div class="stock-display" style="display: none;">
                <div class="stock-ring">
                    <div class="stock-ring__bg"></div>
                    <div class="stock-ring__glow"></div>
                    <span class="stock-quantity">0</span>
                </div>
                <p class="stock-label">Units Available</p>
            </div>

            <p class="error-text hidden"></p>

            <button type="button" class="card-retry-btn hidden" title="Retry this lookup">
                <i class="fa-solid fa-rotate-right"></i> Retry
            </button>

            <div class="card-url">${escapeHtml(shortUrl)}</div>
        `;

        const cardRetryBtn = card.querySelector('.card-retry-btn');
        cardRetryBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const loadingEl = card.querySelector('.loading-state');
            const stockDisplayEl = card.querySelector('.stock-display');
            const errorEl = card.querySelector('.error-text');
            const nameEl = card.querySelector('.product-name');
            const badgeEl = card.querySelector('.badge');

            loadingEl.style.display = '';
            stockDisplayEl.style.display = 'none';
            errorEl.classList.add('hidden');
            nameEl.textContent = 'Loading…';
            badgeEl.textContent = 'Pending';
            badgeEl.className = 'badge pending';
            cardRetryBtn.classList.add('hidden');

            resultsData = resultsData.filter(r => r.cardId !== id);
            completedCount = Math.max(0, completedCount - 1);

            await fetchStock(url, id);

            const failedCount = resultsData.filter(r => !r.success).length;
            if (failedCount === 0) {
                retryFailedBtn.classList.add('hidden');
            }
        });

        return card;
    }

    retryFailedBtn.addEventListener('click', async () => {
        const failed = resultsData.filter(r => !r.success);
        if (failed.length === 0) return;

        retryFailedBtn.disabled = true;
        retryFailedBtn.querySelector('span').textContent = 'Retrying…';

        totalCount = failed.length;
        completedCount = 0;
        progressIndicator.classList.remove('hidden');
        progressBarFill.style.width = '0%';
        progressText.textContent = `0 / ${totalCount}`;

        for (const r of failed) {
            const card = document.getElementById(r.cardId);
            if (!card) continue;
            const loadingEl = card.querySelector('.loading-state');
            const stockDisplayEl = card.querySelector('.stock-display');
            const errorEl = card.querySelector('.error-text');
            const nameEl = card.querySelector('.product-name');
            const badgeEl = card.querySelector('.badge');
            const retryBtn = card.querySelector('.card-retry-btn');

            loadingEl.style.display = '';
            stockDisplayEl.style.display = 'none';
            errorEl.classList.add('hidden');
            nameEl.textContent = 'Loading…';
            badgeEl.textContent = 'Pending';
            badgeEl.className = 'badge pending';
            if (retryBtn) retryBtn.classList.add('hidden');
        }

        resultsData = resultsData.filter(r => r.success);

        const retryMeta = failed.map(r => ({ url: r.url, cardId: r.cardId }));
        await runWithConcurrency(retryMeta, ({ url, cardId }) => fetchStock(url, cardId), 10);

        progressIndicator.classList.add('hidden');
        retryFailedBtn.disabled = false;
        retryFailedBtn.querySelector('span').textContent = 'Retry Failed';

        const stillFailed = resultsData.filter(r => !r.success).length;
        if (stillFailed === 0) {
            retryFailedBtn.classList.add('hidden');
        }
    });

    exportCsvBtn.addEventListener('click', () => {
        if (resultsData.length === 0) return;

        const headers = ['Product Name', 'Stock Quantity', 'Status', 'URL', 'Message'];
        const rows = resultsData.map(r => [
            csvEscape(r.product_name),
            r.stock_quantity,
            r.success ? (r.stock_quantity > 0 ? 'In Stock' : 'Out of Stock') : 'Error',
            csvEscape(r.url),
            csvEscape(r.message),
        ]);

        let csv = headers.join(',') + '\n';
        for (const row of rows) {
            csv += row.join(',') + '\n';
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `knd_stock_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    });

    function csvEscape(str) {
        if (!str) return '""';
        const escaped = String(str).replace(/"/g, '""');
        return `"${escaped}"`;
    }

    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            obj.textContent = Math.floor(easeProgress * (end - start) + start);
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                obj.textContent = end;
            }
        };
        window.requestAnimationFrame(step);
    }

    function runWithConcurrency(items, fn, limit) {
        return new Promise((resolve) => {
            let index = 0;
            let active = 0;
            let settled = 0;
            const total = items.length;
            if (total === 0) return resolve();

            function next() {
                while (active < limit && index < total) {
                    const item = items[index++];
                    active++;
                    fn(item).catch(() => {}).finally(() => {
                        active--;
                        settled++;
                        if (settled === total) resolve();
                        else next();
                    });
                }
            }
            next();
        });
    }
    const kndSearchDropdown = document.getElementById('knd-search-dropdown');
    const kndSearchResults = document.getElementById('knd-search-results');
    let searchDebounceTimer = null;

    urlInlineInput.addEventListener('input', () => {
        const val = urlInlineInput.value.trim();
        if (isKndUrl(val) || val.startsWith('http://') || val.startsWith('https://')) {
            hideSearchDropdown();
            return;
        }

        if (val.length >= 2) {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                performKNDSearch(val);
            }, 300);
        } else {
            hideSearchDropdown();
        }
    });

    urlInlineInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideSearchDropdown();
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#url-chips-container') && !e.target.closest('#knd-search-dropdown')) {
            hideSearchDropdown();
        }
    });

    function hideSearchDropdown() {
        if (kndSearchDropdown) kndSearchDropdown.classList.add('hidden');
    }

    async function performKNDSearch(term) {
        if (!kndSearchDropdown || !kndSearchResults) return;

        kndSearchDropdown.classList.remove('hidden');
        kndSearchResults.innerHTML = `
            <div class="search-loading">
                <div class="loading-dots"><span></span><span></span><span></span></div>
                <p>Searching catalog for "${escapeHtml(term)}"...</p>
            </div>
        `;

        try {
            const response = await fetch(`${BACKEND_URL}/api/search?term=${encodeURIComponent(term)}`);
            const data = await response.json();

            if (data.success && data.products && data.products.length > 0) {
                renderSearchResults(data.products);
            } else {
                kndSearchResults.innerHTML = `<div class="search-empty"><p>No products found for "${escapeHtml(term)}"</p></div>`;
            }
        } catch (err) {
            kndSearchResults.innerHTML = `<div class="search-empty"><p>Error connecting to search API</p></div>`;
        }
    }

    function renderSearchResults(products) {
        kndSearchResults.innerHTML = '';
        products.forEach((p) => {
            const item = document.createElement('div');
            item.className = 'search-item';
            const imgUrl = p.image || '';

            item.innerHTML = `
                <div class="search-item__thumb">
                    ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(p.product_name)}" />` : `<i class="fa-solid fa-box"></i>`}
                </div>
                <div class="search-item__info">
                    <h4 class="search-item__name" title="${escapeHtml(p.product_name)}">${escapeHtml(p.product_name)}</h4>
                    <span class="search-item__price">${escapeHtml(p.price)}</span>
                </div>
                <button type="button" class="btn-add-search-item" title="Add to queue">
                    <i class="fa-solid fa-plus"></i>
                </button>
            `;

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (p.url) {
                    addUrls(p.url);
                    urlInlineInput.value = '';
                    hideSearchDropdown();
                }
            });

            kndSearchResults.appendChild(item);
        });
    }

    const resultsToolbar = document.getElementById('results-toolbar');
    const resultsFilterInput = document.getElementById('results-filter-input');
    const resultsSortSelect = document.getElementById('results-sort-select');
    const filterPills = document.querySelectorAll('.pill-btn');

    let currentFilter = 'all';

    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilter = pill.dataset.filter;
            applyResultsFilterAndSort();
        });
    });

    if (resultsFilterInput) resultsFilterInput.addEventListener('input', applyResultsFilterAndSort);
    if (resultsSortSelect) resultsSortSelect.addEventListener('change', applyResultsFilterAndSort);

    function applyResultsFilterAndSort() {
        const cards = Array.from(resultsGrid.querySelectorAll('.stock-card'));
        const keyword = resultsFilterInput ? resultsFilterInput.value.toLowerCase().trim() : '';

        cards.forEach(card => {
            const cardId = card.id;
            const resData = resultsData.find(r => r.cardId === cardId);
            let matchesFilter = true;

            if (currentFilter === 'instock') {
                matchesFilter = resData && resData.success && resData.stock_quantity > 0;
            } else if (currentFilter === 'outofstock') {
                matchesFilter = resData && resData.success && resData.stock_quantity === 0;
            } else if (currentFilter === 'error') {
                matchesFilter = resData && !resData.success;
            }

            let matchesSearch = true;
            if (keyword && resData) {
                const textToSearch = (resData.product_name + ' ' + resData.url).toLowerCase();
                matchesSearch = textToSearch.includes(keyword);
            }

            if (matchesFilter && matchesSearch) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });

        const sortVal = resultsSortSelect ? resultsSortSelect.value : 'default';
        if (sortVal !== 'default') {
            cards.sort((a, b) => {
                const resA = resultsData.find(r => r.cardId === a.id) || { stock_quantity: 0, product_name: '' };
                const resB = resultsData.find(r => r.cardId === b.id) || { stock_quantity: 0, product_name: '' };

                if (sortVal === 'qty-desc') {
                    return resB.stock_quantity - resA.stock_quantity;
                } else if (sortVal === 'qty-asc') {
                    return resA.stock_quantity - resB.stock_quantity;
                } else if (sortVal === 'name-asc') {
                    return resA.product_name.localeCompare(resB.product_name);
                }
                return 0;
            });

            cards.forEach(card => resultsGrid.appendChild(card));
        }
    }
});
