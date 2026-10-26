// Admin Management Console (Full privileged CRUD, Awards, CSV Import, Users, Audit)
import { $, api, escapeHtml, money, dateText, timeText, statusName, statusClass, withLoading } from './api.js';
import { toast, openModal, closeModal, showConfirmDialog, renderFormErrors, clearFormErrors } from './ui.js';
import { authState } from './auth.js';

let activeTab = 'tenders';
let adminTendersPage = 1;
let adminAuditPage = 1;

let departmentsCache = [];
let contractorsCache = [];

export async function preloadDropdowns() {
    try {
        const [depts, contractorsData] = await Promise.all([
            api('/departments'),
            api('/contractors?page=1&page_size=100')
        ]);
        departmentsCache = depts || [];
        contractorsCache = (contractorsData && contractorsData.items) ? contractorsData.items : [];
    } catch (err) {
        console.warn('Failed to pre-load dropdown dependencies:', err);
    }
}

export function openAdminConsole() {
    if (!authState.user || authState.user.role !== 'admin') {
        toast('Access restricted to administrators.');
        return;
    }
    preloadDropdowns().then(() => {
        openModal('adminModal');
        switchAdminTab(activeTab);
    });
}

export function switchAdminTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.admin-tab-pane').forEach(pane => {
        pane.style.display = pane.id === `adminPane-${tabName}` ? 'block' : 'none';
    });

    switch (tabName) {
        case 'tenders':
            loadAdminTenders(adminTendersPage);
            break;
        case 'review':
            loadReviewQueue();
            break;
        case 'import':
            resetImportTab();
            break;
        case 'users':
            loadAdminUsers();
            break;
        case 'audit':
            loadAdminAudit(adminAuditPage);
            break;
    }
}

// ==========================================
// 1. TENDERS TAB (Direct CRUD, Awards, Docs)
// ==========================================

export async function loadAdminTenders(page = 1) {
    adminTendersPage = page;
    const container = $('adminTendersList');
    if (!container) return;
    container.innerHTML = '<div class="empty">Loading admin tenders…</div>';

    const searchVal = $('adminTenderSearch') ? $('adminTenderSearch').value.trim() : '';
    const statusVal = $('adminTenderStatusFilter') ? $('adminTenderStatusFilter').value : '';

    const p = new URLSearchParams({ page: String(page), page_size: '15' });
    if (searchVal) p.set('q', searchVal);
    if (statusVal) p.set('status', statusVal);

    try {
        const data = await api('/admin/tenders?' + p.toString());
        renderAdminTendersTable(data);
    } catch (err) {
        container.innerHTML = `<div class="empty error-box">${escapeHtml(err.message)}</div>`;
    }
}

function renderAdminTendersTable(data) {
    const container = $('adminTendersList');
    const { items, total, page, page_size } = data;
    if (!items || !items.length) {
        container.innerHTML = '<div class="empty">No tenders found matching criteria.</div>';
        return;
    }

    const rowsHtml = items.map(t => {
        const est = t.estimated_value != null ? money(t.estimated_value) : '—';
        const awardVal = t.award ? money(t.award.awarded_value) : 'None';
        const deptName = t.department ? t.department.name : `Dept #${t.department_id || ''}`;

        return `
            <tr data-ref="${escapeHtml(t.tender_ref)}">
                <td>
                    <span class="ref-code">${escapeHtml(t.tender_ref)}</span>
                    <strong class="tender-table-title">${escapeHtml(t.title)}</strong>
                    <small class="table-submeta">${escapeHtml(deptName)}</small>
                </td>
                <td><span class="badge ${statusClass(t.status)}">${escapeHtml(statusName(t.status))}</span></td>
                <td>
                    <div>${est}</div>
                    <small class="table-submeta">Award: ${awardVal}</small>
                </td>
                <td>
                    <small>${dateText(t.bid_close_date)}</small>
                </td>
                <td class="action-cell">
                    <button class="tbl-btn btn-edit" data-action="edit" data-ref="${escapeHtml(t.tender_ref)}" title="Edit tender details">Edit</button>
                    <button class="tbl-btn btn-award" data-action="award" data-ref="${escapeHtml(t.tender_ref)}" title="Assign or verify contractor award">Award</button>
                    <button class="tbl-btn btn-doc" data-action="upload" data-ref="${escapeHtml(t.tender_ref)}" title="Upload document">Doc +</button>
                    <button class="tbl-btn btn-delete" data-action="delete" data-ref="${escapeHtml(t.tender_ref)}" data-title="${escapeHtml(t.title)}" title="Delete tender">✕</button>
                </td>
            </tr>
        `;
    }).join('');

    const maxPages = Math.ceil(total / page_size) || 1;
    container.innerHTML = `
        <table class="admintable">
            <thead>
                <tr>
                    <th>Tender Reference & Title</th>
                    <th>Status</th>
                    <th>Est. / Award Value</th>
                    <th>Bid Close</th>
                    <th style="text-align:right">Actions</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        <div class="admin-table-foot">
            <span>Showing ${items.length} of ${total} tenders (Page ${page} of ${maxPages})</span>
            <div class="pages">
                <button id="adminTenderPrev" ${page <= 1 ? 'disabled' : ''}>‹</button>
                <button id="adminTenderNext" ${page >= maxPages ? 'disabled' : ''}>›</button>
            </div>
        </div>
    `;

    const prev = $('adminTenderPrev');
    if (prev) prev.onclick = () => loadAdminTenders(page - 1);
    const next = $('adminTenderNext');
    if (next) next.onclick = () => loadAdminTenders(page + 1);

    // Bind action buttons
    container.querySelectorAll('button[data-action]').forEach(btn => {
        const action = btn.dataset.action;
        const ref = btn.dataset.ref;
        if (action === 'edit') btn.onclick = () => openEditTenderModal(ref);
        if (action === 'award') btn.onclick = () => openAwardModal(ref);
        if (action === 'upload') btn.onclick = () => openDocUploadModal(ref);
        if (action === 'delete') btn.onclick = () => confirmDeleteTender(ref, btn.dataset.title);
    });
}

// Add / Edit Tender Modal
export function openCreateTenderModal() {
    const modal = $('tenderFormModal');
    const form = $('tenderForm');
    clearFormErrors(form);
    form.reset();
    $('tenderFormMode').value = 'create';
    $('tenderFormTitle').textContent = 'Create New Tender';
    $('tenderRefInput').removeAttribute('readonly');

    populateDepartmentSelect('tenderDeptSelect');
    openModal(modal);
}

export async function openEditTenderModal(ref) {
    const modal = $('tenderFormModal');
    const form = $('tenderForm');
    clearFormErrors(form);
    form.reset();

    $('tenderFormMode').value = 'edit';
    $('tenderFormTitle').textContent = `Edit Tender: ${ref}`;
    $('tenderRefInput').value = ref;
    $('tenderRefInput').setAttribute('readonly', 'readonly');

    populateDepartmentSelect('tenderDeptSelect');

    try {
        const t = await api(`/tenders/${encodeURIComponent(ref)}`);
        $('tenderTitleInput').value = t.title || '';
        if (t.department && t.department.id) $('tenderDeptSelect').value = String(t.department.id);
        $('tenderValueInput').value = t.estimated_value != null ? t.estimated_value : '';
        $('tenderBidOpenInput').value = t.bid_open_date || '';
        $('tenderBidCloseInput').value = t.bid_close_date || '';
        $('tenderStatusSelect').value = t.status || 'draft';
        $('tenderLocLabelInput').value = t.location_label || '';
        if (t.location) {
            $('tenderLatInput').value = t.location.lat;
            $('tenderLngInput').value = t.location.lng;
        }
        $('tenderDescInput').value = t.description || '';
        openModal(modal);
    } catch (err) {
        toast('Failed to load tender details: ' + err.message);
    }
}

async function handleTenderFormSubmit(e) {
    e.preventDefault();
    const form = $('tenderForm');
    clearFormErrors(form);

    const mode = $('tenderFormMode').value;
    const ref = $('tenderRefInput').value.trim();
    const submitBtn = form.querySelector('button[type="submit"]');

    const payload = {
        title: $('tenderTitleInput').value.trim(),
        department_id: Number($('tenderDeptSelect').value),
        estimated_value: $('tenderValueInput').value ? parseFloat($('tenderValueInput').value) : null,
        bid_open_date: $('tenderBidOpenInput').value || null,
        bid_close_date: $('tenderBidCloseInput').value || null,
        status: $('tenderStatusSelect').value,
        location_label: $('tenderLocLabelInput').value.trim() || null,
        description: $('tenderDescInput').value.trim() || null
    };

    const latVal = $('tenderLatInput').value.trim();
    const lngVal = $('tenderLngInput').value.trim();
    if (latVal && lngVal) {
        payload.latitude = parseFloat(latVal);
        payload.longitude = parseFloat(lngVal);
    }

    if (mode === 'create') {
        payload.tender_ref = ref;
    }

    await withLoading(submitBtn, async () => {
        try {
            if (mode === 'create') {
                await api('/admin/tenders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                toast(`Tender ${ref} created successfully.`);
            } else {
                await api(`/admin/tenders/${encodeURIComponent(ref)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                toast(`Tender ${ref} updated successfully.`);
            }
            closeModal('tenderFormModal');
            loadAdminTenders(adminTendersPage);
            window.dispatchEvent(new CustomEvent('refresh-public-dashboard'));
        } catch (err) {
            if (err.data && err.data.detail) {
                renderFormErrors(form, err.data.detail);
            } else {
                toast(err.message);
            }
        }
    });
}

function confirmDeleteTender(ref, title) {
    showConfirmDialog({
        title: 'Delete Tender',
        message: `Are you sure you want to permanently delete Tender <strong>${escapeHtml(ref)}</strong> (${escapeHtml(title || '')})?<br><br>All associated documents and awards will also be removed. This action cannot be undone.`,
        confirmText: 'Permanently Delete',
        danger: true,
        onConfirm: async () => {
            try {
                await api(`/admin/tenders/${encodeURIComponent(ref)}`, { method: 'DELETE' });
                toast(`Tender ${ref} was deleted.`);
                loadAdminTenders(adminTendersPage);
                window.dispatchEvent(new CustomEvent('refresh-public-dashboard'));
            } catch (err) {
                toast('Delete failed: ' + err.message);
            }
        }
    });
}

// Award Modal
export async function openAwardModal(ref) {
    const modal = $('awardModal');
    const form = $('awardForm');
    clearFormErrors(form);
    form.reset();

    $('awardTenderRef').textContent = ref;
    $('awardTenderRefInput').value = ref;

    populateContractorSelect('awardContractorSelect');

    try {
        const t = await api(`/tenders/${encodeURIComponent(ref)}`);
        if (t.award) {
            $('awardContractorSelect').value = String(t.award.contractor?.id || '');
            $('awardValueInput').value = t.award.awarded_value;
            $('awardAocDateInput').value = t.award.aoc_date || '';
            $('awardStatusSelect').value = t.award.status || 'verified';
            $('awardDeleteBtn').style.display = 'inline-block';
        } else {
            $('awardDeleteBtn').style.display = 'none';
        }
        openModal(modal);
    } catch (err) {
        toast('Failed to load award info: ' + err.message);
    }
}

async function handleAwardSubmit(e) {
    e.preventDefault();
    const form = $('awardForm');
    clearFormErrors(form);

    const ref = $('awardTenderRefInput').value;
    const submitBtn = form.querySelector('button[type="submit"]');

    const payload = {
        contractor_id: Number($('awardContractorSelect').value),
        awarded_value: parseFloat($('awardValueInput').value),
        aoc_date: $('awardAocDateInput').value || null,
        status: $('awardStatusSelect').value
    };

    await withLoading(submitBtn, async () => {
        try {
            await api(`/admin/tenders/${encodeURIComponent(ref)}/award`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            toast(`Award for ${ref} updated.`);
            closeModal('awardModal');
            loadAdminTenders(adminTendersPage);
            window.dispatchEvent(new CustomEvent('refresh-public-dashboard'));
        } catch (err) {
            if (err.data && err.data.detail) {
                renderFormErrors(form, err.data.detail);
            } else {
                toast(err.message);
            }
        }
    });
}

function handleAwardDelete() {
    const ref = $('awardTenderRefInput').value;
    showConfirmDialog({
        title: 'Revoke Award',
        message: `Revoke and delete the contractor award for Tender <strong>${escapeHtml(ref)}</strong>? Tender status will revert to Published.`,
        confirmText: 'Revoke Award',
        danger: true,
        onConfirm: async () => {
            try {
                await api(`/admin/tenders/${encodeURIComponent(ref)}/award`, { method: 'DELETE' });
                toast(`Award for ${ref} removed.`);
                closeModal('awardModal');
                loadAdminTenders(adminTendersPage);
                window.dispatchEvent(new CustomEvent('refresh-public-dashboard'));
            } catch (err) {
                toast('Failed to revoke award: ' + err.message);
            }
        }
    });
}

// Document Upload Modal
export function openDocUploadModal(ref) {
    const modal = $('docUploadModal');
    const form = $('docUploadForm');
    clearFormErrors(form);
    form.reset();

    $('docUploadTenderRef').textContent = ref;
    $('docUploadTenderRefInput').value = ref;
    openModal(modal);
}

async function handleDocUploadSubmit(e) {
    e.preventDefault();
    const form = $('docUploadForm');
    clearFormErrors(form);

    const ref = $('docUploadTenderRefInput').value;
    const fileInput = $('docFileInput');
    if (!fileInput.files.length) {
        toast('Please select a file to upload.');
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('document_type', $('docTypeSelect').value);
    formData.append('label', $('docLabelInput').value.trim() || fileInput.files[0].name);

    await withLoading(submitBtn, async () => {
        try {
            await api(`/admin/tenders/${encodeURIComponent(ref)}/documents`, {
                method: 'POST',
                body: formData
            });
            toast('Document uploaded to Docker volume successfully.');
            closeModal('docUploadModal');
            window.dispatchEvent(new CustomEvent('refresh-public-dashboard'));
        } catch (err) {
            toast('Upload failed: ' + err.message);
        }
    });
}

// Helpers for Select elements
function populateDepartmentSelect(selectId) {
    const sel = $(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Department</option>' +
        departmentsCache.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
}

function populateContractorSelect(selectId) {
    const sel = $(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">Select Contractor</option>' +
        contractorsCache.map(c => `<option value="${c.id}">${escapeHtml(c.company_name)} (${escapeHtml(c.registration_no || 'No Reg')})</option>`).join('');
}

// ==========================================
// 2. REVIEW QUEUE TAB
// ==========================================

export async function loadReviewQueue() {
    const container = $('reviewQueueContent');
    if (!container) return;
    container.innerHTML = '<div class="empty">Loading pending reviews…</div>';

    try {
        const d = await api('/admin/review');
        const rows = [
            ...d.tenders.map(t => ({ ...t, kind: 'tender' })),
            ...d.awards.map(a => ({ ...a, kind: 'award' }))
        ];

        if (!rows.length) {
            container.innerHTML = '<div class="empty">No records waiting for verification. All clear!</div>';
            return;
        }

        container.innerHTML = rows.map(x => `
            <div class="staffrow">
                <div>
                    <b>${escapeHtml(x.tender_ref)} · ${escapeHtml(x.title)}</b>
                    <small>${x.kind === 'award' ? 'Award ' + money(x.awarded_value) : escapeHtml(x.department)}</small>
                </div>
                <div class="staffactions">
                    <button class="tbl-btn btn-verify" data-verify="${escapeHtml(x.tender_ref)}">Verify & Disclose</button>
                    <button class="tbl-btn btn-return" data-reject="${escapeHtml(x.tender_ref)}">Return with Note</button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('[data-verify]').forEach(b => {
            b.onclick = async () => {
                await withLoading(b, async () => {
                    try {
                        await api(`/admin/tenders/${encodeURIComponent(b.dataset.verify)}/verify`, { method: 'POST' });
                        toast(`Tender ${b.dataset.verify} verified and published.`);
                        loadReviewQueue();
                        window.dispatchEvent(new CustomEvent('refresh-public-dashboard'));
                    } catch (e) {
                        toast(e.message);
                    }
                });
            };
        });

        container.querySelectorAll('[data-reject]').forEach(b => {
            b.onclick = async () => {
                const comment = prompt('Enter reason for return/rejection:');
                if (!comment) return;
                try {
                    await api(`/admin/tenders/${encodeURIComponent(b.dataset.reject)}/reject`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ comment })
                    });
                    toast('Record returned.');
                    loadReviewQueue();
                } catch (e) {
                    toast(e.message);
                }
            };
        });
    } catch (err) {
        container.innerHTML = `<div class="empty error-box">${escapeHtml(err.message)}</div>`;
    }
}

// ==========================================
// 3. ATOMIC CSV IMPORT TAB
// ==========================================

export function resetImportTab() {
    const fileInput = $('csvFileInput');
    if (fileInput) fileInput.value = '';
    const resultBox = $('csvImportResults');
    if (resultBox) {
        resultBox.style.display = 'none';
        resultBox.innerHTML = '';
    }
}

export async function handleCsvImportSubmit(e) {
    e.preventDefault();
    const fileInput = $('csvFileInput');
    const resultBox = $('csvImportResults');
    const submitBtn = $('csvSubmitBtn');

    if (!fileInput.files.length) {
        toast('Please choose a .csv file to import.');
        return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);

    resultBox.style.display = 'none';
    resultBox.innerHTML = '';

    await withLoading(submitBtn, async () => {
        try {
            const res = await api('/admin/import/tenders', {
                method: 'POST',
                body: formData
            });

            resultBox.style.display = 'block';

            if (res.errors && res.errors.length > 0) {
                // Batch rejected atomically!
                const rowsHtml = res.errors.map(err => `
                    <tr>
                        <td style="font-weight:700">Line ${err.line}</td>
                        <td class="csv-err-msg">${escapeHtml(err.error)}</td>
                    </tr>
                `).join('');

                resultBox.innerHTML = `
                    <div class="alert-box alert-error">
                        <h4>❌ Atomic Import Rejected (${res.errors.length} validation errors)</h4>
                        <p>No rows were committed to the database. All rows must be valid for the batch to succeed.</p>
                        <div class="csv-table-wrap">
                            <table class="csv-error-table">
                                <thead><tr><th>Line</th><th>Validation Error</th></tr></thead>
                                <tbody>${rowsHtml}</tbody>
                            </table>
                        </div>
                    </div>
                `;
            } else {
                // Success
                resultBox.innerHTML = `
                    <div class="alert-box alert-success">
                        <h4>✅ Batch Import Successful</h4>
                        <p>Successfully created <strong>${res.created}</strong> tenders in a single atomic transaction.</p>
                    </div>
                `;
                toast(`Imported ${res.created} tenders.`);
                window.dispatchEvent(new CustomEvent('refresh-public-dashboard'));
            }
        } catch (err) {
            resultBox.style.display = 'block';
            resultBox.innerHTML = `
                <div class="alert-box alert-error">
                    <h4>❌ Import Failed</h4>
                    <p>${escapeHtml(err.message)}</p>
                </div>
            `;
        }
    });
}

// ==========================================
// 4. USER PROVISIONING TAB
// ==========================================

export async function loadAdminUsers() {
    const container = $('adminUsersList');
    if (!container) return;
    container.innerHTML = '<div class="empty">Loading system users…</div>';

    populateDepartmentSelect('newUserDeptSelect');

    try {
        const users = await api('/admin/users');
        renderUsersTable(users);
    } catch (err) {
        container.innerHTML = `<div class="empty error-box">${escapeHtml(err.message)}</div>`;
    }
}

function renderUsersTable(users) {
    const container = $('adminUsersList');
    if (!users || !users.length) {
        container.innerHTML = '<div class="empty">No users provisioned.</div>';
        return;
    }

    const rows = users.map(u => {
        const rolePill = u.role === 'admin'
            ? '<span class="badge badge-admin">Admin</span>'
            : `<span class="badge badge-viewer">Viewer · Dept #${u.department_id || ''}</span>`;
        const statusPill = u.is_active
            ? '<span class="status-active">Active</span>'
            : '<span class="status-inactive">Inactive</span>';

        return `
            <tr>
                <td><b>${escapeHtml(u.email)}</b></td>
                <td>${rolePill}</td>
                <td>${statusPill}</td>
                <td style="text-align:right">
                    <button class="tbl-btn ${u.is_active ? 'btn-deactivate' : 'btn-activate'}" data-userid="${u.id}" data-active="${u.is_active}">
                        ${u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="admintable">
            <thead>
                <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th style="text-align:right">Action</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    container.querySelectorAll('button[data-userid]').forEach(btn => {
        btn.onclick = () => toggleUserStatus(Number(btn.dataset.userid), btn.dataset.active === 'true');
    });
}

async function handleCreateUserSubmit(e) {
    e.preventDefault();
    const form = $('newUserForm');
    clearFormErrors(form);

    const email = $('newUserEmail').value.trim();
    const password = $('newUserPassword').value;
    const role = $('newUserRole').value;
    const deptId = $('newUserDeptSelect').value ? Number($('newUserDeptSelect').value) : null;
    const submitBtn = form.querySelector('button[type="submit"]');

    if (role === 'department_viewer' && !deptId) {
        toast('Department viewers must be assigned to a department.');
        return;
    }

    const payload = { email, password, role };
    if (deptId) payload.department_id = deptId;

    await withLoading(submitBtn, async () => {
        try {
            await api('/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            toast(`User ${email} provisioned.`);
            form.reset();
            loadAdminUsers();
        } catch (err) {
            if (err.data && err.data.detail) {
                renderFormErrors(form, err.data.detail);
            } else {
                toast(err.message);
            }
        }
    });
}

function toggleUserStatus(userId, currentActive) {
    const actionWord = currentActive ? 'deactivate' : 'activate';
    showConfirmDialog({
        title: `${currentActive ? 'Deactivate' : 'Activate'} User`,
        message: `Are you sure you want to ${actionWord} user #${userId}? ${currentActive ? 'They will immediately lose access to the portal.' : 'They will regain access.'}`,
        confirmText: currentActive ? 'Deactivate' : 'Activate',
        danger: currentActive,
        onConfirm: async () => {
            try {
                await api(`/admin/users/${userId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_active: !currentActive })
                });
                toast(`User status updated.`);
                loadAdminUsers();
            } catch (err) {
                toast('Failed to update user status: ' + err.message);
            }
        }
    });
}

// ==========================================
// 5. AUDIT LOGS TAB
// ==========================================

export async function loadAdminAudit(page = 1) {
    adminAuditPage = page;
    const container = $('adminAuditList');
    if (!container) return;
    container.innerHTML = '<div class="empty">Loading system audit records…</div>';

    try {
        const data = await api(`/admin/audit?page=${page}&page_size=25`);
        renderAuditTable(data);
    } catch (err) {
        container.innerHTML = `<div class="empty error-box">${escapeHtml(err.message)}</div>`;
    }
}

function renderAuditTable(data) {
    const container = $('adminAuditList');
    const { items, total, page, page_size } = data;
    if (!items || !items.length) {
        container.innerHTML = '<div class="empty">No audit records found.</div>';
        return;
    }

    const rows = items.map(log => `
        <tr>
            <td><small class="table-submeta">${timeText(log.created_at)}</small></td>
            <td><span class="badge badge-audit-${log.action}">${escapeHtml(log.action.toUpperCase())}</span></td>
            <td><code>${escapeHtml(log.table_name)} #${log.record_id}</code></td>
            <td>User #${log.user_id || 'System'}</td>
            <td style="text-align:right">
                <button class="tbl-btn" data-inspect="${log.id}">Inspect</button>
            </td>
        </tr>
    `).join('');

    const maxPages = Math.ceil(total / page_size) || 1;
    container.innerHTML = `
        <table class="admintable">
            <thead>
                <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Actor</th>
                    <th style="text-align:right">Payload</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="admin-table-foot">
            <span>Showing ${items.length} of ${total} entries (Page ${page} of ${maxPages})</span>
            <div class="pages">
                <button id="adminAuditPrev" ${page <= 1 ? 'disabled' : ''}>‹</button>
                <button id="adminAuditNext" ${page >= maxPages ? 'disabled' : ''}>›</button>
            </div>
        </div>
    `;

    const prev = $('adminAuditPrev');
    if (prev) prev.onclick = () => loadAdminAudit(page - 1);
    const next = $('adminAuditNext');
    if (next) next.onclick = () => loadAdminAudit(page + 1);

    container.querySelectorAll('button[data-inspect]').forEach(btn => {
        btn.onclick = () => {
            const item = items.find(x => x.id === Number(btn.dataset.inspect));
            if (item) showAuditPayloadModal(item);
        };
    });
}

function showAuditPayloadModal(item) {
    const modal = $('auditInspectModal');
    $('auditInspectHeader').textContent = `${item.action.toUpperCase()} on ${item.table_name} #${item.record_id}`;
    $('auditInspectOld').textContent = item.old_value ? JSON.stringify(item.old_value, null, 2) : '(None)';
    $('auditInspectNew').textContent = item.new_value ? JSON.stringify(item.new_value, null, 2) : '(None)';
    openModal(modal);
}

// Initialization of event handlers
export function initAdmin() {
    window.addEventListener('open-admin-console', openAdminConsole);

    const adminClose = $('adminClose');
    if (adminClose) adminClose.onclick = () => closeModal('adminModal');

    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.onclick = () => switchAdminTab(btn.dataset.tab);
    });

    const newTenderBtn = $('newTenderBtn');
    if (newTenderBtn) newTenderBtn.onclick = openCreateTenderModal;

    const tenderForm = $('tenderForm');
    if (tenderForm) tenderForm.onsubmit = handleTenderFormSubmit;
    const tenderFormClose = $('tenderFormClose');
    if (tenderFormClose) tenderFormClose.onclick = () => closeModal('tenderFormModal');

    const awardForm = $('awardForm');
    if (awardForm) awardForm.onsubmit = handleAwardSubmit;
    const awardClose = $('awardClose');
    if (awardClose) awardClose.onclick = () => closeModal('awardModal');
    const awardDeleteBtn = $('awardDeleteBtn');
    if (awardDeleteBtn) awardDeleteBtn.onclick = handleAwardDelete;

    const docUploadForm = $('docUploadForm');
    if (docUploadForm) docUploadForm.onsubmit = handleDocUploadSubmit;
    const docUploadClose = $('docUploadClose');
    if (docUploadClose) docUploadClose.onclick = () => closeModal('docUploadModal');

    const csvForm = $('csvImportForm');
    if (csvForm) csvForm.onsubmit = handleCsvImportSubmit;

    const newUserForm = $('newUserForm');
    if (newUserForm) newUserForm.onsubmit = handleCreateUserSubmit;
    const newUserRole = $('newUserRole');
    if (newUserRole) {
        newUserRole.onchange = () => {
            const isViewer = newUserRole.value === 'department_viewer';
            const deptGroup = $('newUserDeptGroup');
            if (deptGroup) deptGroup.style.display = isViewer ? 'grid' : 'none';
        };
    }

    const auditInspectClose = $('auditInspectClose');
    if (auditInspectClose) auditInspectClose.onclick = () => closeModal('auditInspectModal');

    const adminTenderSearch = $('adminTenderSearch');
    if (adminTenderSearch) {
        let t;
        adminTenderSearch.oninput = () => {
            clearTimeout(t);
            t = setTimeout(() => loadAdminTenders(1), 250);
        };
    }
    const adminTenderStatusFilter = $('adminTenderStatusFilter');
    if (adminTenderStatusFilter) {
        adminTenderStatusFilter.onchange = () => loadAdminTenders(1);
    }
}
