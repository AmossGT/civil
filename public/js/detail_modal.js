// Shared Tender Detail Inspection Modal Controller
import { $, api, escapeHtml, money, dateText, statusName, statusClass } from './api.js';
import { toast, openModal, closeModal } from './ui.js';

export async function openTender(ref) {
    const modal = $('modal');
    if (!modal) return;

    try {
        const t = await api('/tenders/' + encodeURIComponent(ref));
        $('dref').textContent = t.tender_ref;
        $('dbadge').innerHTML = `<span class="badge ${statusClass(t.status)}">${escapeHtml(statusName(t.status))}</span>`;
        $('dtitle').textContent = t.title;
        $('ddesc').textContent = t.description || 'No description has been published.';
        $('dgrid').innerHTML = `
            <div class="dfield"><small>Estimated value</small><b>${t.estimated_value == null ? 'Not provided' : money(t.estimated_value)}</b></div>
            <div class="dfield"><small>Awarded contract value</small><b>${t.award ? money(t.award.awarded_value) : 'Not awarded yet'}</b></div>
            <div class="dfield"><small>Bid opening</small><b>${dateText(t.bid_open_date)}</b></div>
            <div class="dfield"><small>Bid closing</small><b>${dateText(t.bid_close_date)}</b></div>
            ${t.award ? `<div class="dfield"><small>AOC date</small><b>${t.award.aoc_date ? dateText(t.award.aoc_date) : 'Not supplied'}</b></div>` : ''}
        `;

        const officers = t.department?.officers || [];
        $('ddept').innerHTML = `
            <b>${escapeHtml(t.department?.name || 'Department')}</b>
            <p class="detaildesc" style="margin:5px 0 0">${escapeHtml(t.department?.district || '')}</p>
            ${officers.map(o => `
                <div class="contact">
                    <span>${escapeHtml(o.name)} · ${escapeHtml(o.designation)}</span>
                    <b>${escapeHtml(o.office_phone || '')}</b>
                </div>
            `).join('')}
        `;

        const contractor = t.award?.contractor;
        const extra = t.extra_data || {};
        if (extra.contract_date) $('dgrid').insertAdjacentHTML('beforeend', `<div class="dfield"><small>Contract date</small><b>${dateText(extra.contract_date)}</b></div>`);
        if (extra.work_completion_days) $('dgrid').insertAdjacentHTML('beforeend', `<div class="dfield"><small>Completion period</small><b>${Number(extra.work_completion_days).toLocaleString('en-IN')} days</b></div>`);

        const emails = [...(extra.contractor_emails || []), ...(extra.contractor_email ? [extra.contractor_email] : [])];
        $('dcontract').innerHTML = contractor ? `
            <h4>${t.award.provisional ? 'Provisional award' : 'Awarded contractor'}</h4>
            <b>${escapeHtml(contractor.company_name)}</b>
            <p class="detaildesc" style="margin:5px 0 0">${t.award.provisional ? 'Working-note award · awaiting review' : (t.award.aoc_date ? dateText(t.award.aoc_date) : 'Award disclosed')}</p>
            ${emails.map(email => `<div class="contact"><span>Public corporate email</span><b>${escapeHtml(email)}</b></div>`).join('')}
            ${extra.contractor_phone ? `<div class="contact"><span>Public corporate phone</span><b>${escapeHtml(extra.contractor_phone)}</b></div>` : ''}
            ${(contractor.contacts || []).map(c => `<div class="contact"><span>${escapeHtml(c.name)} · ${escapeHtml(c.role)}</span><b>${escapeHtml(c.office_phone || '')}</b></div>`).join('')}
        ` : '<h4>Contractor</h4><p class="detaildesc" style="margin:0">Contractor details will appear when an award is reviewed.</p>';

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
            recordDocs.innerHTML = documents.length ? documents.map(d => `
                <a class="pdf" href="${escapeHtml(d.download_url)}" target="_blank" rel="noopener">
                    <span>▧ &nbsp; ${escapeHtml(d.label)}
                        <small style="display:block;color:#8c9790;font-weight:400;margin:4px 0 0 21px">${escapeHtml(d.filename)}</small>
                    </span>
                    <b>↓</b>
                </a>
            `).join('') : '<p class="detaildesc" style="margin:8px 0 0">No tender documents attached.</p>';
        }

        openModal('modal');
    } catch (e) {
        toast('Could not load tender: ' + e.message);
    }
}

export function initDetailModal() {
    const closeBtn = $('close');
    if (closeBtn) closeBtn.onclick = () => closeModal('modal');
    window.addEventListener('open-tender-detail', (e) => {
        if (e.detail && e.detail.ref) openTender(e.detail.ref);
    });
}
