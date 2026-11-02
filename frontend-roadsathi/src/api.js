const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

export async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...options.headers },
    ...options,
  })
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try { detail = (await response.json()).detail || detail } catch { /* response was not JSON */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return response.status === 204 ? null : response.json()
}

export function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'Not disclosed'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

export function formatDate(value) {
  if (!value) return 'Date not provided'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date not provided'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

export function formatStatus(value) {
  return ({ awarded: 'Awarded', published: 'Published', pending_review: 'Under review', draft: 'Draft', cancelled: 'Cancelled' })[value] || value || 'Status unavailable'
}

export function statusClass(value) {
  return ({ awarded: 'status-awarded', published: 'status-published', pending_review: 'status-review', draft: 'status-draft', cancelled: 'status-cancelled' })[value] || 'status-neutral'
}
