// Citizen Portal Controller & Public Dashboard Entry Point
import { $, api, escapeHtml, money, dateText, timeText, statusName, statusClass } from './api.js';
import { toast, initConfirmDialog, initGlobalModalListeners } from './ui.js';
import { authState, checkAuth, initAuth } from './auth.js';
import { openTender, initDetailModal } from './detail_modal.js?v=tender-identifiers-20261027';

const state = {
    items: [],
    total: 0,
    page: 1,
    pageSize: 5,
    departments: [],
    nearby: false,
    map: null,
    selectedMarker: null,
    mapLocation: null,
    mapPage: 1
};

const mapBounds = { west: 93.85, south: 24.70, east: 94.02, north: 24.91 };
const packageColors = {
    '2024_ADBPW_2403_1': '#23684c',
    '2024_ADBPW_2403_2': '#df8b46',
    '2024_ADBPW_2403_3': '#5275ad',
    '2024_ADBPW_2403_4': '#8862aa'
};

function showPage() {
    const requested = window.location.hash.slice(1);
    const page = ['overview', 'tenders', 'map', 'about'].includes(requested) ? requested : 'overview';
    document.querySelectorAll('.app-page').forEach(section => {
        section.hidden = section.id !== page;
    });
    document.querySelectorAll('.nav a').forEach(link => {
        const active = link.hash === `#${page}`;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    if (page === 'map' && state.map) window.setTimeout(() => state.map.invalidateSize(), 100);
    window.scrollTo(0, 0);
}

function queryParams(page = state.page) {
    const p = new URLSearchParams({ page: String(page), page_size: String(state.pageSize) });
    const q = $('search').value.trim();
    if (q) p.set('q', q);
    if ($('dept').value) p.set('department_id', $('dept').value);
    if ($('status').value) p.set('status', $('status').value);

    const sort = $('sort').value;
    if (sort === 'value') p.set('sort', '-estimated_value');
    if (sort === 'closing') p.set('sort', 'bid_close_date');
    return p;
}

export function renderList(items = state.items, total = state.total, allowPages = true, listId = 'list', emptyMessage = 'No public tenders match these filters.') {
    const list = $(listId);
    if (!items.length) {
        list.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
    } else {
        list.innerHTML = items.map(t => {
            const dept = t.department?.name || 'Department';
            const district = t.location_label || t.department?.district || 'Location not provided';
            return `
                <article class="tender" data-ref="${escapeHtml(t.tender_ref)}">
                    <div>
                        <span class="ref">${escapeHtml(t.tender_ref)} · ${escapeHtml(dept)}</span>
                        <h3 class="title">${escapeHtml(t.title)}</h3>
                        <div class="rowmeta">
                            <span>${escapeHtml(district)}</span>
                            <span>▤ ${t.award ? 'Award disclosed' : 'Tender notice'}</span>
                        </div>
                    </div>
                    <div class="tender-card-actions">
                        <span class="badge ${statusClass(t.status)}">${escapeHtml(statusName(t.status))}</span>
                        <div class="amount">
                            ${t.award?.awarded_value != null ? money(t.award.awarded_value) : t.estimated_value != null ? money(t.estimated_value) : 'Not provided'}
                            <small>${t.award?.awarded_value != null ? 'Awarded contract value' : 'Estimated value'}</small>
                        </div>
                        <button class="tender-info" type="button" aria-label="View details for ${escapeHtml(t.tender_ref)}" title="View tender details">ⓘ</button>
                    </div>
                </article>
            `;
        }).join('');

        list.querySelectorAll('.tender').forEach(row => {
            row.querySelector('.tender-info').addEventListener('click', event => {
                event.stopPropagation();
                openTender(row.dataset.ref, event.currentTarget);
            });
        });
    }

    if (listId !== 'list') return;
    $('count').textContent = `${total.toLocaleString('en-IN')} records`;
    $('pageSummary').textContent = allowPages
        ? `Showing ${items.length ? ((state.page - 1) * state.pageSize + 1) : 0}–${Math.min(state.page * state.pageSize, total)} of ${total.toLocaleString('en-IN')} records`
        : `${total.toLocaleString('en-IN')} nearby tenders`;

    const pages = $('pages');
    if (!allowPages) {
        pages.innerHTML = '';
        return;
    }
    const max = Math.max(1, Math.ceil(total / state.pageSize));
    const start = Math.max(1, Math.min(state.page - 2, max - 4));
    const end = Math.min(max, start + 4);
    const pageButtons = Array.from({ length: end - start + 1 }, (_, i) => start + i)
        .map(pageNumber => `<button class="page-number ${pageNumber === state.page ? 'active' : ''}" data-page="${pageNumber}" ${pageNumber === state.page ? 'aria-current="page"' : ''}>${pageNumber}</button>`)
        .join('');
    pages.innerHTML = `
        <button class="page-arrow" aria-label="Previous page" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>‹</button>
        ${pageButtons}
        <button class="page-arrow" aria-label="Next page" data-page="${state.page + 1}" ${state.page >= max ? 'disabled' : ''}>›</button>
    `;
    pages.querySelectorAll('button').forEach(b => {
        b.onclick = () => loadTenders(Number(b.dataset.page));
    });
}

export async function loadTenders(page = 1) {
    state.nearby = false;
    state.page = page;
    $('list').innerHTML = '<div class="empty">Loading public tender records…</div>';
    try {
        const data = await api('/tenders?' + queryParams(page));
        state.items = data.items;
        state.total = data.total;
        renderList();
    } catch (e) {
        $('list').innerHTML = `<div class="empty">${escapeHtml(e.message)}<br><button class="filterbtn" id="retry">Retry</button></div>`;
        const retry = $('retry');
        if (retry) retry.onclick = () => loadTenders(page);
    }
}

export async function loadDepartments() {
    try {
        state.departments = await api('/departments');
        $('dept').innerHTML = '<option value="">All departments</option>' +
            state.departments.map(d => `<option value="${d.id}">${escapeHtml(d.name.replace(/\s*-\s*ADB\s+Tenders\s*\/\s*Project\s+Implementation\s+Unit\s*$/i, ""))}</option>`).join('');
    } catch (e) {
        toast('Could not load department filters: ' + e.message);
    }
}

export async function loadStats() {
    try {
        const s = await api('/stats');
        $('statOpen').textContent = Number(s.published_tenders).toLocaleString('en-IN');
        $('statAwards').textContent = Number(s.awards_disclosed).toLocaleString('en-IN');
        $('statAwardValue').textContent = money(s.total_awarded_value);
        $('statDepartments').textContent = Number(s.departments).toLocaleString('en-IN');
        $('cardAwardValue').textContent = money(s.total_awarded_value);
        $('awardCount').textContent = `${Number(s.awards_disclosed).toLocaleString('en-IN')} awards`;
        const awardProgress = $('awardProgress');
        if (awardProgress) awardProgress.style.width = s.awards_disclosed ? '100%' : '0%';
    } catch (e) {
    }
}

export async function loadActivity(limit = 5) {
    try {
        const data = await api('/activity?limit=' + limit);
        $('activityList').innerHTML = data.items.length ? data.items.map(x => `
            <div class="activityitem">
                <i class="activityicon">${x.status === 'awarded' ? '₹' : '✓'}</i>
                <div>
                    <p><b>${escapeHtml(x.title)}</b><br>${escapeHtml(x.event)} · ${escapeHtml(x.department)}</p>
                    <small>${escapeHtml(timeText(x.created_at))}</small>
                </div>
            </div>
        `).join('') : '<div class="empty">No public changes have been recorded yet.</div>';
    } catch (e) {
        $('activityList').innerHTML = `<div class="empty">Activity unavailable: ${escapeHtml(e.message)}</div>`;
    }
}

function renderRoutes(box, features) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('route-layer');
    svg.setAttribute('viewBox', '0 0 1000 1000');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-label', 'Tender package routes');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;overflow:hidden';

    for (const feature of features) {
        const g = feature.geometry;
        const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        for (const line of lines) {
            const points = line.map(([lng, lat]) =>
                `${(lng - mapBounds.west) / (mapBounds.east - mapBounds.west) * 1000},${(mapBounds.north - lat) / (mapBounds.north - mapBounds.south) * 1000}`
            ).join(' ');
            if (!points) continue;
            const path = document.createElementNS(ns, 'polyline');
            path.setAttribute('points', points);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', packageColors[feature.properties.tender_ref] || '#4c765e');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            path.setAttribute('vector-effect', 'non-scaling-stroke');
            path.style.cursor = 'pointer';
            path.addEventListener('click', () => openTender(feature.properties.tender_ref));
            const title = document.createElementNS(ns, 'title');
            title.textContent = `${feature.properties.tender_title} · ${feature.properties.name}`;
            path.append(title);
            svg.append(path);
        }
    }
    box.append(svg);

    const legend = $('mapLegend');
    const packages = [...new Map(features.map(f => [f.properties.tender_ref, f.properties.tender_title])).entries()];
    legend.innerHTML = packages.map(([ref, title]) =>
        `<span title="${escapeHtml(title)}"><i style="background:${packageColors[ref] || '#4c765e'}"></i>P${escapeHtml(ref.slice(-1))}</span>`
    ).join('') || '<span>Routes unavailable</span>';
}

export async function loadMap() {
    if (!window.L || state.map) return;
    state.map = window.L.map('mapbox').setView([24.82, 93.94], 10);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);
    state.map.on('click', event => searchMapLocation(event.latlng.lat, event.latlng.lng));
    window.setTimeout(() => state.map?.invalidateSize(), 100);
    try {
        const b = mapBounds;
        const data = await api(`/tenders/map?bbox=${b.west},${b.south},${b.east},${b.north}`);
        if (data.features?.length) {
            window.L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
                style: feature => ({ color: packageColors[feature.properties.tender_ref] || '#1e5a9b', weight: 4 }),
                onEachFeature: (feature, layer) => layer.on('click', () => openTender(feature.properties.tender_ref))
            }).addTo(state.map);
        }
    } catch (e) { toast('Map route overlays are unavailable: ' + e.message); }
}

async function searchMapLocation(lat, lng, page = 1) {
    const title = $('mapResultsTitle');
    const note = $('mapEmptyNote');
    state.mapLocation = { lat, lng };
    state.mapPage = page;
    title.textContent = `Searching near ${lat.toFixed(5)}, ${lng.toFixed(5)}…`;
    note.hidden = true;
    $('mapPages').innerHTML = '';
    $('mapList').innerHTML = '<div class="empty">Finding registered checkpoints…</div>';
    if (state.selectedMarker) state.map.removeLayer(state.selectedMarker);
    state.selectedMarker = window.L.marker([lat, lng]).addTo(state.map).bindPopup('Selected search location').openPopup();
    try {
        const params = new URLSearchParams({ lat: String(lat), lng: String(lng), page: String(page), page_size: String(state.pageSize) });
        const data = await api('/tenders/geo-search?' + params);
        const first = data.total ? (page - 1) * state.pageSize + 1 : 0;
        title.textContent = `${first}–${Math.min(page * state.pageSize, data.total)} of ${data.total.toLocaleString('en-IN')} matching tenders`;
        $('mapPages').innerHTML = data.total > state.pageSize
            ? `<button class="page-arrow" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Previous</button><button class="page-arrow" data-page="${page + 1}" ${page * state.pageSize >= data.total ? 'disabled' : ''}>Next ›</button>`
            : '';
        $('mapPages').querySelectorAll('button').forEach(button => button.onclick = () => searchMapLocation(lat, lng, Number(button.dataset.page)));
        if (!data.total) {
            $('mapList').innerHTML = '';
            note.hidden = false;
        } else {
            renderList(data.items, data.total, false, 'mapList');
        }
    } catch (e) {
        title.textContent = 'Location search could not be completed';
        $('mapPages').innerHTML = '';
        $('mapList').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
    }
}

// Nearby search

export async function findNearby() {
    if (!navigator.geolocation) {
        toast('Location is not available in this browser.');
        return;
    }
    toast('Waiting for location permission…');
    navigator.geolocation.getCurrentPosition(async pos => {
        state.map?.setView([pos.coords.latitude, pos.coords.longitude], 13);
        searchMapLocation(pos.coords.latitude, pos.coords.longitude);
    }, err => toast(err.code === 1 ? 'Location permission was not granted.' : 'Could not determine your location.'), {
        timeout: 10000,
        maximumAge: 60000
    });
}

function initDashboardEvents() {
    let searchTimer;
    $('search').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadTenders(1), 250);
    });

    ['dept', 'status', 'sort'].forEach(id => {
        $(id).addEventListener('change', () => loadTenders(1));
    });

    $('clear').onclick = () => {
        $('search').value = '';
        ['dept', 'status'].forEach(id => $(id).value = '');
        $('sort').value = 'recent';
        loadTenders(1);
    };

    $('mapbtn').onclick = () => {
        loadMap();
    };

    $('nearbyBtn').onclick = findNearby;
    $('activityMore').onclick = () => loadActivity(20);

    window.addEventListener('refresh-public-dashboard', () => {
        loadTenders(state.page);
        loadStats();
        loadActivity();
        loadMap();
    });

    window.addEventListener('open-tender-detail', (e) => {
        if (e.detail && e.detail.ref) {
            openTender(e.detail.ref);
        }
    });
}

// Global bootstrap
document.addEventListener('DOMContentLoaded', async () => {
    showPage();
    window.addEventListener('hashchange', showPage);
    initGlobalModalListeners();
    initConfirmDialog();
    initAuth();
    initDetailModal();
    initDashboardEvents();

    await checkAuth();

    Promise.all([
        loadDepartments(),
        loadStats(),
        loadActivity(),
        loadMap(),
        loadTenders(1)
    ]);
});
