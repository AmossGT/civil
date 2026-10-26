// Department Viewer Workspace (Scoped Department Drafts, Officers, Internal Metrics & Audit)
import { $, api, escapeHtml, money, dateText, timeText, statusName, statusClass } from './api.js';
import { toast, openModal, closeModal } from './ui.js';
import { authState } from './auth.js';

let viewerTendersPage = 1;

export async function openViewerWorkspace() {
    if (!authState.user || (authState.user.role !== 'department_viewer' && authState.user.role !== 'admin')) {
        toast('Access restricted to department viewers and administrators.');
        return;
    }
    openModal('viewerModal');
    loadViewerDashboard();
}

export async function loadViewerDashboard() {
    $('viewerDeptName').textContent = 'Loading department…';
    $('viewerOfficersList').innerHTML = '<div class="empty">Loading contacts…</div>';
    $('viewerTendersList').innerHTML = '<div class="empty">Loading department tenders…</div>';
    $('viewerAuditList').innerHTML = '<div class="empty">Loading department activity…</div>';

    try {
        const dept = await api('/viewer/department');
        renderViewerDepartment(dept);
        await Promise.all([
            loadViewerTenders(1),
            loadViewerAudit()
        ]);
    } catch (err) {
        toast('Failed to load viewer workspace: ' + err.message);
    }
}

function renderViewerDepartment(dept) {
    $('viewerDeptName').textContent = dept.name;
    $('viewerDeptDistrict').textContent = dept.district ? `District: ${dept.district}` : 'Statewide Jurisdiction';

    const stats = dept.stats || {};
    $('viewerStatTotal').textContent = stats.total_tenders || '0';
    $('viewerStatDrafts').textContent = stats.drafts || '0';
    $('viewerStatPublished').textContent = stats.published || '0';
    $('viewerStatAwarded').textContent = stats.awarded || '0';
    $('viewerStatValue').textContent = money(stats.total_estimated_value || 0);

    const officers = dept.officers || [];
    if (!officers.length) {
        $('viewerOfficersList').innerHTML = '<div class="empty">No departmental officers listed.</div>';
    } else {
        $('viewerOfficersList').innerHTML = officers.map(o => `
            <div class="officer-card">
                <div>
                    <strong>${escapeHtml(o.name)}</strong>
                    <span class="officer-desig">${escapeHtml(o.designation)}</span>
                </div>
                <b>${escapeHtml(o.office_phone || 'No phone')}</b>
            </div>
        `).join('');
    }
}

export async function loadViewerTenders(page = 1) {
    viewerTendersPage = page;
    const container = $('viewerTendersList');
    const filterStatus = $('viewerStatusFilter') ? $('viewerStatusFilter').value : '';

    const p = new URLSearchParams({ page: String(page), page_size: '10' });
    if (filterStatus) p.set('status', filterStatus);

    try {
        const data = await api('/viewer/tenders?' + p.toString());
        const { items, total, page, page_size } = data;

        if (!items || !items.length) {
            container.innerHTML = '<div class="empty">No tenders assigned to this department.</div>';
            return;
        }

        const rows = items.map(t => {
            const isDraft = t.status === 'draft';
            return `
                <div class="viewer-tender-card ${isDraft ? 'draft-highlight' : ''}" data-ref="${escapeHtml(t.tender_ref)}">
                    <div class="viewer-tender-header">
                        <div>
                            <span class="ref-code">${escapeHtml(t.tender_ref)}</span>
                            <h4>${escapeHtml(t.title)}</h4>
                        </div>
                        <span class="badge ${statusClass(t.status)}">${escapeHtml(statusName(t.status))}</span>
                    </div>
                    <div class="viewer-tender-meta">
                        <span><strong>Est. Value:</strong> ${t.estimated_value != null ? money(t.estimated_value) : '—'}</span>
                        <span><strong>Close Date:</strong> ${dateText(t.bid_close_date)}</span>
                        <span><strong>Documents:</strong> ${(t.documents || []).length} attached</span>
                    </div>
                    ${t.description ? `<p class="viewer-tender-desc">${escapeHtml(t.description)}</p>` : ''}
                    ${isDraft ? `<div class="draft-pill-notice">🔒 Internal Department Draft — Visible only to department staff</div>` : ''}
                </div>
            `;
        }).join('');

        const maxPages = Math.ceil(total / page_size) || 1;
        container.innerHTML = `
            <div class="viewer-tenders-grid">${rows}</div>
            <div class="admin-table-foot" style="margin-top:14px">
                <span>Showing ${items.length} of ${total} tenders (Page ${page} of ${maxPages})</span>
                <div class="pages">
                    <button id="viewerPrev" ${page <= 1 ? 'disabled' : ''}>‹</button>
                    <button id="viewerNext" ${page >= maxPages ? 'disabled' : ''}>›</button>
                </div>
            </div>
        `;

        const prev = $('viewerPrev');
        if (prev) prev.onclick = () => loadViewerTenders(page - 1);
        const next = $('viewerNext');
        if (next) next.onclick = () => loadViewerTenders(page + 1);

        container.querySelectorAll('.viewer-tender-card').forEach(card => {
            card.onclick = () => {
                window.dispatchEvent(new CustomEvent('open-tender-detail', {
                    detail: { ref: card.dataset.ref }
                }));
            };
        });
    } catch (err) {
        container.innerHTML = `<div class="empty error-box">${escapeHtml(err.message)}</div>`;
    }
}

export async function loadViewerAudit() {
    const container = $('viewerAuditList');
    try {
        const data = await api('/viewer/audit?page=1&page_size=15');
        const items = data.items || [];
        if (!items.length) {
            container.innerHTML = '<div class="empty">No recent changes recorded for this department.</div>';
            return;
        }

        container.innerHTML = items.map(x => `
            <div class="activityitem">
                <i class="activityicon">${x.action === 'create' ? '+' : x.action === 'update' ? '✎' : '▤'}</i>
                <div>
                    <p><b>Action: ${escapeHtml(x.action.toUpperCase())}</b> on Tender #${x.record_id}</p>
                    <small>${timeText(x.created_at)} · Actor User #${x.user_id || 'System'}</small>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div class="empty">Audit logs unavailable: ${escapeHtml(err.message)}</div>`;
    }
}

export function initViewer() {
    window.addEventListener('open-viewer-workspace', openViewerWorkspace);

    const viewerClose = $('viewerClose');
    if (viewerClose) viewerClose.onclick = () => closeModal('viewerModal');

    const statusFilter = $('viewerStatusFilter');
    if (statusFilter) {
        statusFilter.onchange = () => loadViewerTenders(1);
    }
}
