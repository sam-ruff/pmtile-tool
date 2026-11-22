/// Shared display helpers.

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = ''
  for (const next of units) {
    value /= 1024
    unit = next
    if (value < 1024) break
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`
}

export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

export function formatElapsed(iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime()
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ago`
}

export function formatExpiry(iso: string | undefined): string {
  if (!iso) return 'kept indefinitely'
  const remaining = new Date(iso).getTime() - Date.now()
  if (remaining <= 0) return 'expired'
  const hours = Math.floor(remaining / 3_600_000)
  if (hours >= 1) return `expires in ${hours}h`
  const minutes = Math.max(1, Math.floor(remaining / 60_000))
  return `expires in ${minutes}m`
}
