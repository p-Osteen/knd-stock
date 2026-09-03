document.addEventListener('DOMContentLoaded', () => {
    // ── Safari / iOS polyfill ────────────────────────────────
    // requestIdleCallback is not supported in Safari (macOS or iOS).
    // Fall back to setTimeout so deferred work still runs.
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
    const urlsInput = document.getElementById('product-urls'); // hidden textarea for form compat
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

    const BACKEND_URL = atob("aHR0cHM6Ly9rbmQtc3RvY2sub25yZW5kZXIuY29t");

    // ── URL Chips State ──────────────────────────────────────
    let urls = [];

    // ── Perf: pre-parsed URL parts cache (avoids re-parsing on every scroll) ──
    let parsedUrlCache = []; // { domain, path } aligned with urls[]
    let totalChars = 0;      // running total so we don't need urls.join().length

    // ── Theme Toggle ──────────────────────────────────────────
    const savedTheme = localStorage.getItem('knd-theme') || 'dark';
    applyTheme(savedTheme);

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

    // ── URL Chip Management ──────────────────────────────────
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

        // Separate valid karzanddolls.com URLs from invalid ones
        const valid = [];
        const invalid = [];
        candidates.forEach(u => {
            if (isKndUrl(u)) {
                valid.push(u);
            } else {
                invalid.push(u);
            }
        });

        // Show error for rejected URLs
        if (invalid.length > 0) {
            const msg = invalid.length === 1
                ? 'Only karzanddolls.com URLs are allowed.'
                : `${invalid.length} non-karzanddolls.com URLs were rejected.`;
            showNotification(msg, 'error');
        }

        if (valid.length === 0) return;

        // Hide notification if all URLs were valid
        if (invalid.length === 0) hideNotification();

        // Pre-parse and cache URL parts for new entries
        for (const u of valid) {
            urls.push(u);
            parsedUrlCache.push(parseUrlParts(u));
            totalChars += u.length;
        }
        // Account for newline separators between URLs
        if (urls.length > valid.length) {
            totalChars += valid.length; // newlines joining new URLs
        } else {
            totalChars += valid.length - 1; // first batch has no leading newline
        }

        renderChips();
        syncHiddenTextareaDeferred();
        updateCounters();

        // Scroll to bottom to show new chips
        requestAnimationFrame(() => {
            chipsScroll.scrollTop = chipsScroll.scrollHeight;
        });
    }

    function removeUrl(index) {
        const removed = urls[index];
        totalChars -= removed.length;
        // Remove the newline separator
        if (urls.length > 1) totalChars -= 1;

        urls.splice(index, 1);
        parsedUrlCache.splice(index, 1);
        renderChips();
        syncHiddenTextareaDeferred();
        updateCounters();
    }

    function clearAllUrls() {
        urls = [];
        parsedUrlCache = [];
        totalChars = 0;
        renderChips();
        syncHiddenTextareaDeferred();
        updateCounters();
    }

    // ── Deferred hidden textarea sync (not needed on every keystroke) ──
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

    // Force-sync before submit
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

    // ── Virtual Scroll Constants ─────────────────────────────
    const CHIP_HEIGHT = 44; // px – height of one .url-chip including gap
    const CHIP_BUFFER = 10; // extra chips above/below viewport

    let chipRenderRAF = null; // dedup render calls
    let isScrollRender = false; // true when render is triggered by scroll (skip animations)

    // ── DOM Recycling Pool for Chips ─────────────────────────
    // Instead of innerHTML='' + rebuild, we reuse chip DOM nodes
    const chipPool = [];

    function acquireChip() {
        if (chipPool.length > 0) return chipPool.pop();
        // Build a chip DOM node from scratch (only once, then recycled)
        const chip = document.createElement('div');
        chip.className = 'url-chip';
        chip.style.cursor = 'pointer';

        const idx = document.createElement('span');
        idx.className = 'url-chip__index';

        const textSpan = document.createElement('span');
        textSpan.className = 'url-chip__text';

        const domain = document.createElement('span');
        domain.className = 'url-chip__domain';

        const path = document.createElement('span');
        path.className = 'url-chip__path';

        textSpan.appendChild(domain);
        textSpan.appendChild(path);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'url-chip__remove';
        btn.title = 'Remove URL';
        btn.setAttribute('aria-label', 'Remove URL');
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        chip.appendChild(idx);
        chip.appendChild(textSpan);
        chip.appendChild(btn);

        return chip;
    }

    function releaseChip(chip) {
        chipPool.push(chip);
    }

    function renderChips() {
        // Debounce: if a render is already scheduled, skip
        if (chipRenderRAF) cancelAnimationFrame(chipRenderRAF);
        chipRenderRAF = requestAnimationFrame(_renderChipsVirtual);
    }

    // Track currently rendered range to skip no-op renders
    let lastStartIdx = -1, lastEndIdx = -1, lastUrlsLength = -1;

    function _renderChipsVirtual() {
        chipRenderRAF = null;
        const scrollTop = chipsScroll.scrollTop;
        const viewHeight = chipsScroll.clientHeight;

        const totalHeight = urls.length * CHIP_HEIGHT;

        // Determine visible range
        let startIdx = Math.floor(scrollTop / CHIP_HEIGHT) - CHIP_BUFFER;
        let endIdx = Math.ceil((scrollTop + viewHeight) / CHIP_HEIGHT) + CHIP_BUFFER;
        startIdx = Math.max(0, startIdx);
        endIdx = Math.min(urls.length, endIdx);

        // Skip render if range hasn't changed
        if (startIdx === lastStartIdx && endIdx === lastEndIdx && urls.length === lastUrlsLength) {
            isScrollRender = false;
            return;
        }
        lastStartIdx = startIdx;
        lastEndIdx = endIdx;
        lastUrlsLength = urls.length;

        // Recycle old chip nodes
        const oldChips = chipsList.querySelectorAll('.url-chip');
        for (let i = oldChips.length - 1; i >= 0; i--) {
            releaseChip(oldChips[i]);
        }

        // Build fragment for visible chips only
        const fragment = document.createDocumentFragment();

        // Top spacer
        const topSpacer = document.createElement('div');
        topSpacer.style.height = `${startIdx * CHIP_HEIGHT}px`;
        topSpacer.style.flexShrink = '0';
        fragment.appendChild(topSpacer);

        for (let index = startIdx; index < endIdx; index++) {
            const cached = parsedUrlCache[index];
            const chip = acquireChip();

            // Skip entry animation on scroll-triggered renders
            if (isScrollRender) {
                chip.style.animation = 'none';
                chip.style.animationDelay = '';
            } else {
                chip.style.animation = '';
                // Cap animation delay so we don't queue thousands of staggered animations
                chip.style.animationDelay = `${Math.min(index - startIdx, 15) * 0.03}s`;
            }

            // Update content via direct property access (no innerHTML parsing)
            const idxEl = chip.children[0]; // .url-chip__index
            const textEl = chip.children[1]; // .url-chip__text
            const removeBtn = chip.children[2]; // .url-chip__remove

            idxEl.textContent = index + 1;
            textEl.children[0].innerHTML = cached.domain; // already escaped
            textEl.children[1].innerHTML = cached.path;   // already escaped
            removeBtn.dataset.index = index;

            fragment.appendChild(chip);
        }

        // Bottom spacer
        const bottomSpacer = document.createElement('div');
        bottomSpacer.style.height = `${(urls.length - endIdx) * CHIP_HEIGHT}px`;
        bottomSpacer.style.flexShrink = '0';
        fragment.appendChild(bottomSpacer);

        chipsList.innerHTML = '';
        chipsList.appendChild(fragment);

        isScrollRender = false;
    }

    // Re-render on scroll (virtual scroll driver)
    chipsScroll.addEventListener('scroll', () => {
        isScrollRender = true;
        renderChips();
    }, { passive: true });

    // Event delegation for chip clicks (remove + open URL)
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

    // Reusable element for HTML escaping (single allocation, reused forever)
    const _escapeDiv = document.createElement('div');
    function escapeHtml(str) {
        _escapeDiv.textContent = str;
        return _escapeDiv.innerHTML;
    }

    // ── Inline Input Handlers ────────────────────────────────
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
        // Backspace on empty input removes last chip
        if (e.key === 'Backspace' && urlInlineInput.value === '' && urls.length > 0) {
            removeUrl(urls.length - 1);
        }
    });

    // ── Paste Button ─────────────────────────────────────────
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text.trim()) {
                addUrls(text);
                urlInlineInput.value = '';
                urlInlineInput.focus();
            }
        } catch {
            // Fallback: focus the input so user can Ctrl+V
            urlInlineInput.focus();
        }
    });

    // ── Lazy SheetJS (XLSX) Loader ─────────────────────────────
    // Instead of a render-blocking 500KB script in <head>,
    // load it on-demand only when user uploads an Excel file.
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

    // ── File Upload Button ───────────────────────────────────
    const FILE_UPLOAD_CONFIG = {
        maxSizeBytes: 5 * 1024 * 1024,          // 5 MB
        maxSizeLabel: '5MB',
        allowedExtensions: ['.csv', '.txt', '.xlsx', '.xls'],
        allowedMimeTypes: [
            'text/csv',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/octet-stream',          // fallback for some browsers
        ],
        // Magic bytes for file type verification
        magicBytes: {
            xlsx: [0x50, 0x4B, 0x03, 0x04],      // ZIP (OOXML)
            xls:  [0xD0, 0xCF, 0x11, 0xE0],      // OLE2 Compound
        },
        // Dangerous patterns to reject (script injection, macros, etc.)
        dangerousPatterns: [
            /<script[\s>]/i,
            /javascript:/i,
            /on\w+\s*=/i,                          // onerror=, onclick=, etc.
            /data:\s*text\/html/i,
            /vbscript:/i,
            /expression\s*\(/i,                    // CSS expression()
            /<iframe/i,
            /<object/i,
            /<embed/i,
            /<link[\s>]/i,
            /<import/i,
        ],
    };

    uploadBtn.addEventListener('click', () => {
        // Reset so the same file can be re-selected
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
        // ── 1. Extension whitelist ────────────────────────────
        const fileName = file.name.toLowerCase();
        const ext = '.' + fileName.split('.').pop();
        if (!FILE_UPLOAD_CONFIG.allowedExtensions.includes(ext)) {
            throw new Error(`Invalid file type "${ext}". Only CSV, TXT, XLSX, and XLS files are allowed.`);
        }

        // ── 2. Double-extension attack detection ──────────────
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

        // ── 3. MIME type check ────────────────────────────────
        if (file.type && !FILE_UPLOAD_CONFIG.allowedMimeTypes.includes(file.type)) {
            throw new Error(`Unsupported MIME type "${file.type}". Upload a CSV, TXT, or Excel file.`);
        }

        // ── 4. File size limit ────────────────────────────────
        if (file.size > FILE_UPLOAD_CONFIG.maxSizeBytes) {
            throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${FILE_UPLOAD_CONFIG.maxSizeLabel}.`);
        }

        if (file.size === 0) {
            throw new Error('File is empty.');
        }

        // ── 5. Read file bytes and verify magic bytes ────────
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
            // CSV / TXT — verify it's actually text (no null bytes in first 8KB)
            const sample = new Uint8Array(arrayBuffer.slice(0, 8192));
            if (containsNullBytes(sample)) {
                throw new Error('File appears to be binary, not a text file. Upload was rejected.');
            }
        }

        // ── 6. Extract text content ──────────────────────────
        let textContent;
        if (ext === '.xlsx' || ext === '.xls') {
            // Lazy-load SheetJS only when an Excel file is actually uploaded
            await ensureXLSXLoaded();
            textContent = extractTextFromExcel(arrayBuffer);
        } else {
            textContent = new TextDecoder('utf-8').decode(arrayBuffer);
        }

        // ── 7. Sanitization — block script injection ─────────
        for (const pattern of FILE_UPLOAD_CONFIG.dangerousPatterns) {
            if (pattern.test(textContent)) {
                throw new Error('File contains potentially malicious content and was rejected.');
            }
        }

        // ── 8. Limit raw text length (prevent memory abuse) ──
        const MAX_TEXT_LENGTH = 2 * 1024 * 1024; // 2MB of text
        if (textContent.length > MAX_TEXT_LENGTH) {
            throw new Error('File content is too large to process safely.');
        }

        // ── 9. Extract URLs from content ─────────────────────
        const extractedUrls = extractUrlsFromText(textContent);

        if (extractedUrls.length === 0) {
            showNotification('No URLs found in the uploaded file.', 'warning');
            return;
        }

        // Pass through addUrls which handles karzanddolls.com validation
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
        // Match http/https URLs — generous but safe pattern
        const urlRegex = /https?:\/\/[^\s,;"'<>()[\]{}|\\^`]+/gi;
        const matches = text.match(urlRegex) || [];

        // Clean trailing punctuation that may have been captured
        const cleaned = matches.map(u => u.replace(/[.,;:!?)\]]+$/, ''));

        // Deduplicate
        return [...new Set(cleaned)];
    }

    // ── Live URL & Char Counter ───────────────────────────────
    function updateCounters() {
        const count = urls.length;
        urlCounter.textContent = `${count} URL${count !== 1 ? 's' : ''}`;
        // Use the running total instead of O(n) join
        charCounter.textContent = `${Math.max(0, totalChars)} chars`;
    }

    // ── Notifications ─────────────────────────────────────────
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

    // ── Clear Button ──────────────────────────────────────────
    clearBtn.addEventListener('click', () => {
        clearAllUrls();
        urlInlineInput.value = '';
        resultsGrid.innerHTML = '';
        hideNotification();
        clearBtn.classList.add('hidden');
        resultsHeader.classList.add('hidden');
        emptyState.classList.remove('hidden');
        urlInlineInput.focus();
    });

    // ── Form Submit ───────────────────────────────────────────
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideNotification();

        // Force-sync the hidden textarea before reading it
        syncHiddenTextareaImmediate();

        // Also check if user typed something but didn't press Enter
        const pendingInput = urlInlineInput.value.trim();
        if (pendingInput) {
            addUrls(pendingInput);
            urlInlineInput.value = '';
        }

        if (urls.length === 0) {
            showNotification('Please enter at least one URL.', 'error');
            return;
        }

        // Extract valid HTTP URLs
        let rawUrls = urls.filter(url => url.startsWith('http'));

        if (rawUrls.length === 0) {
            showNotification('No valid HTTP/HTTPS URLs found.', 'error');
            return;
        }

        // Domain validation
        const validUrls = rawUrls.filter(url => {
            try {
                const parsed = new URL(url);
                return parsed.hostname.includes('karzanddolls.com');
            } catch (e) {
                return false;
            }
        });

        // Deduplication
        const uniqueUrls = [...new Set(validUrls)];

        // Generate warnings if necessary
        const hadInvalidDomains = rawUrls.length !== validUrls.length;
        const hadDuplicates = validUrls.length !== uniqueUrls.length;

        if (uniqueUrls.length === 0) {
            showNotification('None of the entered URLs are valid karzanddolls.com links.', 'error');
            return;
        }

        if (hadInvalidDomains && hadDuplicates) {
            showNotification(`Removed invalid domains and duplicate URLs. Checking ${uniqueUrls.length} item${uniqueUrls.length !== 1 ? 's' : ''}…`, 'warning');
        } else if (hadInvalidDomains) {
            showNotification(`Removed non-karzanddolls.com URLs. Checking ${uniqueUrls.length} item${uniqueUrls.length !== 1 ? 's' : ''}…`, 'warning');
        } else if (hadDuplicates) {
            showNotification(`Removed duplicate URLs. Checking ${uniqueUrls.length} item${uniqueUrls.length !== 1 ? 's' : ''}…`, 'warning');
        }

        // Disable inputs during processing
        setLoading(true);

        // Clear previous results
        resultsGrid.innerHTML = '';

        // Hide empty state, show results header
        emptyState.classList.add('hidden');
        resultsHeader.classList.remove('hidden');
        resultsCount.textContent = `${uniqueUrls.length} product${uniqueUrls.length !== 1 ? 's' : ''}`;

        // Batch-insert all loading cards at once (single reflow)
        const fragment = document.createDocumentFragment();
        const cardMeta = uniqueUrls.map((url, index) => {
            const cardId = `card-${Date.now()}-${index}`;
            const cardElement = createLoadingCard(cardId, url, index);
            fragment.appendChild(cardElement);
            return { url, cardId };
        });
        resultsGrid.appendChild(fragment);

        // Throttled fetch — max 10 concurrent requests
        await runWithConcurrency(cardMeta, ({ url, cardId }) => fetchStock(url, cardId), 10);

        setLoading(false);
        clearBtn.classList.remove('hidden');
    });

    // ── Loading State ─────────────────────────────────────────
    function setLoading(loading) {
        submitBtn.disabled = loading;
        urlInlineInput.disabled = loading;

        // Disable chip remove buttons
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

    // ── Fetch Stock ───────────────────────────────────────────
    async function fetchStock(url, cardId) {
        const card = document.getElementById(cardId);
        const nameEl = card.querySelector('.product-name');
        const badgeEl = card.querySelector('.badge');
        const stockDisplayEl = card.querySelector('.stock-display');
        const qtyEl = card.querySelector('.stock-quantity');
        const errorEl = card.querySelector('.error-text');
        const loadingEl = card.querySelector('.loading-state');

        try {
            const response = await fetch(`${BACKEND_URL}/api/check-stock?url=${encodeURIComponent(url)}`);
            const data = await response.json();

            loadingEl.style.display = 'none';

            if (data.success) {
                stockDisplayEl.style.display = 'flex';
                nameEl.textContent = data.product_name;

                // Animate number
                animateValue(qtyEl, 0, data.stock_quantity, 900);

                if (data.stock_quantity > 0) {
                    badgeEl.textContent = 'In Stock';
                    badgeEl.className = 'badge in-stock';
                } else {
                    badgeEl.textContent = 'Out of Stock';
                    badgeEl.className = 'badge out-of-stock';
                }
            } else {
                showCardError(card, loadingEl, stockDisplayEl, badgeEl, nameEl, errorEl, data.message);
            }
        } catch (error) {
            showCardError(card, loadingEl, stockDisplayEl, badgeEl, nameEl, errorEl, 'Failed to connect to server.');
        }
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

    // ── Create Loading Card ───────────────────────────────────
    function createLoadingCard(id, url, index) {
        const card = document.createElement('div');
        card.className = 'card';
        card.id = id;
        // Cap animation delay at ~40 cards to avoid huge queues with 1000+ items
        card.style.animationDelay = `${Math.min(index, 40) * 0.08}s`;
        card.style.cursor = 'pointer';
        card.setAttribute('data-url', url);
        card.addEventListener('click', () => window.open(url, '_blank'));

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

            <div class="card-url">${escapeHtml(shortUrl)}</div>
        `;
        return card;
    }

    // ── Animate Value ─────────────────────────────────────────
    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // Ease-out cubic
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

    // ── Concurrency Limiter ───────────────────────────────────
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
});
