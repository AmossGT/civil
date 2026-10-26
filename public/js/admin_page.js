// Dedicated Admin Page Controller for http://localhost:8000/admin/v1/
import { $, escapeHtml } from './api.js';
import { toast, initConfirmDialog, initGlobalModalListeners } from './ui.js';
import { authState, checkAuth, logout, initAuth } from './auth.js';
import { initAdmin, switchAdminTab, preloadDropdowns } from './admin.js';

document.addEventListener('DOMContentLoaded', async () => {
    initGlobalModalListeners();
    initConfirmDialog();
    initAuth();
    initAdmin();

    const user = await checkAuth();
    if (!user) {
        toast('Authentication required. Redirecting to sign in...');
        setTimeout(() => { window.location.href = '/'; }, 1000);
        return;
    }

    if (user.role !== 'admin') {
        alert('Access denied: You need administrator privileges to access this console.');
        window.location.href = user.role === 'department_viewer' ? '/department/v1/' : '/';
        return;
    }

    // Render admin user info in header
    $('adminUserEmail').textContent = user.email;
    const logoutBtn = $('adminLogoutBtn');
    if (logoutBtn) logoutBtn.onclick = logout;

    // Preload dropdowns and initialize first tab
    await preloadDropdowns();
    switchAdminTab('tenders');
});
