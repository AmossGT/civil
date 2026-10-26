// OpenTender API & Network Layer
export const API_BASE = '/api/v1';

export const $ = id => document.getElementById(id);

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export const money = value => {
    const amount = Number(value || 0);
    if (amount >= 10000000) return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount / 10000000) + ' crore';
    if (amount >= 100000) return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount / 100000) + ' lakh';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
};

export const dateText = value => value ? new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
}).format(new Date(value + 'T00:00:00')) : 'Not announced';

export const timeText = value => value ? new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value)) : 'Recently';

export const statusName = value => ({
    awarded: 'Awarded',
    published: 'Published',
    pending_review: 'Under review',
    draft: 'Draft',
    rejected: 'Changes requested',
    cancelled: 'Cancelled'
})[value] || value;

export const statusClass = value => {
    switch (value) {
        case 'awarded': return 'awarded';
        case 'published': return 'published';
        case 'pending_review': return 'review';
        case 'draft': return 'draft';
        default: return 'cancelled';
    }
};

let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
    refreshSubscribers.push(cb);
}

function onRefreshed(newToken) {
    refreshSubscribers.forEach(cb => cb(newToken));
    refreshSubscribers = [];
}

/**
 * Robust API client with silent JWT auto-refresh interceptor
 */
export async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    let token = sessionStorage.getItem('opentender_jwt');
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }

    let response;
    try {
        response = await fetch(API_BASE + path, { credentials: 'same-origin', ...options, headers });
    } catch (netErr) {
        throw new Error('Network connection error: ' + (netErr.message || 'Server unreachable'));
    }

    // 401 Unauthorized handling & Silent Token Refresh Interceptor
    if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
        const storedRefreshToken = sessionStorage.getItem('opentender_refresh_token');
        if (storedRefreshToken) {
            if (!isRefreshing) {
                isRefreshing = true;
                try {
                    const refreshRes = await fetch(API_BASE + '/auth/refresh', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refresh_token: storedRefreshToken })
                    });
                    if (refreshRes.ok) {
                        const refreshData = await refreshRes.json();
                        sessionStorage.setItem('opentender_jwt', refreshData.access_token);
                        if (refreshData.refresh_token) {
                            sessionStorage.setItem('opentender_refresh_token', refreshData.refresh_token);
                        }
                        isRefreshing = false;
                        onRefreshed(refreshData.access_token);
                        // Retry original request with new token
                        headers['Authorization'] = 'Bearer ' + refreshData.access_token;
                        return api(path, { ...options, headers });
                    } else {
                        // Refresh token failed/expired
                        isRefreshing = false;
                        sessionStorage.removeItem('opentender_jwt');
                        sessionStorage.removeItem('opentender_refresh_token');
                        window.dispatchEvent(new CustomEvent('session-expired'));
                        throw new Error('Your session has expired. Please sign in again.');
                    }
                } catch (e) {
                    isRefreshing = false;
                    sessionStorage.removeItem('opentender_jwt');
                    sessionStorage.removeItem('opentender_refresh_token');
                    window.dispatchEvent(new CustomEvent('session-expired'));
                    throw e;
                }
            } else {
                // Wait for existing refresh to finish
                return new Promise((resolve, reject) => {
                    subscribeTokenRefresh(async (newToken) => {
                        headers['Authorization'] = 'Bearer ' + newToken;
                        try {
                            const retryRes = await fetch(API_BASE + path, { credentials: 'same-origin', ...options, headers });
                            if (!retryRes.ok) throw new Error(`Retry failed (${retryRes.status})`);
                            resolve(retryRes.status === 204 ? null : await retryRes.json());
                        } catch (err) {
                            reject(err);
                        }
                    });
                });
            }
        } else {
            // No refresh token available
            sessionStorage.removeItem('opentender_jwt');
            window.dispatchEvent(new CustomEvent('session-expired'));
            throw new Error('Authentication required.');
        }
    }

    // 429 Rate Limited handling
    if (response.status === 429) {
        let detail = 'Too many requests. Please slow down and try again shortly.';
        try {
            const data = await response.json();
            if (data.detail) detail = data.detail;
        } catch {}
        throw new Error(detail);
    }

    if (!response.ok) {
        let errData = null;
        let detail = `Request failed (${response.status})`;
        try {
            errData = await response.json();
            detail = errData.detail || detail;
        } catch {}
        const error = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
        error.status = response.status;
        error.data = errData;
        throw error;
    }

    return response.status === 204 ? null : response.json();
}

/**
 * Button loading state wrapper to prevent duplicate clicks and provide instant visual feedback
 */
export async function withLoading(btnElement, asyncFn) {
    if (!btnElement) return asyncFn();
    const originalText = btnElement.innerHTML;
    btnElement.disabled = true;
    btnElement.classList.add('loading-state');
    btnElement.innerHTML = `<span class="spinner-sm"></span> Processing...`;
    try {
        return await asyncFn();
    } finally {
        btnElement.disabled = false;
        btnElement.classList.remove('loading-state');
        btnElement.innerHTML = originalText;
    }
}
