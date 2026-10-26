// Dedicated Department Viewer Page Controller for http://localhost:8000/department/v1/
import { $, escapeHtml } from './api.js';
import { toast, initConfirmDialog, initGlobalModalListeners } from './ui.js';
import { authState, checkAuth, logout, initAuth } from './auth.js';
import { initViewer, loadViewerDashboard } from './viewer.js';
import { initDetailModal } from './detail_modal.js';

document.addEventListener('DOMContentLoaded', async () => {
    initGlobalModalListeners();
    initConfirmDialog();
    initAuth();
    initViewer();
    initDetailModal();

    const user = await checkAuth();
    if (!user) {
        toast('Authentication required. Redirecting to sign in...');
        setTimeout(() => { window.location.href = '/'; }, 1000);
        return;
    }

    if (user.role !== 'department_viewer' && user.role !== 'admin') {
        alert('Access denied: You must be assigned as a department viewer to access this workspace.');
        window.location.href = '/';
        return;
    }

    // Render viewer user info in header
    $('viewerUserEmail').textContent = user.email;
    const badgeEl = $('viewerUserBadge');
    if (badgeEl) {
        badgeEl.textContent = user.role === 'admin' ? 'Admin Viewing Dept' : `Viewer · Dept #${user.department_id || ''}`;
    }
    const logoutBtn = $('viewerLogoutBtn');
    if (logoutBtn) logoutBtn.onclick = logout;

    // Load Department Data
    await loadViewerDashboard();
});
