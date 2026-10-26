// Authentication, Dynamic Header, and Session Lifecycle Management across Endpoints
import { $, api, escapeHtml, withLoading } from './api.js';
import { toast, openModal, closeModal, clearFormErrors, renderFormErrors } from './ui.js';

export const authState = {
    user: null,
    isInitialized: false
};

let onAuthChangedCallbacks = [];

export function onAuthChanged(cb) {
    onAuthChangedCallbacks.push(cb);
}

function notifyAuthChanged() {
    onAuthChangedCallbacks.forEach(cb => cb(authState.user));
}

export function renderHeader() {
    const container = $('authContainer');
    if (!container) return;

    if (authState.user) {
        const u = authState.user;
        const isAdmin = u.role === 'admin';
        const roleBadge = isAdmin
            ? `<span class="badge badge-admin">Admin</span>`
            : `<span class="badge badge-viewer">Viewer · Dept #${u.department_id || ''}</span>`;
        
        const actionBtn = isAdmin
            ? `<a href="/admin/v1/" class="login admin-btn" id="consoleBtn" style="text-decoration:none">Admin Console ↗</a>`
            : `<a href="/department/v1/" class="login viewer-btn" id="viewerBtn" style="text-decoration:none">Viewer Workspace ↗</a>`;

        container.innerHTML = `
            <div class="user-meta">
                ${roleBadge}
                <span class="user-email" title="${escapeHtml(u.email)}">${escapeHtml(u.email)}</span>
            </div>
            ${actionBtn}
            <button class="iconbtn logout-btn" id="logoutBtn" title="Sign out">Log out ✕</button>
        `;

        const logoutBtn = $('logoutBtn');
        if (logoutBtn) {
            logoutBtn.onclick = logout;
        }
    } else {
        container.innerHTML = `
            <span class="live"><i class="dot"></i> Live public data</span>
            <button class="login" id="loginBtn">Staff Sign In ↗</button>
        `;
        const loginBtn = $('loginBtn');
        if (loginBtn) {
            loginBtn.onclick = showLoginModal;
        }
    }
}

export function showLoginModal() {
    const form = $('loginForm');
    if (form) {
        clearFormErrors(form);
        form.reset();
    }
    openModal('loginModal');
}

export async function login(email, password, submitBtn) {
    const form = $('loginForm');
    clearFormErrors(form);

    return withLoading(submitBtn, async () => {
        try {
            const res = await api('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            sessionStorage.setItem('opentender_jwt', res.access_token);
            if (res.refresh_token) {
                sessionStorage.setItem('opentender_refresh_token', res.refresh_token);
            }
            authState.user = res.user;
            closeModal('loginModal');
            renderHeader();
            notifyAuthChanged();
            toast(`Signed in as ${res.user.role === 'admin' ? 'Administrator' : 'Department Viewer'}.`);

            // Automatically navigate to the dedicated role endpoint
            if (res.user.role === 'admin') {
                if (!window.location.pathname.startsWith('/admin/v1')) {
                    window.location.href = '/admin/v1/';
                }
            } else if (res.user.role === 'department_viewer') {
                if (!window.location.pathname.startsWith('/department/v1')) {
                    window.location.href = '/department/v1/';
                }
            }
        } catch (err) {
            if (err.data && err.data.detail) {
                renderFormErrors(form, err.data.detail);
            } else {
                const errorP = $('loginError');
                if (errorP) errorP.textContent = err.message;
            }
        }
    });
}

export async function logout() {
    try {
        await api('/auth/logout', { method: 'POST' });
    } catch {
        // Continue logout locally even if network fails
    } finally {
        sessionStorage.removeItem('opentender_jwt');
        sessionStorage.removeItem('opentender_refresh_token');
        authState.user = null;
        renderHeader();
        notifyAuthChanged();
        toast('You have been signed out.');

        // If currently on an authenticated role page, redirect back to public home
        if (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/department')) {
            window.location.href = '/';
        }
    }
}

export async function checkAuth() {
    const token = sessionStorage.getItem('opentender_jwt');
    if (!token) {
        authState.user = null;
        authState.isInitialized = true;
        renderHeader();
        return null;
    }

    try {
        const u = await api('/auth/me');
        authState.user = u;
    } catch {
        sessionStorage.removeItem('opentender_jwt');
        sessionStorage.removeItem('opentender_refresh_token');
        authState.user = null;
    } finally {
        authState.isInitialized = true;
        renderHeader();
        notifyAuthChanged();
    }
    return authState.user;
}

export function initAuth() {
    window.addEventListener('session-expired', () => {
        authState.user = null;
        renderHeader();
        notifyAuthChanged();
        toast('Session expired. Please sign in again.');
        if (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/department')) {
            window.location.href = '/';
        } else {
            showLoginModal();
        }
    });

    const loginForm = $('loginForm');
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const email = $('loginEmail').value.trim();
            const password = $('loginPassword').value;
            const submitBtn = loginForm.querySelector('button[type="submit"]');
            await login(email, password, submitBtn);
        };
    }

    const loginClose = $('loginClose');
    if (loginClose) {
        loginClose.onclick = () => closeModal('loginModal');
    }
}
