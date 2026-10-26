// Shared Tender Detail Inspection Modal Controller
import { $, api, escapeHtml, money, dateText, statusName, statusClass } from './api.js';
import { toast, openModal, closeModal } from './ui.js';

let returnFocusTo = null;
let previousBodyOverflow = '';

function closeTenderModal() {
    closeModal('modal');
    document.body.style.overflow = previousBodyOverflow;
    if (returnFocusTo?.isConnected) returnFocusTo.focus();
    returnFocusTo = null;
}

export async function openTender(ref, opener = document.activeElement) {
    const modal = $('modal');
    if (!modal) return;
    returnFocusTo = opener;

    try {
        const t = await api('/tenders/' + encodeURIComponent(ref));
        $('dref').textContent = t.tender_ref;
        $('dbadge').innerHTML = `<span class="badge ${statusClass(t.status)}">${escapeHtml(statusName(t.status))}</span>`;
        $('dtitle').textContent = t.title;
        $('ddesc').textContent = t.description || 'No description has been published.';
        const fields = [];
        const addField = (label, value) => {
            if (value !== undefined && value !== null && value !== '') fields.push(`<div class="dfield"><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></div>`);
        };
        addField('Estimated value', t.estimated_value == null ? null : money(t.estimated_value));
        addField('Awarded contract value', t.award?.awarded_value == null ? null : money(t.award.awarded_value));
        addField('Bid opening', t.bid_open_date ? dateText(t.bid_open_date) : null);
        addField('Bid closing', t.bid_close_date ? dateText(t.bid_close_date) : null);
        addField('AOC date', t.award?.aoc_date ? dateText(t.award.aoc_date) : null);
        $('dgrid').innerHTML = fields.length ? fields.join('') : '<p class="detaildesc">No value or timeline details are available.</p>';

        const officers = t.department?.officers || [];
        $('ddept').innerHTML = `
            ${t.department?.name ? `<b>${escapeHtml(t.department.name)}</b>` : '<b>Department not provided</b>'}
            ${t.department?.district ? `<p class="detaildesc" style="margin:5px 0 0">${escapeHtml(t.department.district)}</p>` : ''}
            ${officers.map(o => `
                <div class="contact">
                    <span>${escapeHtml(o.name)} · ${escapeHtml(o.designation)}</span>
                    <b>${escapeHtml(o.office_phone || '')}</b>
                </div>
            `).join('')}
        `;

        const contractor = t.award?.contractor;
        const extra = t.extra_data || {};
        if (extra.contract_date) addField('Contract date', dateText(extra.contract_date));
        if (extra.work_completion_days) addField('Completion period', `${Number(extra.work_completion_days).toLocaleString('en-IN')} days`);
        $('dgrid').innerHTML = fields.join('') || '<p class="detaildesc">No value or timeline details are available.</p>';
        if (extra.project_scope) $('ddesc').textContent = extra.project_scope;

        const grievanceContact = extra.grievance_contact || extra.project_office_contact;
        const grievancePanel = $('dgrievance');
        if (grievancePanel) {
            grievancePanel.innerHTML = grievanceContact
                ? `${grievanceContact.email ? `<div class="contact"><span>Email</span><b>${escapeHtml(grievanceContact.email)}</b></div>` : ''}${grievanceContact.phone ? `<div class="contact"><span>Phone</span><b>${escapeHtml(grievanceContact.phone)}</b></div>` : ''}`
                : '<p class="detaildesc" style="margin:0">No contact details supplied.</p>';
        }

        const emails = [...(extra.contractor_emails || []), ...(extra.contractor_email ? [extra.contractor_email] : [])];
        $('dcontract').innerHTML = contractor ? `
            <h4>Contractor Information</h4>
            <b>${escapeHtml(contractor.company_name)}</b>
            <p class="detaildesc" style="margin:5px 0 0">${t.award.provisional ? 'Working-note award · awaiting review' : (t.award.aoc_date ? dateText(t.award.aoc_date) : 'Award disclosed')}</p>
            ${emails.map(email => `<div class="contact"><span>Public corporate email</span><b>${escapeHtml(email)}</b></div>`).join('')}
            ${extra.contractor_phone ? `<div class="contact"><span>Public corporate phone</span><b>${escapeHtml(extra.contractor_phone)}</b></div>` : ''}
            ${(contractor.contacts || []).map(c => `<div class="contact"><span>${escapeHtml(c.name)} · ${escapeHtml(c.role)}</span><b>${escapeHtml(c.office_phone || '')}</b></div>`).join('')}
        ` : '<h4>Contractor</h4><p class="detaildesc" style="margin:0">Not disclosed in the available record.</p>';

        $('dloc').textContent = [
            t.location_label,
            extra.map_label ? `Map label: ${extra.map_label}` : null,
            extra.reference_document_label ? `Reference document: ${extra.reference_document_label}` : null,
            extra.map_coordinates_status === 'not_supplied' ? 'Map coordinates not supplied' : null
        ].filter(Boolean).join(' · ') || (t.location ? `${t.location.lat.toFixed(4)}, ${t.location.lng.toFixed(4)}` : 'Location not provided');

        const pdf = $('pdf');
        if (pdf) {
            if (t.work_order_url) {
                pdf.href = t.work_order_url;
                pdf.target = '_blank';
                pdf.style.display = 'flex';
            } else {
                pdf.removeAttribute('href');
                pdf.style.display = 'none';
            }
        }

        const documents = t.documents || [];
        const recordDocs = $('recordDocuments');
        if (recordDocs) {
            recordDocs.innerHTML = documents.length ? documents.map(d => {
                const isMapLayoutFile = /^loapackage[1-3]\.pdf$/i.test(String(d.filename || ''));
                const documentLabel = isMapLayoutFile ? 'Work order' : String(d.label || '').replace(/Award of Contract/gi, 'Work Order');
                const documentDisplay = isMapLayoutFile
                    ? `• Work order: ${escapeHtml(d.filename)}`
                    : `▧ &nbsp; ${escapeHtml(documentLabel)}<small style="display:block;color:#8c9790;font-weight:400;margin:4px 0 0 21px">${escapeHtml(d.filename)}</small>`;
                const isKmz = /\.kmz(?:$|[?#])/i.test(String(d.filename || '')) ||
                    /\.kmz(?:$|[?#])/i.test(String(d.download_url || '')) ||
                    /application\/vnd\.google-earth\.kmz/i.test(String(d.content_type || ''));
                return `
                    <div class="document-entry">
                        <a class="pdf" href="${escapeHtml(d.download_url)}" target="_blank" rel="noopener">
                            <span>${documentDisplay}</span>
                            <b>↓</b>
                        </a>
                        ${isKmz ? '<div class="kmz-hint"><span class="kmz-hint-icon" aria-hidden="true">ⓘ</span><span>Hint: To view this file, install Google Earth for mobile and Google Earth Pro for laptop.</span></div>' : ''}
                        ${d.hint ? `<div class="kmz-hint"><span class="kmz-hint-icon" aria-hidden="true">ⓘ</span><span>Hint: ${escapeHtml(d.hint)}</span></div>` : ''}
                        ${isMapLayoutFile ? '<div style="display:grid;gap:3px;margin:5px 0 0 21px;color:#71839a"><strong style="font-size:11px;font-weight:600">• Map layout: Pdf</strong><small style="margin-left:14px;font-size:10px;font-style:italic;line-height:1.45">ⓘ Hint: The map layout is in the 6th page in the pdf provided above.</small></div>' : ''}
                    </div>
                `;
            }).join('') : '<p class="detaildesc" style="margin:8px 0 0">No tender documents attached.</p>';
        }

        openModal('modal');
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        $('close').focus();
    } catch (e) {
        toast('Could not load tender: ' + e.message);
    }
}

export function initDetailModal() {
    const closeBtn = $('close');
    const modal = $('modal');
    if (closeBtn) closeBtn.onclick = closeTenderModal;
    if (modal) {
        modal.addEventListener('click', event => {
            if (event.target === modal) closeTenderModal();
        });
        document.addEventListener('keydown', event => {
            if (!modal.classList.contains('open')) return;
            if (event.key === 'Escape') {
                closeTenderModal();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...modal.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
                .filter(el => el.getClientRects().length);
            if (!focusable.length) { event.preventDefault(); modal.querySelector('.detail').focus(); return; }
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }, true);
    }
    window.addEventListener('open-tender-detail', (e) => {
        if (e.detail && e.detail.ref) openTender(e.detail.ref);
    });
}
