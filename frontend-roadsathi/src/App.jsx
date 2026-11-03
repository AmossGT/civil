import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, formatCurrency, formatDate, formatStatus, statusClass } from './api.js'
import { sortTenderRecords } from './tenderSorting.js'
import './road.css'

const pages = ['Overview', 'Tenders', 'Map View', 'About']
const pageIds = { Overview: 'overview', Tenders: 'tenders', 'Map View': 'map', About: 'about', 'Staff Sign In': 'staff-sign-in' }

function Icon({ name, size = 18 }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    external: <><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 17v3h14v-3"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.file}</svg>
}

function Header({ page, navigate }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return <header className="site-header"><div className="header-inner">
    <a href="#overview" className="brand" onClick={e => { e.preventDefault(); navigate('Overview') }} aria-label="RoadSathi home"><span className="brand-mark" aria-hidden="true"><span /></span><span className="brand-name">Road<span>Sathi</span><small>MANIPUR · PUBLIC WORKS</small></span></a>
    <button className="menu-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? 'close' : 'menu'} /></button>
    <nav className={`main-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">{pages.map(item => <a key={item} href={`#${pageIds[item]}`} className={page === item ? 'active' : ''} aria-current={page === item ? 'page' : undefined} onClick={e => { e.preventDefault(); navigate(item); setMenuOpen(false) }}>{item}</a>)}</nav>
    <a className="staff-link" href="#staff-sign-in" onClick={event => { event.preventDefault(); navigate(page === 'Staff Sign In' ? 'Overview' : 'Staff Sign In') }}><span className="staff-dot" /> {page === 'Staff Sign In' ? 'Public Portal' : 'Staff Sign In'} <Icon name="external" size={14} /></a>
  </div></header>
}

function Eyebrow({ children }) { return <div className="eyebrow"><span />{children}</div> }
function Stat({ label, value, note }) { return <div className="stat-item"><div className="stat-value">{value}</div><div className="stat-label">{label}</div>{note && <div className="stat-note">{note}</div>}</div> }

function TenderRow({ tender, onDetails, onShowOnMap }) {
  const aoc = tender.award?.awarded_value
  const department = tender.department?.name?.replace(/\s*-\s*ADB Tenders\s*\/\s*Project Implementation Unit/i, '') || 'Department not listed'
  const identifier = tender.identifiers?.tender_id || tender.tender_ref
  const disbursed = tender.amount_disbursed ?? tender.extra_data?.amount_disbursed
  return <article className="tender-row"><div className="project-cell"><span className="project-dept">{department}</span><h3>{tender.title}</h3><span className="project-ref">Tender ID: {identifier} · Type: {tender.type || 'Road'}</span></div><div className="tender-cell" data-label="Department">{department}</div><div className="tender-cell mono" data-label="Tender ID">{identifier}</div><div className="tender-cell amount-cell" data-label="Contract amount (AOC)">{aoc != null ? formatCurrency(aoc) : 'Not disclosed'}</div><div className="tender-cell amount-cell" data-label="Amount disbursed">{disbursed != null ? formatCurrency(disbursed) : <><span>Not disclosed</span><a className="rti-link" href="https://rtimanipur.mn.gov.in/" target="_blank" rel="noopener noreferrer">File an RTI on the MANIPUR RTI portal</a></>}</div><div className="tender-cell" data-label="Project status"><span className={`status-pill ${statusClass(tender.status)}`}><i />{formatStatus(tender.status)}</span></div><div className="tender-action"><button className="button button-outline button-small" onClick={() => onDetails(tender)} aria-label={`View details for ${tender.tender_ref}`}>View Details</button><button className="button button-primary button-small" onClick={() => onShowOnMap(tender)} aria-label={`Show ${tender.title} on map`}>Show on Map</button></div></article>
}

function TenderTable({ items, onDetails, onShowOnMap, loading, error, onRetry }) {
  if (loading) return <div className="state-panel"><span className="spinner" />Loading tender records…</div>
  if (error) return <div className="state-panel state-error"><strong>Unable to load tenders</strong><span>{error}</span><button className="button button-outline button-small" onClick={onRetry}>Try again</button></div>
  if (!items.length) return <div className="state-panel">No public tender records match these filters.</div>
  return <div className="tender-table"><div className="tender-table-head"><span>PROJECT / TENDER ID</span><span>DEPARTMENT</span><span>TENDER ID</span><span>CONTRACT AMOUNT (AOC)</span><span>AMOUNT DISBURSED</span><span>PROJECT STATUS</span><span /></div>{items.map(t => <TenderRow key={t.tender_ref} tender={t} onDetails={onDetails} onShowOnMap={onShowOnMap} />)}</div>
}

function Detail({ label, value }) { return <div className="detail-item"><span>{label}</span><strong>{value || 'Not provided'}</strong></div> }

function DetailSection({ title, children }) {
  return <section className="detail-section"><h3>{title}</h3>{children}</section>
}

function routeAttributes(properties = {}) {
  const attributes = []
  const excluded = new Set(['tender_ref', 'tender_refs', 'tender_title', 'tender_status', 'district', 'name', 'source_filename', 'geometry_type', 'description'])
  for (const [label, value] of Object.entries(properties)) {
    if (excluded.has(label) || value == null || typeof value === 'object' || String(value).trim() === '') continue
    attributes.push([label.replaceAll('_', ' '), String(value).trim()])
  }
  if (typeof properties.description === 'string' && typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(properties.description, 'text/html')
    for (const row of document.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll(':scope > td, :scope > th')].map(cell => cell.textContent.trim()).filter(Boolean)
      if (cells.length >= 2) attributes.push([cells[0], cells.slice(1).join(' · ')])
    }
  }
  const seen = new Set()
  return attributes.filter(([label, value]) => {
    const key = `${label.toLocaleLowerCase()}|${value.toLocaleLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function TenderInformation({ tender }) {
  const extra = tender.extra_data || {}
  const contractor = tender.award?.contractor
  const amountDisbursed = tender.amount_disbursed ?? extra.amount_disbursed
  const emails = [...(extra.contractor_emails || []), ...(extra.contractor_email ? [extra.contractor_email] : [])]
  const grievance = extra.grievance_contact || extra.project_office_contact
  const location = [
    tender.location_label,
    extra.map_label ? `Map label: ${extra.map_label}` : null,
    extra.reference_document_label ? `Reference document: ${extra.reference_document_label}` : null,
    extra.map_coordinates_status === 'not_supplied' ? 'Map coordinates not supplied' : null,
  ].filter(Boolean).join(' · ') || (tender.location ? `${tender.location.lat.toFixed(4)}, ${tender.location.lng.toFixed(4)}` : 'Location not provided')
  const documents = tender.documents || []

  return <>
    <DetailSection title="Value and timeline"><div className="detail-grid">
      <Detail label="Estimated value" value={tender.estimated_value == null ? 'Not disclosed' : formatCurrency(tender.estimated_value)} />
      <Detail label="Awarded contract value" value={tender.award?.awarded_value == null ? 'Not disclosed' : formatCurrency(tender.award.awarded_value)} />
      <Detail label="Bid opening" value={formatDate(tender.bid_open_date)} />
      <Detail label="Bid closing" value={formatDate(tender.bid_close_date)} />
      <Detail label="AOC date" value={formatDate(tender.award?.aoc_date)} />
      <Detail label="Contract date" value={formatDate(extra.contract_date)} />
      <Detail label="Completion period" value={extra.work_completion_days ? `${Number(extra.work_completion_days).toLocaleString('en-IN')} days` : 'Not provided'} />
      <div className="detail-item"><span>Amount disbursed</span><strong>{amountDisbursed == null ? 'Not disclosed' : formatCurrency(amountDisbursed)}</strong>{amountDisbursed == null && <a className="rti-link" href="https://rtimanipur.mn.gov.in/" target="_blank" rel="noopener noreferrer">File an RTI on the MANIPUR RTI portal</a>}</div>
    </div></DetailSection>

    <DetailSection title="Tender identification"><div className="detail-grid">
      <Detail label="Tender ID" value={tender.identifiers?.tender_id || tender.tender_ref} />
      <Detail label="Type" value={tender.type || 'Not specified'} />
      <Detail label="Reference number" value={tender.identifiers?.reference_number || 'Tender ID and reference number not provided'} />
    </div></DetailSection>

    <DetailSection title="Department"><div className="detail-contact-block">
      <strong>{tender.department?.name || 'Department not provided'}</strong>
      {tender.department?.district && <span>{tender.department.district}</span>}
      {(tender.department?.officers || []).length > 0 ? tender.department.officers.map(officer => <div className="detail-contact" key={officer.id}><span>{officer.name} · {officer.designation}</span><strong>{officer.office_phone || 'Phone not provided'}</strong></div>) : <p>No department contact details supplied.</p>}
    </div></DetailSection>

    <DetailSection title="Contractor Information"><div className="detail-contact-block">
      {contractor ? <>
        <strong>{contractor.company_name}</strong>
        <span>{tender.award?.provisional ? 'Working-note award · awaiting review' : (tender.award?.aoc_date ? formatDate(tender.award.aoc_date) : 'Award disclosed')}</span>
        {contractor.registration_no && <div className="detail-contact"><span>Registration number</span><strong>{contractor.registration_no}</strong></div>}
        {emails.map(email => <div className="detail-contact" key={email}><span>Public corporate email</span><a href={`mailto:${email}`}>{email}</a></div>)}
        {extra.contractor_phone && <div className="detail-contact"><span>Public corporate phone</span><a href={`tel:${extra.contractor_phone}`}>{extra.contractor_phone}</a></div>}
        {(contractor.contacts || []).map(contact => <div className="detail-contact" key={contact.id}><span>{contact.name} · {contact.role}</span><strong>{contact.office_phone || 'Phone not provided'}</strong></div>)}
      </> : <p>Not disclosed in the available record.</p>}
    </div></DetailSection>

    <DetailSection title="Location"><p className="detail-section-copy">{location}</p></DetailSection>

    <DetailSection title="Grievance Contact">{grievance ? <div className="detail-contact-block">
      {grievance.email && <div className="detail-contact"><span>Email</span><a href={`mailto:${grievance.email}`}>{grievance.email}</a></div>}
      {grievance.phone && <div className="detail-contact"><span>Phone</span><a href={`tel:${grievance.phone}`}>{grievance.phone}</a></div>}
    </div> : <p className="detail-section-copy">No contact details supplied.</p>}</DetailSection>

    <DetailSection title="Documents & Route Plans">
      {tender.work_order_url && <a className="detail-document" href={tender.work_order_url} download aria-label="Download work order or tender document"><Icon name="file" size={16} /><span className="document-copy">Work order / tender document</span><span className="download-button" aria-hidden="true"><Icon name="download" size={15} /></span></a>}
      {documents.length ? <div className="detail-document-list">{documents.map(doc => {
        const filename = String(doc.filename || '')
        const isMapLayout = /^loapackage[1-3]\.pdf$/i.test(filename)
        const isKmz = /\.kmz(?:$|[?#])/i.test(filename) || /application\/vnd\.google-earth\.kmz/i.test(String(doc.content_type || ''))
        const isPdf = /\.pdf(?:$|[?#])/i.test(filename) || /application\/pdf/i.test(String(doc.content_type || ''))
        const fileType = isKmz ? 'KMZ' : isPdf ? 'PDF' : filename.split('.').pop()?.toUpperCase()
        const label = isMapLayout ? 'Work order' : String(doc.label || 'Tender document').replace(/Award of Contract/gi, 'Work Order')
        return <div className="detail-document-entry" key={doc.id || filename || label}>
          <a className="detail-document" href={doc.download_url} download={filename || undefined} aria-label={`Download ${filename || label}`}><Icon name="file" size={16} /><span className="document-copy">{label}<small>{filename}</small></span>{fileType && <span className="document-type">{fileType}</span>}<span className="download-button" aria-hidden="true"><Icon name="download" size={15} /></span></a>
          {isKmz && <p className="document-hint"><span aria-hidden="true">ⓘ</span> Hint: To view this file, install Google Earth for mobile and Google Earth Pro for laptop.</p>}
          {doc.hint && <p className="document-hint"><span aria-hidden="true">ⓘ</span> Hint: {doc.hint}</p>}
          {isMapLayout && <div className="map-layout-hint"><strong>• Map layout: Pdf</strong><span>ⓘ Hint: The map layout is in the 6th page in the pdf provided above.</span></div>}
        </div>
      })}</div> : <p className="detail-section-copy">No tender documents attached.</p>}
    </DetailSection>
    <p className="detail-record-note">Verification status and immutable source records are permanently retained in civic storage.</p>
  </>
}

function TenderDetails({ tender, loading, onClose }) {
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('modal-open')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open') }
  }, [onClose])
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="details-modal" role="dialog" aria-modal="true" aria-labelledby="details-title"><div className="modal-topline"><Eyebrow>PUBLIC TENDER RECORD</Eyebrow><button className="icon-button" aria-label="Close details" onClick={onClose}><Icon name="close" /></button></div>
    {loading ? <div className="state-panel"><span className="spinner" />Loading record details…</div> : tender?.load_error ? <div className="state-panel state-error"><strong>No linked public tender record could be loaded for this road.</strong><span>{tender.load_error}</span></div> : tender ? <><div className="details-heading"><span className={`status-pill ${statusClass(tender.status)}`}><i />{formatStatus(tender.status)}</span><h2 id="details-title">{tender.title}</h2><p>{tender.department?.name || 'Department not listed'} · {tender.tender_ref}</p></div><p className="detail-intro">{tender.extra_data?.project_scope || tender.description || 'No description has been published.'}</p>{(tender.prototype_data || tender.extra_data?.prototype_data) && <div className="prototype-note">Prototype record: details have not been independently verified against original tender documents.</div>}
      <TenderInformation tender={tender} />
    </> : <div className="state-panel">Tender details are unavailable.</div>}<div className="modal-footer"><span>RoadSathi · Public information service</span><button className="button button-primary button-small" onClick={onClose}>Close</button></div></section></div>
}

function MapView({ onDetails, onShowOnMap, mapTarget, onTargetHandled }) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const projectLayersRef = useRef(null)
  const mapDataRef = useRef(null)
  const selectedRouteRef = useRef([])
  const lastHandledTargetRef = useRef(null)
  const detailsRequestRef = useRef(0)
  const [results, setResults] = useState([])
  const [selectedRoad, setSelectedRoad] = useState(null)
  const [selectedProjects, setSelectedProjects] = useState([])
  const [projectLoading, setProjectLoading] = useState(false)
  const [projectError, setProjectError] = useState('')
  const [showProjectDetails, setShowProjectDetails] = useState(true)
  const [districts, setDistricts] = useState([])
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [mapCoverage, setMapCoverage] = useState(null)
  const [mapError, setMapError] = useState('')
  const [mapDataReady, setMapDataReady] = useState(false)
  const [mapRevision, setMapRevision] = useState(0)
  const [searchState, setSearchState] = useState({ loading: false, searched: false, error: '' })
  const loadProjectDetails = useCallback(async tenderRefs => {
    const requestId = ++detailsRequestRef.current
    const refs = [...new Set((Array.isArray(tenderRefs) ? tenderRefs : [tenderRefs]).filter(Boolean))]
    setSelectedProjects([])
    setProjectError('')
    setProjectLoading(true)
    try {
      const responses = await Promise.all(refs.map(async tenderRef => {
        try { return { tender: await api(`/tenders/${encodeURIComponent(tenderRef)}`) } }
        catch (error) { return { tenderRef, error } }
      }))
      if (requestId === detailsRequestRef.current) {
        const records = responses.flatMap(response => response.tender ? [response.tender] : [])
        setSelectedProjects(records)
        if (responses.some(response => response.error)) setProjectError(records.length ? 'Some linked tender records could not be loaded.' : 'No linked public tender record could be loaded for this road.')
      }
    } catch (error) {
      if (requestId === detailsRequestRef.current) setProjectError(error.message || 'Tender details are unavailable.')
    } finally {
      if (requestId === detailsRequestRef.current) setProjectLoading(false)
    }
  }, [])
  const selectRoad = useCallback((feature, layer, event) => {
    if (event?.originalEvent) window.L.DomEvent.stopPropagation(event.originalEvent)
    selectedRouteRef.current.forEach(selected => selected.setStyle({ color: '#356f9b', weight: 3, opacity: 0.85, fillColor: '#356f9b', fillOpacity: 1, radius: 5 }))
    layer.setStyle({ color: '#b36d26', weight: 6, opacity: 1, fillColor: '#b36d26', fillOpacity: 1, radius: 9 })
    layer.bringToFront?.()
    selectedRouteRef.current = [layer]
    const properties = feature.properties || {}
    const tenderRefs = [...new Set([properties.tender_ref || properties.tenderRef, ...(Array.isArray(properties.tender_refs) ? properties.tender_refs : [])].filter(Boolean))]
    setSelectedRoad({
      name: properties.name || properties.tender_title || 'Unnamed road feature',
      tenderTitle: properties.tender_title || null,
      tenderRefs,
      status: properties.tender_status || null,
      source: properties.source_filename || null,
      district: properties.district || null,
      attributes: routeAttributes(properties),
    })
    setShowProjectDetails(true)
    setResults([])
    setSearchState({ loading: false, searched: false, error: '' })
    markerRef.current?.remove()
    if (tenderRefs.length) loadProjectDetails(tenderRefs)
    else { detailsRequestRef.current++; setSelectedProjects([]); setProjectLoading(false); setProjectError('This mapped road has no linked public tender record.') }
  }, [loadProjectDetails])
  const searchLocation = useCallback(async ({ lat, lng }) => {
    selectedRouteRef.current.forEach(selected => selected.setStyle({ color: '#356f9b', weight: 3, opacity: 0.85, fillColor: '#356f9b', fillOpacity: 1, radius: 5 }))
    selectedRouteRef.current = []
    setSelectedRoad(null)
    setSelectedProjects([])
    setProjectError('')
    detailsRequestRef.current++
    markerRef.current?.remove()
    if (window.L && mapRef.current) markerRef.current = window.L.marker([lat, lng]).addTo(mapRef.current)
    setSearchState({ loading: true, searched: true, error: '' })
    try { const data = await api(`/tenders/geo-search?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&page=1&page_size=100`); setResults(data.items || []); setSearchState({ loading: false, searched: true, error: '' }) }
    catch (error) { setResults([]); setSearchState({ loading: false, searched: true, error: error.message }) }
  }, [])
  useEffect(() => {
    if (!mapElement.current || !window.L || mapRef.current) return undefined
    let active = true
    const map = window.L.map(mapElement.current, { scrollWheelZoom: false }).setView([24.82, 93.94], 8)
    mapRef.current = map
    projectLayersRef.current = window.L.featureGroup().addTo(map)
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
    map.on('click', event => {
      const target = event.originalEvent?.target
      if (event.layer || event.propagatedFrom || target?.closest?.('.leaflet-interactive, .leaflet-overlay-pane, .leaflet-marker-pane, .leaflet-control-container')) return
      searchLocation(event.latlng)
    })
    api('/tenders/map?bbox=-180,-90,180,90').then(data => {
      if (!active || mapRef.current !== map) return
      mapDataRef.current = data
      const availableDistricts = new Set([...(data.districts || []), ...(data.features || []).map(feature => feature.properties?.district), ...(data.items || []).map(item => item.district)].filter(Boolean))
      if (data.coverage?.district_unavailable) availableDistricts.add('__unspecified__')
      setDistricts([...availableDistricts].sort((a, b) => a.localeCompare(b)))
      setMapCoverage(data.coverage || null)
      setMapDataReady(true)
      setMapRevision(revision => revision + 1)
    }).catch(error => { if (active && mapRef.current === map) { setMapError(error.message || 'Map project data could not be loaded.'); setMapDataReady(true) } })
    const timer = window.setTimeout(() => map.invalidateSize(), 100)
    return () => { active = false; window.clearTimeout(timer); map.remove(); mapRef.current = null; markerRef.current = null; projectLayersRef.current = null }
  }, [searchLocation])
  useEffect(() => {
    const map = mapRef.current
    const data = mapDataRef.current
    const group = projectLayersRef.current
    if (!map || !data || !group || !window.L) return
    group.clearLayers()
    selectedRouteRef.current = []
    setSelectedRoad(null)
    setSelectedProjects([])
    setProjectError('')
    detailsRequestRef.current++
    const isDistrictVisible = properties => !selectedDistrict || (selectedDistrict === '__unspecified__' ? !properties.district : String(properties.district || '').toLocaleLowerCase() === selectedDistrict.toLocaleLowerCase())
    for (const feature of data.features || []) {
      if (!isDistrictVisible(feature.properties || {})) continue
      const road = window.L.geoJSON(feature, {
        style: { color: '#356f9b', weight: 3, opacity: 0.85 },
        onEachFeature: (roadFeature, layer) => {
          const properties = roadFeature.properties || {}
          layer.bindTooltip(properties.name || properties.tender_title || 'Mapped road')
          layer.on('click', event => selectRoad(roadFeature, layer, event))
        },
      })
      road.roadFeature = feature
      group.addLayer(road)
    }
    for (const item of data.items || []) {
      if (!isDistrictVisible(item)) continue
      const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [item.longitude, item.latitude] }, properties: { tender_ref: item.tender_ref, tender_title: item.title, tender_status: item.status, name: item.title, district: item.district } }
      const pin = window.L.circleMarker([item.latitude, item.longitude], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#356f9b', fillOpacity: 1 })
      pin.roadFeature = feature
      pin.bindTooltip(item.title || item.tender_ref)
      pin.on('click', event => selectRoad(feature, pin, event))
      group.addLayer(pin)
    }
    if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding: [20, 20], maxZoom: selectedDistrict ? 12 : 9 })
    else if (!selectedDistrict) map.setView([24.82, 93.94], 8)
  }, [mapRevision, selectedDistrict, selectRoad])
  useEffect(() => {
    const map = mapRef.current
    const group = projectLayersRef.current
    if (!mapTarget || !map || !group || !mapDataReady || lastHandledTargetRef.current === mapTarget.request) return
    const matchingLayers = group.getLayers().filter(layer => {
      const properties = layer.feature?.properties || layer.roadFeature?.properties || {}
      return properties.tender_ref === mapTarget.tender_ref || properties.tender_refs?.includes?.(mapTarget.tender_ref)
    })
    if (!matchingLayers.length && mapTarget.location?.lat != null && mapTarget.location?.lng != null) {
      const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [mapTarget.location.lng, mapTarget.location.lat] }, properties: { tender_ref: mapTarget.tender_ref, tender_title: mapTarget.title, name: mapTarget.title, district: mapTarget.department?.district } }
      const pin = window.L.circleMarker([mapTarget.location.lat, mapTarget.location.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#b36d26', fillOpacity: 1 })
      pin.roadFeature = feature
      pin.bindTooltip(mapTarget.title || mapTarget.tender_ref)
      pin.on('click', event => selectRoad(feature, pin, event))
      group.addLayer(pin)
      matchingLayers.push(pin)
    }
    selectedRouteRef.current.forEach(selected => selected.setStyle({ color: '#356f9b', weight: 3, opacity: 0.85, fillColor: '#356f9b', fillOpacity: 1, radius: 5 }))
    let linkedTenderRefs = [mapTarget.tender_ref]
    if (matchingLayers.length) {
      matchingLayers.forEach(layer => {
        layer.setStyle({ color: '#b36d26', weight: 6, opacity: 1, fillColor: '#b36d26', fillOpacity: 1, radius: 9 })
        layer.bringToFront?.()
      })
      selectedRouteRef.current = matchingLayers
      const firstFeature = matchingLayers[0].feature || matchingLayers[0].roadFeature || {}
      const properties = firstFeature.properties || {}
      const tenderRefs = [...new Set([properties.tender_ref, ...(Array.isArray(properties.tender_refs) ? properties.tender_refs : [])].filter(Boolean))]
      linkedTenderRefs = tenderRefs.length ? tenderRefs : [mapTarget.tender_ref]
      setSelectedRoad({ name: properties.name || properties.tender_title || mapTarget.title, tenderTitle: properties.tender_title || mapTarget.title, tenderRefs: tenderRefs.length ? tenderRefs : [mapTarget.tender_ref], status: properties.tender_status || mapTarget.status, source: properties.source_filename || null, district: properties.district || mapTarget.department?.district, attributes: routeAttributes(properties) })
      const bounds = window.L.featureGroup(matchingLayers).getBounds()
      if (bounds.isValid()) map.flyToBounds(bounds.pad(0.12), { maxZoom: matchingLayers.length > 1 ? 12 : 14, duration: 0.65 })
    } else {
      setSelectedRoad({ name: mapTarget.title || mapTarget.tender_ref, tenderTitle: mapTarget.title, tenderRefs: [mapTarget.tender_ref], status: mapTarget.status, district: mapTarget.department?.district, unmapped: true, attributes: [] })
    }
    setResults([])
    setSearchState({ loading: false, searched: false, error: '' })
    markerRef.current?.remove()
    setShowProjectDetails(true)
    loadProjectDetails(linkedTenderRefs)
    lastHandledTargetRef.current = mapTarget.request
    onTargetHandled(mapTarget.request)
  }, [mapTarget, mapRevision, mapDataReady, selectedDistrict, loadProjectDetails, onTargetHandled, selectRoad])
  const findMe = () => {
    if (!navigator.geolocation) { setSearchState({ loading: false, searched: false, error: 'Location services are not available in this browser.' }); return }
    setSearchState({ loading: true, searched: false, error: '' })
    navigator.geolocation.getCurrentPosition(position => { const point = { lat: position.coords.latitude, lng: position.coords.longitude }; mapRef.current?.setView([point.lat, point.lng], 13); searchLocation(point) }, () => setSearchState({ loading: false, searched: false, error: 'Your location could not be determined. You can still click on the map.' }), { timeout: 10000, maximumAge: 60000 })
  }
  return <main className="page-shell map-page">
    <div className="page-heading"><div><Eyebrow>LOCATION-BASED DISCOVERY</Eyebrow><h1>Map view</h1><p>Select a tender route or project point to highlight it on the map and view its available details.</p></div><button className="button button-outline" onClick={findMe}><Icon name="pin" size={16} /> Use my location</button></div>
    <div className="map-layout">
      <div className="map-frame"><div ref={mapElement} className="interactive-map" aria-label="Interactive map of Manipur" /><div className="map-attribution">Map data &copy; OpenStreetMap contributors</div></div>
      <aside className="map-side"><Eyebrow>MAP SEARCH</Eyebrow><h2>Explore mapped projects</h2><p>Roads and project locations use the geographic records currently available in RoadSathi. Select a road or point to view its project details.</p>
        <label className="select-field map-district-field"><span>District</span><select value={selectedDistrict} onChange={event => setSelectedDistrict(event.target.value)}><option value="">All available areas</option>{districts.map(district => <option key={district} value={district}>{district === '__unspecified__' ? 'District not provided' : district}</option>)}</select></label>
        {selectedDistrict && <button className="text-button map-full-extent" onClick={() => setSelectedDistrict('')}>Show all available areas</button>}
        {selectedRoad ? <>
          <section className="selected-road-card" aria-live="polite">
            <Eyebrow>SELECTED ROAD / PROJECT</Eyebrow>
            <h3>{selectedRoad.name}</h3>
            {selectedRoad.tenderTitle && selectedRoad.tenderTitle !== selectedRoad.name && <p>{selectedRoad.tenderTitle}</p>}
            {selectedRoad.district && <small>District: {selectedRoad.district}</small>}
            {selectedRoad.source && <small>Route source: {selectedRoad.source}</small>}
            {selectedRoad.status && <span className={`status-pill ${statusClass(selectedRoad.status)}`}><i />{formatStatus(selectedRoad.status)}</span>}
            {selectedRoad.tenderRefs?.length ? <>
              <div className="selected-road-ref">{selectedRoad.tenderRefs.length === 1 ? 'Tender ID' : 'Linked Tender IDs'}: {selectedRoad.tenderRefs.join(' · ')}</div>
              {selectedRoad.unmapped && <div className="map-empty">{mapError ? 'Map data could not be loaded, so route availability could not be confirmed.' : 'This tender has no route geometry or project coordinates available to plot. Its available project information is shown below.'}</div>}
              <div className="map-selection-actions"><button className="button button-primary button-small" onClick={() => setShowProjectDetails(value => !value)}>{showProjectDetails ? 'Hide Details' : 'Show Details'}</button><button className="button button-outline button-small" onClick={() => onDetails({ tender_ref: selectedRoad.tenderRefs[0] })}>View Details</button></div>
            </> : <div className="map-empty">No registered tender is linked to this road. Available route information is shown here.</div>}
            {selectedRoad.attributes?.length > 0 && <details className="route-attributes"><summary>Available road information</summary><dl>{selectedRoad.attributes.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>}
          </section>
          {selectedRoad.tenderRefs?.length > 0 && showProjectDetails && <section className="map-project-details" aria-label="Selected project details">
            {projectLoading && <div className="map-state"><span className="spinner" />Loading linked tender details…</div>}
            {projectError && <div className="inline-alert">{projectError}</div>}
            {selectedProjects.map((tender, index) => <article className="map-matched-tender" key={tender.tender_ref}>
              <Eyebrow>{selectedProjects.length > 1 ? `MATCHED TENDER ${index + 1} OF ${selectedProjects.length}` : 'MATCHED TENDER'}</Eyebrow>
              <h3>{tender.title}</h3>
              <p className="map-project-description">{tender.extra_data?.project_scope || tender.description || 'No project description is available.'}</p>
              <TenderInformation tender={tender} />
            </article>)}
          </section>}
        </> : <>
          <div className="map-hint"><Icon name="pin" size={17} /> Select a road or project marker to view its linked tender details. You can also click the map to search nearby checkpoints.</div>
          {mapError && <div className="inline-alert">{mapError}</div>}
          {mapCoverage && <div className="map-coverage-note">Showing {mapCoverage.plotted_tender_total} of {mapCoverage.public_tender_total} public records with map coordinates or road geometry.</div>}
          {mapCoverage?.unmapped_tenders?.length > 0 && <details className="map-unmapped"><summary>{mapCoverage.unmapped_tenders.length} records cannot be plotted</summary><ul>{mapCoverage.unmapped_tenders.map(record => <li key={record.tender_ref}><strong>{record.title}</strong><span>{record.district || 'District not provided'} · {record.reason}</span></li>)}</ul></details>}
          {searchState.error && <div className="inline-alert">{searchState.error}</div>}
          {searchState.loading && <div className="map-state"><span className="spinner" />Searching registered checkpoints…</div>}
          {!searchState.loading && searchState.searched && !searchState.error && <div className="map-result-summary"><strong>{results.length}</strong><span>{results.length === 1 ? 'nearby tender' : 'nearby tenders'}</span></div>}
          {!searchState.loading && searchState.searched && !searchState.error && results.length === 0 && <div className="map-empty">No registered road projects were found near this location. No matching checkpoints are currently registered in RoadSathi; this does not necessarily mean there are no government projects in the area.</div>}
        </>}
      </aside>
    </div>
    {!selectedRoad && results.length > 0 && <section className="results-section map-results-section"><div className="section-title-row"><div><Eyebrow>NEARBY RECORDS</Eyebrow><h2>Tenders near selected location</h2></div><span className="result-count">{results.length} records</span></div><TenderTable items={results} onDetails={onDetails} onShowOnMap={onShowOnMap} loading={searchState.loading} error={searchState.error} onRetry={() => {}} /></section>}
  </main>
}

function StaffAccess() {
  const [setup, setSetup] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [verifyStep, setVerifyStep] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm_password: '', code: '' })

  useEffect(() => {
    let active = true
    api('/auth/admin-setup/status').then(value => { if (active) setSetup(value) }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setLoadingStatus(false) })
    return () => { active = false }
  }, [])

  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const finishSession = data => {
    sessionStorage.setItem('opentender_jwt', data.access_token)
    if (data.refresh_token) sessionStorage.setItem('opentender_refresh_token', data.refresh_token)
    window.location.assign('/admin/v1/')
  }
  const submitLogin = async event => {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true)
    try {
      finishSession(await api('/auth/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email, password: form.password }) }))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const submitSetup = async event => {
    event.preventDefault(); setError(''); setMessage('')
    if (form.password !== form.confirm_password) { setError('Passwords do not match.'); return }
    if (form.password.length < 8 || !/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/[0-9]/.test(form.password) || !/[^A-Za-z0-9]/.test(form.password)) { setError('Password must be at least 8 characters and include uppercase, lowercase, number, and symbol characters.'); return }
    setBusy(true)
    try {
      const result = await api('/auth/admin-setup/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: form.full_name, email: form.email, phone: form.phone || null, password: form.password }) })
      setVerifyStep(true); setMessage(result.message)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const verifySetup = async event => {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      finishSession(await api('/auth/admin-setup/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email, code: form.code }) }))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return <main className="staff-access-page"><section className="staff-access-card" aria-labelledby="staff-access-title">
    <div className="eyebrow"><span /> SECURE ADMINISTRATOR ACCESS</div>
    <h1 id="staff-access-title">{setup?.setup_available ? (verifyStep ? 'Verify your email' : 'Set up the first admin') : 'Administrator sign in'}</h1>
    <p className="staff-access-intro">{setup?.setup_available ? (verifyStep ? `Enter the six-digit code sent to ${form.email}.` : 'Create the first administrator account for the RoadSathi website.') : 'Sign in to review and manage the public transparency portal.'}</p>
    {loadingStatus && <p role="status">Checking administrator setup…</p>}
    {!loadingStatus && setup?.setup_available && !setup.email_delivery_ready && <div className="staff-message" role="status">First-admin setup is available, but email verification is not configured. An administrator must configure SMTP_HOST and SMTP_FROM_EMAIL in the server environment before setup can continue.</div>}
    {message && <div className="staff-message" role="status">{message}</div>}
    {error && <div className="staff-error" role="alert">{error}</div>}

    {!loadingStatus && !setup?.setup_available && <form className="staff-form" onSubmit={submitLogin}>
      <label>Email<input name="email" type="email" autoComplete="username" required value={form.email} onChange={update} /></label>
      <label>Password<span className="staff-password-input"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={form.password} onChange={update} /><button type="button" className="staff-toggle-password" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></span></label>
      <button className="button button-primary staff-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to admin console'}</button>
    </form>}

    {!loadingStatus && setup?.setup_available && !verifyStep && setup.email_delivery_ready && <form className="staff-form" onSubmit={submitSetup}>
      <label>Full name<input name="full_name" type="text" autoComplete="name" minLength="2" maxLength="160" required value={form.full_name} onChange={update} /></label>
      <label>Email (username)<input name="email" type="email" autoComplete="email" required value={form.email} onChange={update} /></label>
      <label>Phone number <span className="staff-optional">Optional, for future OTP use</span><input name="phone" type="tel" autoComplete="tel" maxLength="40" value={form.phone} onChange={update} /></label>
      <label>Password<span className="staff-password-input"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="8" required value={form.password} onChange={update} /><button type="button" className="staff-toggle-password" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></span></label>
      <small className="staff-password-help">At least 8 characters with uppercase, lowercase, a number, and a symbol.</small>
      <label>Confirm password<input name="confirm_password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="8" required value={form.confirm_password} onChange={update} /></label>
      <button className="button button-primary staff-submit" type="submit" disabled={busy}>{busy ? 'Sending verification code…' : 'Email me a verification code'}</button>
    </form>}

    {!loadingStatus && setup?.setup_available && verifyStep && <form className="staff-form" onSubmit={verifySetup}>
      <label>Six-digit email verification code<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required value={form.code} onChange={update} /></label>
      <button className="button button-primary staff-submit" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify email and create admin'}</button>
    </form>}
    <p className="staff-access-foot">Administrator access is restricted to authorised website managers.</p>
  </section></main>
}

function App() {
  const [page, setPage] = useState(() => window.location.hash.slice(1) === 'staff-sign-in' ? 'Staff Sign In' : (pages.find(p => pageIds[p] === window.location.hash.slice(1)) || 'Overview'))
  const [tenders, setTenders] = useState([])
  const [departments, setDepartments] = useState([])
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ q: '', department_id: '', status: '', sort: '-updated_at' })
  const [selectedTender, setSelectedTender] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [mapTarget, setMapTarget] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const mapRequestRef = useRef(0)
  const { q: searchQuery, department_id: departmentFilter, status: statusFilter } = filters
  const navigate = useCallback(target => { setPage(target); const hash = `#${pageIds[target]}`; if (window.location.hash !== hash) window.history.pushState(null, '', hash); window.scrollTo({ top: 0, behavior: 'smooth' }) }, [])
  const showTenderOnMap = useCallback(tender => {
    setMapTarget({ ...tender, request: ++mapRequestRef.current })
    navigate('Map View')
  }, [navigate])
  const handleMapTargetHandled = useCallback(request => setMapTarget(current => current?.request === request ? null : current), [])
  useEffect(() => { const handle = () => setPage(window.location.hash.slice(1) === 'staff-sign-in' ? 'Staff Sign In' : (pages.find(p => pageIds[p] === window.location.hash.slice(1)) || 'Overview')); window.addEventListener('hashchange', handle); window.addEventListener('popstate', handle); return () => { window.removeEventListener('hashchange', handle); window.removeEventListener('popstate', handle) } }, [])
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('')
      const params = new URLSearchParams({ page: '1', page_size: '100', sort: '-updated_at' })
      if (searchQuery.trim()) params.set('q', searchQuery.trim())
      if (departmentFilter) params.set('department_id', departmentFilter)
      if (statusFilter) params.set('status', statusFilter)
      try {
        const firstPage = await api('/tenders?' + params)
        const pageCount = Math.ceil((firstPage.total || (firstPage.items || []).length) / 100)
        const remainingPages = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => {
          const nextParams = new URLSearchParams(params)
          nextParams.set('page', String(index + 2))
          return api('/tenders?' + nextParams)
        }))
        const allRecords = [...(firstPage.items || []), ...remainingPages.flatMap(page => page.items || [])]
        if (active) setTenders(allRecords)
      }
      catch (err) { if (active) { setError(err.message); setTenders([]) } }
      finally { if (active) setLoading(false) }
    }, searchQuery ? 250 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [searchQuery, departmentFilter, statusFilter, refreshKey])
  useEffect(() => {
    let active = true
    Promise.allSettled([api('/stats'), api('/activity?limit=5'), api('/departments')]).then(([statResult, activityResult, departmentResult]) => {
      if (!active) return
      if (statResult.status === 'fulfilled') setStats(statResult.value)
      if (activityResult.status === 'fulfilled') setActivity(activityResult.value.items || [])
      if (departmentResult.status === 'fulfilled') setDepartments(departmentResult.value || [])
    })
    return () => { active = false }
  }, [])
  const openDetails = useCallback(async tender => { setSelectedTender(tender); setDetailsLoading(true); try { setSelectedTender(await api(`/tenders/${encodeURIComponent(tender.tender_ref)}`)) } catch (error) { setSelectedTender({ ...tender, load_error: error.message }) } finally { setDetailsLoading(false) } }, [])
  const awardedRows = useMemo(() => tenders.filter(t => t.award?.awarded_value != null), [tenders])
  const awardedSum = stats?.total_awarded_value ?? awardedRows.reduce((sum, tender) => sum + Number(tender.award.awarded_value), 0)
  const tenderProps = { items: tenders, onDetails: openDetails, onShowOnMap: showTenderOnMap, loading, error, onRetry: () => setRefreshKey(key => key + 1) }
  const sortedTenders = useMemo(() => sortTenderRecords(tenders, filters.sort), [tenders, filters.sort])
  return <div className="app-shell"><Header page={page} navigate={navigate} />
    {page === 'Staff Sign In' && <StaffAccess />}
    {page === 'Overview' && <main><section className="hero-section"><div className="hero-image" role="img" aria-label="Road through Manipur" /><div className="hero-shade" /><div className="hero-content"><div className="hero-copy"><Eyebrow>MANIPUR · PUBLIC INFRASTRUCTURE</Eyebrow><h1>Public infrastructure.<br /><span>Public knowledge.</span></h1><p>RoadSathi brings road project and tender information into one clear, accessible place for every citizen.</p><div className="hero-actions"><button className="button button-light" onClick={() => navigate('Tenders')}>Explore tenders <Icon name="arrow" size={16} /></button><button className="button button-ghost-light" onClick={() => navigate('Map View')}><Icon name="pin" size={16} /> View on map</button></div></div><div className="hero-caption">INDO-MYANMAR ROAD · MANIPUR <a href="https://commons.wikimedia.org/wiki/File:Indo-Myanmar_Road,_Asian_Highway_No.1.jpg" target="_blank" rel="noreferrer">Photo: Premdatta Laitonjam / CC BY-SA 4.0</a></div></div></section>
      <div className="page-shell overview-content"><section className="stats-strip" aria-label="RoadSathi summary statistics"><Stat label="Published tenders" value={stats ? Number(stats.published_tenders || 0).toLocaleString('en-IN') : '—'} /><Stat label="Awards disclosed" value={stats ? Number(stats.awards_disclosed || 0).toLocaleString('en-IN') : '—'} /><Stat label="Total awarded contract value" value={stats ? formatCurrency(awardedSum) : '—'} note="As disclosed in public records" /><Stat label="Departments" value={stats ? Number(stats.departments || 0).toLocaleString('en-IN') : '—'} /></section>
        <div className="overview-grid"><section className="activity-section"><div className="section-title-row"><div><Eyebrow>RECENT UPDATES</Eyebrow><h2>Latest tender activity</h2></div><button className="text-button" onClick={() => navigate('Tenders')}>All tenders <Icon name="arrow" size={15} /></button></div>{activity.length ? <div className="activity-list">{activity.map((item, i) => <div className="activity-item" key={`${item.tender_ref}-${i}`}><span className={`activity-icon ${item.status === 'awarded' ? 'activity-award' : ''}`}><Icon name={item.status === 'awarded' ? 'check' : 'clock'} size={16} /></span><div className="activity-copy"><strong>{item.event}</strong><span>{item.title}</span><small>{item.department} · {formatDate(item.created_at)}</small></div><span className={`status-pill ${statusClass(item.status)}`}><i />{formatStatus(item.status)}</span></div>)}</div> : <div className="subtle-empty">Activity will appear here when public records are available.</div>}</section>
          <aside className="award-summary"><Eyebrow>CONTRACT DISCLOSURE</Eyebrow><h2>Awarded contracts</h2><p>Explore contract awards and contractor information published through RoadSathi.</p><div className="award-total">{stats ? formatCurrency(awardedSum) : '—'}</div><div className="award-total-label">Total value disclosed</div><div className="award-meta"><span>{stats ? Number(stats.awards_disclosed || 0).toLocaleString('en-IN') : '—'} awards listed</span><span>Public records</span></div><button className="text-button" onClick={() => { setFilters(current => ({ ...current, status: 'awarded' })); navigate('Tenders') }}>Review awarded projects <Icon name="arrow" size={15} /></button></aside></div>
        <section className="map-promo"><div className="map-promo-copy"><Eyebrow>GEOGRAPHIC SEARCH</Eyebrow><h2>Explore projects on the map</h2><p>Choose a location in Manipur and discover public tender records associated with nearby project checkpoints.</p><button className="button button-primary" onClick={() => navigate('Map View')}>Open map view <Icon name="arrow" size={16} /></button></div><div className="map-preview"><span className="map-contour contour-one"/><span className="map-contour contour-two"/><span className="map-road road-one"/><span className="map-road road-two"/><span className="map-label">MANIPUR</span><span className="map-marker"><Icon name="pin" size={17} /></span><span className="map-coordinate">24.8170° N &nbsp; 93.9368° E</span></div></section></div>
    </main>}
    {page === 'Tenders' && <main className="page-shell tenders-page"><div className="page-heading"><div><Eyebrow>PUBLIC PROCUREMENT RECORDS</Eyebrow><h1>Tenders &amp; projects</h1><p>Search published road projects, tender notices and disclosed contract awards.</p></div><div className="record-count"><strong>{loading ? '—' : sortedTenders.length}</strong><span>records shown</span></div></div><section className="filter-panel" aria-label="Tender search and filters"><label className="search-field"><Icon name="search" size={18} /><input type="search" placeholder="Search project, tender ID or department" value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} /><kbd>Search</kbd></label><label className="select-field"><span>Department</span><select value={filters.department_id} onChange={e => setFilters({ ...filters, department_id: e.target.value })}><option value="">All departments</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="select-field"><span>Project status</span><select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">All statuses</option><option value="published">Published</option><option value="awarded">Awarded</option></select></label><label className="select-field sort-field"><span>Sort by</span><select value={filters.sort} onChange={e => setFilters({ ...filters, sort: e.target.value })}><option value="-updated_at">Recently updated</option><option value="date-oldest">Oldest updated</option><option value="name-asc">Project name (A–Z)</option><option value="name-desc">Project name (Z–A)</option><option value="award-high">Highest awarded value</option><option value="award-low">Lowest awarded value</option><option value="close-soon">Closing soon</option></select></label></section><section className="results-section"><div className="section-title-row results-heading"><div><Eyebrow>AVAILABLE RECORDS</Eyebrow><h2>Road tenders</h2></div><span className="result-count">{loading ? 'Loading' : `${sortedTenders.length} records`}</span></div><TenderTable {...tenderProps} items={sortedTenders} /></section><p className="records-note"><Icon name="file" size={15} /> Award amounts are shown where disclosed. Amounts disbursed are not currently included in the public tender API.</p></main>}
    {page === 'Map View' && <MapView onDetails={openDetails} onShowOnMap={showTenderOnMap} mapTarget={mapTarget} onTargetHandled={handleMapTargetHandled} />}
    {page === 'About' && <main className="page-shell about-page"><div className="page-heading"><div><Eyebrow>ABOUT THE PORTAL</Eyebrow><h1>Public works, made visible.</h1><p>RoadSathi is a public information portal for road tenders and infrastructure projects in Manipur.</p></div></div><div className="about-layout"><section className="about-main"><h2>Clear information for everyone</h2><p>RoadSathi brings tender notices, project details, departments, contractors, award values and supporting documents together in one place. The portal helps residents understand what road work has been recorded and where to find the related public information.</p><p>Use keyword search to find a tender by its project name, identifier or department. Map View offers another way to discover records where project checkpoints have been registered.</p><h2>How to read a record</h2><p>Each tender record presents the information currently available through the public service. An award value is shown only when it has been disclosed. Disbursement amounts are not part of the current public API. Source and verification notes remain attached to prototype records where applicable.</p></section><aside className="about-facts"><Eyebrow>ROAD SATHI</Eyebrow><dl><div><dt>Service area</dt><dd>Manipur, India</dd></div><div><dt>Information</dt><dd>Public road tenders and awards</dd></div><div><dt>Search methods</dt><dd>Keyword and map-based</dd></div><div><dt>Maintained by</dt><dd>Authorised RoadSathi staff</dd></div></dl><button className="text-button" onClick={() => navigate('Tenders')}>Browse public records <Icon name="arrow" size={15} /></button></aside></div></main>}
    <footer className="site-footer"><div className="footer-inner"><span>© {new Date().getFullYear()} RoadSathi · Public infrastructure transparency</span><span>Manipur, India</span></div></footer>
    {selectedTender && <TenderDetails tender={selectedTender} loading={detailsLoading} onClose={() => { setSelectedTender(null); setDetailsLoading(false) }} />}
  </div>
}

export default App
