/*=============================================
  FLIPBOOK PRO — app.js
  Google Drive PDF Support
  Works on GitHub Pages (no backend needed)
=============================================*/

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── State ──────────────────────────────────
let STATE = {
    pdfDoc:     null,
    totalPages: 0,
    thumbnail:  null,
    pdfUrl:     null,       // final loadable URL
    driveId:    null,       // Google Drive file ID
    source:     'drive',    // 'drive' | 'upload'
    fileName:   '',
};

// ── DOM ────────────────────────────────────
const $ = id => document.getElementById(id);

const UI = {
    // Sections
    methodSection:     $('methodSection'),
    processingSection: $('processingSection'),
    titleSection:      $('titleSection'),
    successSection:    $('successSection'),
    // Drive tab
    driveLink:         $('driveLink'),
    clearDriveLink:    $('clearDriveLink'),
    loadDriveBtn:      $('loadDriveBtn'),
    linkStatus:        $('linkStatus'),
    // Upload tab
    uploadArea:        $('uploadArea'),
    pdfInput:          $('pdfInput'),
    browseBtn:         $('browseBtn'),
    // Processing
    processingTitle:   $('processingTitle'),
    processingSubtitle:$('processingSubtitle'),
    progressBar:       $('progressBar'),
    progressText:      $('progressText'),
    // Title form
    previewThumb:      $('previewThumb'),
    previewFilename:   $('previewFilename'),
    previewPages:      $('previewPages'),
    previewSource:     $('previewSource'),
    bookTitle:         $('bookTitle'),
    bookDescription:   $('bookDescription'),
    createBtn:         $('createBtn'),
    backBtn:           $('backBtn'),
    // Success
    shareLink:         $('shareLink'),
    copyLinkBtn:       $('copyLinkBtn'),
    viewBookBtn:       $('viewBookBtn'),
    createAnotherBtn:  $('createAnotherBtn'),
    // Toast
    toast:             $('toast'),
    toastMessage:      $('toastMessage'),
};

// ── Init ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    updateTotalCount();
});

// ── Bind Events ────────────────────────────
function bindEvents() {

    // Method tabs
    document.querySelectorAll('.method-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.method-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            STATE.source = tab.dataset.tab;
            $(`${tab.dataset.tab}Tab`).classList.add('active');
        });
    });

    // Drive input — live validation
    UI.driveLink.addEventListener('input', () => validateDriveLink());
    UI.driveLink.addEventListener('paste', () => setTimeout(validateDriveLink, 50));
    UI.clearDriveLink.addEventListener('click', () => {
        UI.driveLink.value = '';
        UI.linkStatus.innerHTML = '';
        UI.linkStatus.className = 'link-status';
    });

    // Load from Drive
    UI.loadDriveBtn.addEventListener('click', handleDriveLoad);
    UI.driveLink.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleDriveLoad();
    });

    // Upload tab
    UI.browseBtn.addEventListener('click', e => {
        e.stopPropagation();
        UI.pdfInput.click();
    });
    UI.uploadArea.addEventListener('click', () => UI.pdfInput.click());
    UI.pdfInput.addEventListener('change', e => {
        if (e.target.files[0]) handleUpload(e.target.files[0]);
    });
    UI.uploadArea.addEventListener('dragover', e => {
        e.preventDefault();
        UI.uploadArea.classList.add('drag-over');
    });
    UI.uploadArea.addEventListener('dragleave', () => {
        UI.uploadArea.classList.remove('drag-over');
    });
    UI.uploadArea.addEventListener('drop', e => {
        e.preventDefault();
        UI.uploadArea.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
    });

    // Title form
    UI.createBtn.addEventListener('click', createFlipbook);
    UI.backBtn.addEventListener('click', resetToMethod);

    // Success
    UI.copyLinkBtn.addEventListener('click', () => copyText(UI.shareLink.value));
    UI.createAnotherBtn.addEventListener('click', resetAll);

    // Mobile nav
    $('mobileToggle')?.addEventListener('click', () => {
        $('mobileMenu')?.classList.toggle('active');
    });
}

// ══════════════════════════════════════════
//  GOOGLE DRIVE HANDLING
// ══════════════════════════════════════════

/*
  Google Drive link formats we need to handle:
  
  1. Share link:
     https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  
  2. Open link:
     https://drive.google.com/open?id=FILE_ID
  
  3. Direct download:
     https://drive.google.com/uc?id=FILE_ID&export=download
  
  4. Export link:
     https://docs.google.com/document/d/FILE_ID/export?format=pdf
  
  We extract FILE_ID and build a loadable URL.
*/

function extractDriveFileId(url) {
    if (!url || typeof url !== 'string') return null;
    url = url.trim();

    // Pattern 1: /file/d/FILE_ID/
    let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];

    // Pattern 2: ?id=FILE_ID or &id=FILE_ID
    m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) return m[1];

    // Pattern 3: /d/FILE_ID (docs/sheets export)
    m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];

    // Pattern 4: Raw file ID (just the ID itself)
    if (/^[a-zA-Z0-9_-]{25,}$/.test(url)) return url;

    return null;
}

function buildDriveUrls(fileId) {
    // We try multiple URL formats because Drive
    // sometimes blocks direct downloads (CORS)
    return [
        // Format 1: uc export (most common)
        `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
        // Format 2: Thumbnail/preview base
        `https://drive.google.com/file/d/${fileId}/preview`,
        // Format 3: Google Docs viewer (as proxy)
        `https://docs.google.com/viewer?url=https://drive.google.com/uc?id=${fileId}&embedded=true`,
    ];
}

// Build a CORS-friendly URL using a proxy
function getCorsProxyUrl(fileId) {
    // These are free CORS proxies — use as fallback
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    
    // Option A: allorigins proxy
    return `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`;
    
    // Option B: corsproxy.io (uncomment if A fails)
    // return `https://corsproxy.io/?${encodeURIComponent(directUrl)}`;
}

function validateDriveLink() {
    const val = UI.driveLink.value.trim();
    if (!val) {
        UI.linkStatus.innerHTML = '';
        UI.linkStatus.className = 'link-status';
        return false;
    }

    const id = extractDriveFileId(val);

    if (id) {
        UI.linkStatus.innerHTML = `
            <i class="fas fa-check-circle"></i>
            Valid Google Drive link detected
        `;
        UI.linkStatus.className = 'link-status valid';
        return true;
    } else {
        UI.linkStatus.innerHTML = `
            <i class="fas fa-exclamation-circle"></i>
            Doesn't look like a Google Drive link
        `;
        UI.linkStatus.className = 'link-status invalid';
        return false;
    }
}

async function handleDriveLoad() {
    const raw = UI.driveLink.value.trim();
    if (!raw) return showToast('Please paste a Google Drive link', 'error');

    const fileId = extractDriveFileId(raw);
    if (!fileId) return showToast('Invalid Google Drive link', 'error');

    STATE.driveId = fileId;
    STATE.source  = 'drive';

    // Show processing screen
    showSection('processing');
    setProgress(10, 'Connecting to Google Drive...');

    try {
        // Try loading PDF directly
        const pdfUrl = await tryLoadDrivePdf(fileId);
        STATE.pdfUrl = pdfUrl;

        setProgress(60, 'Reading PDF pages...');
        await loadPdfInfo(pdfUrl, `drive_${fileId}.pdf`);

    } catch (err) {
        console.error('Drive load failed:', err);
        showToast(
            'Could not load PDF. Make sure sharing is set to "Anyone with the link".',
            'error'
        );
        resetToMethod();
    }
}

async function tryLoadDrivePdf(fileId) {
    // Strategy: try direct URL first, then CORS proxy
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    const proxyUrl  = getCorsProxyUrl(fileId);

    // Try direct first (works if CORS is ok)
    try {
        setProgress(20, 'Trying direct connection...');
        const doc = await pdfjsLib.getDocument({
            url: directUrl,
            withCredentials: false,
        }).promise;

        // If we get here, direct worked!
        STATE.pdfUrl = directUrl;
        return directUrl;

    } catch (directErr) {
        console.warn('Direct load failed, trying proxy...', directErr);
        
        // Try via CORS proxy
        try {
            setProgress(35, 'Using proxy connection...');
            const doc = await pdfjsLib.getDocument({
                url: proxyUrl,
                withCredentials: false,
            }).promise;

            STATE.pdfUrl = proxyUrl;
            return proxyUrl;

        } catch (proxyErr) {
            console.error('Proxy also failed:', proxyErr);
            throw new Error('Could not access PDF. Check sharing settings.');
        }
    }
}

// ══════════════════════════════════════════
//  FILE UPLOAD HANDLING
// ══════════════════════════════════════════

async function handleUpload(file) {
    if (file.type !== 'application/pdf') {
        return showToast('Only PDF files are supported', 'error');
    }

    STATE.source   = 'upload';
    STATE.fileName = file.name;

    showSection('processing');
    setProgress(10, 'Reading PDF...');

    try {
        // Create a local blob URL for this session
        const blobUrl = URL.createObjectURL(file);
        STATE.pdfUrl  = blobUrl;

        // Also store in IndexedDB for persistence
        await storeInIndexedDB(file);

        await loadPdfInfo(blobUrl, file.name);

    } catch (err) {
        console.error(err);
        showToast('Error reading PDF: ' + err.message, 'error');
        resetToMethod();
    }
}

// ══════════════════════════════════════════
//  PDF INFO LOADING (shared by both methods)
// ══════════════════════════════════════════

async function loadPdfInfo(pdfUrl, fileName) {
    setProgress(60, 'Analyzing document...');

    STATE.pdfDoc = await pdfjsLib.getDocument({
        url: pdfUrl,
        withCredentials: false,
    }).promise;

    STATE.totalPages = STATE.pdfDoc.numPages;
    STATE.fileName   = fileName;

    setProgress(80, 'Generating preview...');

    // Render first page as thumbnail
    STATE.thumbnail = await renderPageToJpeg(STATE.pdfDoc, 1, 0.4);

    setProgress(100, 'Ready!');
    await sleep(300);

    // Show title form
    showSection('title');
    populateTitleForm();
}

function populateTitleForm() {
    // Set preview image
    UI.previewThumb.src = STATE.thumbnail;

    // Set filename
    UI.previewFilename.textContent = STATE.fileName.replace(/\.pdf$/i, '');

    // Set page count
    UI.previewPages.textContent = `${STATE.totalPages} pages`;

    // Set source badge
    if (STATE.source === 'drive') {
        UI.previewSource.innerHTML = `<i class="fab fa-google-drive" style="color:#4285F4"></i> Google Drive`;
    } else {
        UI.previewSource.innerHTML = `<i class="fas fa-upload" style="color:var(--primary)"></i> Local Upload`;
    }

    // Auto-fill title
    const autoTitle = STATE.fileName
        .replace(/\.pdf$/i, '')
        .replace(/[_\-]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
    UI.bookTitle.value = autoTitle;
    UI.bookTitle.focus();
    UI.bookTitle.select();
}

// ══════════════════════════════════════════
//  CREATE FLIPBOOK
// ══════════════════════════════════════════

async function createFlipbook() {
    const title = UI.bookTitle.value.trim();
    const desc  = UI.bookDescription.value.trim();

    if (!title) {
        showToast('Please enter a title', 'error');
        return UI.bookTitle.focus();
    }

    UI.createBtn.disabled = true;
    UI.createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

    try {
        const id        = makeId();
        const createdAt = new Date().toISOString();
        const shareUrl  = `${APP_CONFIG.BASE_URL}viewer.html?id=${id}`;

        const book = {
            id,
            title,
            description: desc,
            fileName:    STATE.fileName,
            totalPages:  STATE.totalPages,
            thumbnail:   STATE.thumbnail,
            pdfUrl:      STATE.pdfUrl,
            driveId:     STATE.driveId,     // store Drive ID separately
            source:      STATE.source,
            createdAt,
            shareUrl,
        };

        // Save metadata
        saveBook(book);

        // Sync to Google Sheets
        pushToSheets(book);

        // Show success
        showSection('success');
        UI.shareLink.value  = shareUrl;
        UI.viewBookBtn.href = shareUrl;

        updateTotalCount();
        showToast('FlipBook created! 🎉');

    } catch (err) {
        console.error(err);
        showToast('Error: ' + err.message, 'error');
    } finally {
        UI.createBtn.disabled = false;
        UI.createBtn.innerHTML = '<i class="fas fa-book-open"></i> Create FlipBook';
    }
}

// ── Google Sheets Sync ─────────────────────
async function pushToSheets(book) {
    const url = APP_CONFIG.GOOGLE_SCRIPT_URL;
    if (!url || url.includes('YOUR_')) return;

    try {
        await fetch(url, {
            method:  'POST',
            mode:    'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id:          book.id,
                title:       book.title,
                description: book.description,
                fileName:    book.fileName,
                totalPages:  book.totalPages,
                source:      book.source,
                driveId:     book.driveId || '',
                pdfUrl:      book.pdfUrl,
                shareUrl:    book.shareUrl,
                createdAt:   book.createdAt,
            }),
        });
        console.log('Synced to Google Sheets ✓');
    } catch (e) {
        console.warn('Sheets sync skipped:', e.message);
    }
}

// ── IndexedDB (for local uploads only) ─────
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('FlipBookProDB', 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('pdfs')) {
                db.createObjectStore('pdfs', { keyPath: 'id' });
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

async function storeInIndexedDB(file) {
    // Only for local uploads (Drive files load from URL directly)
    try {
        const db = await openDB();
        const tx = db.transaction('pdfs', 'readwrite');
        tx.objectStore('pdfs').put({ id: `upload_${Date.now()}`, file });
    } catch (e) {
        console.warn('IndexedDB store failed:', e);
    }
}

// ── LocalStorage ───────────────────────────
function saveBook(book) {
    const all = getBooks();
    all.unshift(book);
    try {
        localStorage.setItem(APP_CONFIG.STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
        // Storage full — remove old entries
        all.splice(20);
        try { localStorage.setItem(APP_CONFIG.STORAGE_KEY, JSON.stringify(all)); } catch {}
    }
}

function getBooks() {
    try {
        return JSON.parse(localStorage.getItem(APP_CONFIG.STORAGE_KEY)) || [];
    } catch { return []; }
}

// ── Render Page ────────────────────────────
async function renderPageToJpeg(pdfDoc, pageNum, scale = 1.0) {
    const page     = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.8);
}

// ── UI Helpers ─────────────────────────────
function showSection(name) {
    UI.methodSection.style.display      = name === 'method'     ? 'block' : 'none';
    UI.processingSection.style.display  = name === 'processing' ? 'block' : 'none';
    UI.titleSection.style.display       = name === 'title'      ? 'block' : 'none';
    UI.successSection.style.display     = name === 'success'    ? 'block' : 'none';
}

function setProgress(pct, text) {
    UI.progressBar.style.width  = `${pct}%`;
    UI.progressText.textContent = text;
}

function resetToMethod() {
    STATE = { pdfDoc: null, totalPages: 0, thumbnail: null, pdfUrl: null, driveId: null, source: 'drive', fileName: '' };
    UI.progressBar.style.width = '0%';
    showSection('method');
}

function resetAll() {
    UI.driveLink.value          = '';
    UI.bookTitle.value          = '';
    UI.bookDescription.value    = '';
    UI.linkStatus.innerHTML     = '';
    UI.pdfInput.value           = '';
    resetToMethod();
}

function updateTotalCount() {
    const el = document.getElementById('totalBooks');
    if (el) el.textContent = getBooks().length;
}

function copyText(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            UI.copyLinkBtn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => UI.copyLinkBtn.innerHTML = '<i class="fas fa-copy"></i>', 2000);
            showToast('Copied!');
        })
        .catch(() => showToast('Copy failed', 'error'));
}

function showToast(msg, type = 'success') {
    UI.toastMessage.textContent = msg;
    const icon = UI.toast.querySelector('i');
    icon.className  = type === 'error' ? 'fas fa-exclamation-circle' : 'fas fa-check-circle';
    icon.style.color = type === 'error' ? 'var(--danger)' : 'var(--success)';
    UI.toast.classList.add('show');
    setTimeout(() => UI.toast.classList.remove('show'), 3500);
}

function makeId() {
    return 'fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}