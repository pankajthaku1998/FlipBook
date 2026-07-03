/*=============================================
  FLIPBOOK PRO - Dashboard JS
  Handles: Listing, searching, deleting flipbooks
=============================================*/

const STORAGE_KEY = 'flipbook_pro_books';

// ============ DOM ELEMENTS ============
const dashEl = {
    booksGrid: document.getElementById('booksGrid'),
    emptyState: document.getElementById('emptyState'),
    searchBooks: document.getElementById('searchBooks'),
    gridViewBtn: document.getElementById('gridViewBtn'),
    listViewBtn: document.getElementById('listViewBtn'),
    statTotal: document.getElementById('statTotal'),
    statPages: document.getElementById('statPages'),
    statRecent: document.getElementById('statRecent'),
    deleteModal: document.getElementById('deleteModal'),
    deleteBookTitle: document.getElementById('deleteBookTitle'),
    confirmDelete: document.getElementById('confirmDelete'),
    cancelDelete: document.getElementById('cancelDelete'),
    closeDeleteModal: document.getElementById('closeDeleteModal'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toastMessage'),
    mobileToggle: document.getElementById('mobileToggle')
};

let deleteTargetId = null;

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', () => {
    loadBooks();
    initDashboardEvents();
});

function initDashboardEvents() {
    // Search
    dashEl.searchBooks.addEventListener('input', (e) => {
        loadBooks(e.target.value);
    });

    // View toggle
    dashEl.gridViewBtn.addEventListener('click', () => {
        dashEl.gridViewBtn.classList.add('active');
        dashEl.listViewBtn.classList.remove('active');
        dashEl.booksGrid.classList.remove('list-view');
    });

    dashEl.listViewBtn.addEventListener('click', () => {
        dashEl.listViewBtn.classList.add('active');
        dashEl.gridViewBtn.classList.remove('active');
        dashEl.booksGrid.classList.add('list-view');
    });

    // Delete modal
    dashEl.closeDeleteModal.addEventListener('click', hideDeleteModal);
    dashEl.cancelDelete.addEventListener('click', hideDeleteModal);
    dashEl.deleteModal.addEventListener('click', (e) => {
        if (e.target === dashEl.deleteModal) hideDeleteModal();
    });
    dashEl.confirmDelete.addEventListener('click', () => {
        if (deleteTargetId) {
            deleteBook(deleteTargetId);
            hideDeleteModal();
            loadBooks();
            showToast('FlipBook deleted successfully');
        }
    });

    // Mobile menu
    if (dashEl.mobileToggle) {
        dashEl.mobileToggle.addEventListener('click', () => {
            const menu = document.getElementById('mobileMenu');
            if (menu) menu.classList.toggle('active');
        });
    }
}

// ============ LOAD & RENDER BOOKS ============
function loadBooks(searchQuery = '') {
    let books = getBooks();

    // Search filter
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        books = books.filter(b => 
            b.title.toLowerCase().includes(query) || 
            (b.description && b.description.toLowerCase().includes(query)) ||
            b.fileName.toLowerCase().includes(query)
        );
    }

    // Update stats
    updateDashboardStats(getBooks()); // Always show total stats

    // Render
    if (books.length === 0) {
        dashEl.booksGrid.style.display = 'none';
        dashEl.emptyState.style.display = 'block';
        
        if (searchQuery) {
            dashEl.emptyState.querySelector('h3').textContent = 'No Results Found';
            dashEl.emptyState.querySelector('p').textContent = `No flipbooks match "${searchQuery}"`;
        } else {
            dashEl.emptyState.querySelector('h3').textContent = 'No FlipBooks Yet';
            dashEl.emptyState.querySelector('p').textContent = 'Create your first flipbook by uploading a PDF';
        }
    } else {
        dashEl.booksGrid.style.display = 'grid';
        dashEl.emptyState.style.display = 'none';
        renderBooks(books);
    }
}

function renderBooks(books) {
    dashEl.booksGrid.innerHTML = '';

    books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';
        
        const dateStr = formatDate(book.createdAt);
        const coverGradients = [
            'linear-gradient(135deg, #667eea, #764ba2)',
            'linear-gradient(135deg, #f093fb, #f5576c)',
            'linear-gradient(135deg, #4facfe, #00f2fe)',
            'linear-gradient(135deg, #43e97b, #38f9d7)',
            'linear-gradient(135deg, #fa709a, #fee140)',
            'linear-gradient(135deg, #a18cd1, #fbc2eb)',
            'linear-gradient(135deg, #fccb90, #d57eeb)',
            'linear-gradient(135deg, #e0c3fc, #8ec5fc)',
        ];
        const gradient = coverGradients[Math.abs(hashCode(book.id)) % coverGradients.length];

        card.innerHTML = `
            <div class="book-cover" style="background: ${gradient}">
                ${book.thumbnail 
                    ? `<img src="${book.thumbnail}" alt="${book.title}">` 
                    : `<div class="book-cover-placeholder">
                        <i class="fas fa-book-open"></i>
                        <span>${book.totalPages} pages</span>
                       </div>`
                }
                <span class="page-count-badge">
                    <i class="fas fa-file"></i> ${book.totalPages} pages
                </span>
            </div>
            <div class="book-info">
                <h3 title="${book.title}">${book.title}</h3>
                <p class="book-desc">${book.description || 'No description'}</p>
                <div class="book-meta">
                    <span><i class="fas fa-calendar-alt"></i> ${dateStr}</span>
                    <span><i class="fas fa-file-pdf"></i> ${book.fileName}</span>
                </div>
                <div class="book-actions">
                    <a href="viewer.html?id=${book.id}" class="btn btn-primary btn-sm">
                        <i class="fas fa-eye"></i> View
                    </a>
                    <button class="btn btn-ghost btn-sm copy-btn" data-url="${book.shareUrl}">
                        <i class="fas fa-link"></i> Copy Link
                    </button>
                    <button class="btn btn-ghost btn-sm delete-btn" data-id="${book.id}" data-title="${book.title}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;

        dashEl.booksGrid.appendChild(card);
    });

    // Attach events
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const url = btn.dataset.url;
            navigator.clipboard.writeText(url).then(() => {
                showToast('Link copied to clipboard!');
                btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                setTimeout(() => {
                    btn.innerHTML = '<i class="fas fa-link"></i> Copy Link';
                }, 2000);
            });
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteTargetId = btn.dataset.id;
            dashEl.deleteBookTitle.textContent = btn.dataset.title;
            dashEl.deleteModal.style.display = 'flex';
        });
    });
}

// ============ STATS ============
function updateDashboardStats(books) {
    dashEl.statTotal.textContent = books.length;
    
    const totalPages = books.reduce((sum, b) => sum + (b.totalPages || 0), 0);
    dashEl.statPages.textContent = totalPages;

    if (books.length > 0) {
        dashEl.statRecent.textContent = formatDate(books[0].createdAt);
    } else {
        dashEl.statRecent.textContent = '-';
    }
}

// ============ STORAGE ============
function getBooks() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function deleteBook(id) {
    let books = getBooks();
    books = books.filter(b => b.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

// ============ UTILITIES ============
function formatDate(dateStr) {
    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    } catch (e) {
        return 'Unknown';
    }
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash;
}

function hideDeleteModal() {
    dashEl.deleteModal.style.display = 'none';
    deleteTargetId = null;
}

function showToast(message) {
    dashEl.toastMessage.textContent = message;
    dashEl.toast.classList.add('show');
    setTimeout(() => dashEl.toast.classList.remove('show'), 3000);
}