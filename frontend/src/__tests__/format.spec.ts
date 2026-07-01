import { describe, expect, it } from 'vitest'
import { formatBytes, formatCount, formatExpiry } from '../format'

describe('format helpers', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(undefined)).toBe('-')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(48_000_000)).toBe('45.8 MB')
    expect(formatBytes(137_000_000_000)).toBe('128 GB')
  })

  it('formats counts', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1_500)).toBe('1.5k')
    expect(formatCount(2_400_000)).toBe('2.4M')
  })

  it('formats expiry', () => {
    expect(formatExpiry(undefined)).toBe('kept indefinitely')
    expect(formatExpiry(new Date(Date.now() - 1000).toISOString())).toBe('expired')
    expect(formatExpiry(new Date(Date.now() + 2 * 3_600_000 + 60_000).toISOString())).toBe(
      'expires in 2h',
    )
  })
})
