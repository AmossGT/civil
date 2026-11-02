export function sortTenderRecords(records, sort) {
  const valueFor = tender => {
    if (sort === 'name-asc' || sort === 'name-desc') return tender.title || ''
    if (sort === 'award-high' || sort === 'award-low') return tender.award?.awarded_value
    if (sort === 'close-soon') return tender.bid_close_date
    if (sort === 'date-newest' || sort === 'date-oldest') return tender.updated_at || tender.created_at || tender.award?.aoc_date
    return tender.updated_at || tender.created_at
  }
  const descending = ['name-desc', 'award-high', 'date-newest', '-updated_at'].includes(sort)
  return records.map((tender, index) => ({ tender, index, value: valueFor(tender) })).sort((a, b) => {
    const aMissing = a.value === null || a.value === undefined || a.value === ''
    const bMissing = b.value === null || b.value === undefined || b.value === ''
    if (aMissing !== bMissing) return aMissing ? 1 : -1
    let comparison = 0
    if (!aMissing && (sort === 'name-asc' || sort === 'name-desc')) comparison = String(a.value).localeCompare(String(b.value), undefined, { sensitivity: 'base', numeric: true })
    else if (!aMissing) comparison = Number.isFinite(Number(a.value)) && Number.isFinite(Number(b.value)) ? Number(a.value) - Number(b.value) : String(a.value).localeCompare(String(b.value))
    if (descending) comparison *= -1
    return comparison || a.index - b.index
  }).map(item => item.tender)
}
