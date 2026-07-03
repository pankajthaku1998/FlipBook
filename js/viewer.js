/*=============================================
  FLIPBOOK PRO — viewer.js
  Handles Google Drive and local PDFs
=============================================*/

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let bookMeta   = null;
let pdfDoc     = null;
let spread     = 0;
let totalPages = 0;
let isDouble   = window.innerWidth > 900;
let zoom       = 1.0;
let busy       = false;
const cache    = new Map();
const MAX_CACHE = 8;

const V = {
    loading:      document.getElementById('viewerLoading'),
    error:        document.getElementById('viewerError'),
    errorMsg:     document.querySelector('#viewerError p'),
    loadStatus:   document.getElementById('loadingStatus'),
    titleDisplay: document.getElementById('bookTitleDisplay'),
    container:    document.getElementById('flipbookContainer'),
    currentNum:   document.getElementById('currentPageNum'),
    totalNum:     document.getElementById('totalPageNum'),
    zoomLevel:    document.getElementById('zoomLevel'),
    thumbSidebar: document.getElementById('thumbnailSidebar'),
    thumbList:    document.getElementById('thumbnailList'),
    shareModal:   document.getElementById('shareModal'),
    shareInput:   document.getElementById('viewerShareLink'),
};

document.addEventListener('DOMContentLoaded', () => {
    bootViewer();
    bindViewerEvents();
    window.addEventListener('resize', () => {
        const prev = isDouble;
        isDouble = window.innerWidth > 900;
        if (prev !== isDouble) { cache.clear(); renderSpread(); }
    });
});

// ── Boot ───────────────────────────────────
async function bootViewer() {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) return showErr('No flipbook ID provided.');

    // Load book metadata
    bookMeta = getLocalBook(id);

    if (!bookMeta) {
        bookMeta = await fetchFromSheets(id);
        if (bookMeta) saveLocalBook(bookMeta);
    }

    if (!bookMeta) {
        return showErr('FlipBook not found. It may have been created on a different device. Try opening the original link again from the same browser.');
    }

    document.title   = bookMeta.title + ' — FlipBookPro';
    V.titleDisplay.textContent = bookMeta.title;
    V.shareInput.value         = window.location.href;

    // Load PDF from URL
    try {
        const pdfUrl = resolvePdfUrl(bookMeta);
        V.loadStatus.textContent = 'Loading PDF...';

        pdfDoc = await pdfjsLib.getDocument({
            url: pdfUrl,
            withCredentials: false,
        }).promise;

        totalPages = pdfDoc.numPages;
        V.totalNum.textContent = totalPages;

        V.loadStatus.textContent = 'Rendering...';
        await renderSpread();
        buildThumbs();
        V.loading.style.display = 'none';
        preloadNeighbours();

    } catch (err) {
        console.error('PDF load error:', err);

        // If Drive URL failed, try proxy
        if (bookMeta.driveId) {
            await retryWithProxy(bookMeta.driveId);
        } else {
            showErr('Could not load the PDF. ' + err.message);
        }
    }
}

// Retry Google Drive load via proxy
async function retryWithProxy(driveId) {
    V.loadStatus.textContent = 'Retrying via proxy...';
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(
        `https://drive.google.com/uc?export=download&id=${driveId}&confirm=t`
    )}`;

    try {
        pdfDoc = await pdfjsLib.getDocument({
            url: proxyUrl,
            withCredentials: false,
        }).promise;

        totalPages = pdfDoc.numPages;
        V.totalNum.textContent = totalPages;

        await renderSpread();
        buildThumbs();
        V.loading.style.display = 'none';

    } catch (err2) {
        showErr(
            'Could not load the PDF from Google Drive. ' +
            'Please ensure the file is shared as "Anyone with the link".'
        );
    }
}

// Build the correct PDF URL based on source
function resolvePdfUrl(book) {
    // If it's a Google Drive book, build a fresh download URL
    if (book.driveId) {
        return `https://drive.google.com/uc?export=download&id=${book.driveId}&confirm=t`;
    }
    // Otherwise use stored URL (blob or other)
    return book.pdfUrl;
}

// Fetch from Google Sheets as fallback
async function fetchFromSheets(id) {
    const url = APP_CONFIG?.GOOGLE_SCRIPT_URL;
    if (!url || url.includes('YOUR_')) return null;

    try {
        const res  = await fetch(`${url}?action=getBook&id=${id}`);
        const data = await res.json();
        return (data && data.id) ? data : null;
    } catch (e) {
        return null;
    }
}

// ── Render ─────────────────────────────────
async function renderSpread() {
    if (busy) return;
    busy = true;
    V.container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'simple-page-view';
    wrap.style.transform = `scale(${zoom})`;

    try {
        if (isDouble && totalPages > 1) {
            const l = spread * 2;
            const r = spread * 2 + 1;
            if (l < totalPages) wrap.appendChild(await mkPage(l + 1));
            if (r < totalPages) wrap.appendChild(await mkPage(r + 1));
        } else {
            if (spread < totalPages) wrap.appendChild(await mkPage(spread + 1, true));
        }
    } catch (err) {
        console.error('Render error:', err);
    }

    V.container.appendChild(wrap);
    updateIndicator();
    highlightThumb();
    busy = false;
    preloadNeighbours();
}

async function mkPage(pageNum, single = false) {
    const src = await getPageImg(pageNum);
    const div = document.createElement('div');
    div.className = 'simple-page' + (single ? ' single' : '');
    const img = document.createElement('img');
    img.src = src;
    img.draggable = false;
    div.appendChild(img);
    return div;
}

async function getPageImg(pageNum) {
    if (cache.has(pageNum)) return cache.get(pageNum);

    const page     = await pdfDoc.getPage(pageNum);
    const scale    = calcScale();
    const viewport = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const url = canvas.toDataURL('image/jpeg', 0.88);

    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(pageNum, url);
    return url;
}

function calcScale() {
    const maxH = window.innerHeight - 80;
    const maxW = isDouble ? (window.innerWidth - 160) / 2 : window.innerWidth - 100;
    return Math.min(maxH / 842, maxW / 595, 2.2);
}

// ── Navigation ─────────────────────────────
const maxSpread = () => isDouble && totalPages > 1
    ? Math.ceil(totalPages / 2) - 1
    : totalPages - 1;

async function goNext()  { if (spread < maxSpread()) { spread++; flip('r'); await renderSpread(); } }
async function goPrev()  { if (spread > 0)           { spread--; flip('l'); await renderSpread(); } }
async function goFirst() { spread = 0;             await renderSpread(); }
async function goLast()  { spread = maxSpread();   await renderSpread(); }
async function goTo(i)   {
    spread = isDouble && totalPages > 1 ? Math.floor(i / 2) : i;
    await renderSpread();
}

function flip(dir) {
    V.container.style.cssText = 'transition:none;opacity:0.2;transform:translateX(' + (dir === 'r' ? 50 : -50) + 'px)';
    requestAnimationFrame(() => {
        V.container.style.cssText = 'transition:all .35s ease;opacity:1;transform:translateX(0)';
    });
}

// ── Zoom ───────────────────────────────────
function doZoom(d) {
    zoom = Math.min(3, Math.max(0.3, zoom + d));
    const w = V.container.querySelector('.simple-page-view');
    if (w) w.style.transform = `scale(${zoom})`;
    V.zoomLevel.textContent = Math.round(zoom * 100) + '%';
}

// ── Thumbnails ─────────────────────────────
function buildThumbs() {
    V.thumbList.innerHTML = '';
    for (let i = 0; i < totalPages; i++) {
        const item = document.createElement('div');
        item.className = 'thumbnail-item';
        item.dataset.page = i;
        item.innerHTML = `<div class="thumb-placeholder"><span>${i+1}</span></div>
                          <span class="thumbnail-number">${i+1}</span>`;
        item.addEventListener('click', () => goTo(i));
        V.thumbList.appendChild(item);
    }

    const io = new IntersectionObserver(async entries => {
        for (const e of entries) {
            if (e.isIntersecting && !e.target.dataset.loaded) {
                e.target.dataset.loaded = '1';
                io.unobserve(e.target);
                const pn = +e.target.dataset.page + 1;
                try {
                    const src = await getPageImg(pn);
                    e.target.innerHTML = `<img src="${src}">
                                          <span class="thumbnail-number">${pn}</span>`;
                } catch {}
            }
        }
    }, { root: V.thumbList, threshold: 0.1 });

    V.thumbList.querySelectorAll('.thumbnail-item').forEach(el => io.observe(el));
}

function highlightThumb() {
    V.thumbList.querySelectorAll('.thumbnail-item').forEach(item => {
        const pi = +item.dataset.page;
        const on = isDouble && totalPages > 1
            ? pi === spread * 2 || pi === spread * 2 + 1
            : pi === spread;
        item.classList.toggle('active', on);
    });
}

function updateIndicator() {
    if (isDouble && totalPages > 1) {
        const l = spread * 2 + 1, r = Math.min(spread * 2 + 2, totalPages);
        V.currentNum.textContent = l === r ? l : `${l}–${r}`;
    } else {
        V.currentNum.textContent = spread + 1;
    }
    V.totalNum.textContent = totalPages;
}

function preloadNeighbours() {
    const pages = isDouble
        ? [(spread+1)*2+1,(spread+1)*2+2,(spread-1)*2+1,(spread-1)*2+2]
        : [spread+2, spread];
    pages.forEach(p => { if (p >= 1 && p <= totalPages && !cache.has(p)) getPageImg(p).catch(()=>{}); });
}

// ── Error ──────────────────────────────────
function showErr(msg) {
    V.loading.style.display = 'none';
    V.error.style.display   = 'flex';
    if (V.errorMsg) V.errorMsg.textContent = msg;
}

// ── Storage ────────────────────────────────
function getLocalBook(id) {
    try {
        const books = JSON.parse(localStorage.getItem(APP_CONFIG?.STORAGE_KEY || 'flipbook_pro_books')) || [];
        return books.find(b => b.id === id) || null;
    } catch { return null; }
}

function saveLocalBook(book) {
    try {
        const key   = APP_CONFIG?.STORAGE_KEY || 'flipbook_pro_books';
        const books = JSON.parse(localStorage.getItem(key)) || [];
        if (!books.find(b => b.id === book.id)) { books.unshift(book); localStorage.setItem(key, JSON.stringify(books)); }
    } catch {}
}

// ── Events ─────────────────────────────────
function bindViewerEvents() {
    document.getElementById('prevPageBtn') .addEventListener('click', goPrev);
    document.getElementById('nextPageBtn') .addEventListener('click', goNext);
    document.getElementById('firstPageBtn').addEventListener('click', goFirst);
    document.getElementById('lastPageBtn') .addEventListener('click', goLast);
    document.getElementById('navLeft')     .addEventListener('click', goPrev);
    document.getElementById('navRight')    .addEventListener('click', goNext);
    document.getElementById('zoomInBtn')   .addEventListener('click', () => doZoom(+0.2));
    document.getElementById('zoomOutBtn')  .addEventListener('click', () => doZoom(-0.2));

    document.getElementById('thumbnailToggle').addEventListener('click', () =>
        V.thumbSidebar.classList.toggle('active'));
    document.getElementById('closeThumbnails').addEventListener('click', () =>
        V.thumbSidebar.classList.remove('active'));

    document.getElementById('fullscreenBtn').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            document.getElementById('fullscreenBtn').innerHTML = '<i class="fas fa-compress"></i>';
        } else {
            document.exitFullscreen();
            document.getElementById('fullscreenBtn').innerHTML = '<i class="fas fa-expand"></i>';
        }
    });

    document.getElementById('shareBtn').addEventListener('click', () =>
        V.shareModal.style.display = 'flex');
    document.getElementById('closeShareModal').addEventListener('click', () =>
        V.shareModal.style.display = 'none');
    V.shareModal.addEventListener('click', e => {
        if (e.target === V.shareModal) V.shareModal.style.display = 'none';
    });

    document.getElementById('viewerCopyLink').addEventListener('click', () => {
        navigator.clipboard.writeText(V.shareInput.value).then(() => {
            const b = document.getElementById('viewerCopyLink');
            b.innerHTML = '<i class="fas fa-check"></i> Copied!';
            setTimeout(() => b.innerHTML = '<i class="fas fa-copy"></i> Copy', 2000);
        });
    });

    document.getElementById('shareWhatsapp').addEventListener('click', e => {
        e.preventDefault();
        window.open(`https://wa.me/?text=${encodeURIComponent(bookMeta?.title+' '+location.href)}`);
    });
    document.getElementById('shareTwitter').addEventListener('click', e => {
        e.preventDefault();
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(bookMeta?.title)}&url=${encodeURIComponent(location.href)}`);
    });
    document.getElementById('shareFacebook').addEventListener('click', e => {
        e.preventDefault();
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.href)}`);
    });
    document.getElementById('shareEmail').addEventListener('click', e => {
        e.preventDefault();
        location.href = `mailto:?subject=${encodeURIComponent(bookMeta?.title)}&body=${encodeURIComponent(location.href)}`;
    });

    document.addEventListener('keydown', e => {
        if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
        ({
            ArrowRight: goNext, ArrowDown: goNext,
            ArrowLeft: goPrev, ArrowUp: goPrev,
            Home: goFirst, End: goLast,
            '+': () => doZoom(+0.2), '=': () => doZoom(+0.2),
            '-': () => doZoom(-0.2),
            f: () => document.getElementById('fullscreenBtn').click(),
            Escape: () => {
                V.shareModal.style.display = 'none';
                V.thumbSidebar.classList.remove('active');
            },
        })[e.key]?.();
    });

    document.getElementById('flipbookViewport').addEventListener('wheel', e => {
        e.preventDefault();
        e.ctrlKey ? doZoom(e.deltaY < 0 ? 0.15 : -0.15) : (e.deltaY > 0 ? goNext() : goPrev());
    }, { passive: false });

    let tx = 0;
    const vp = document.getElementById('flipbookViewport');
    vp.addEventListener('touchstart', e => tx = e.changedTouches[0].screenX, { passive: true });
    vp.addEventListener('touchend', e => {
        const d = tx - e.changedTouches[0].screenX;
        if (Math.abs(d) > 50) d > 0 ? goNext() : goPrev();
    }, { passive: true });
}