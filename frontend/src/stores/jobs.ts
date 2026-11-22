import { defineStore } from 'pinia'
import { api } from '../api'
import { ApiRequestError } from '../api'
import type { ExportArea, JobStatus, JobView } from '../api'

const STORAGE_KEY = 'pmtile-tool:job-ids'
const REGION_KEY = 'pmtile-tool:region-ids'
const POLL_MS = 2000

function loadIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function saveIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // storage unavailable (private browsing); downloads just will not persist
  }
}

export function isActive(job: JobView): boolean {
  return job.status === 'queued' || job.status === 'running'
}

/// One row in the downloads list: a custom export or a ready-made region.
export interface DownloadEntry {
  key: string
  kind: 'custom' | 'region'
  title: string
  job: JobView
}

export type StatusListener = (entry: DownloadEntry, previous: JobStatus) => void

let statusListener: StatusListener | null = null

interface JobsState {
  ids: string[]
  jobs: Record<string, JobView>
  regionIds: string[]
  regionJobs: Record<string, JobView>
  regionNames: Record<string, string>
  createError: string | null
  creating: boolean
  pollHandle: number | null
}

export const useJobsStore = defineStore('jobs', {
  state: (): JobsState => ({
    ids: loadIds(STORAGE_KEY),
    jobs: {},
    regionIds: loadIds(REGION_KEY),
    regionJobs: {},
    regionNames: {},
    createError: null,
    creating: false,
    pollHandle: null,
  }),

  getters: {
    ordered(state): JobView[] {
      return state.ids.map((id) => state.jobs[id]).filter((j): j is JobView => Boolean(j))
    },
    downloads(state): DownloadEntry[] {
      const custom = state.ids
        .map((id) => state.jobs[id])
        .filter((j): j is JobView => Boolean(j))
        .map((job) => ({ key: job.id, kind: 'custom' as const, title: job.name ?? job.id, job }))
      const regions = state.regionIds
        .map((id) => ({ id, job: state.regionJobs[id] }))
        .filter((r): r is { id: string; job: JobView } => Boolean(r.job))
        .map(({ id, job }) => ({
          key: `region:${id}`,
          kind: 'region' as const,
          title: state.regionNames[id] ?? id,
          job,
        }))
      return [...custom, ...regions].sort((a, b) =>
        b.job.created_at.localeCompare(a.job.created_at),
      )
    },
    hasActive(): boolean {
      return this.downloads.some((d) => isActive(d.job))
    },
    activeCount(): number {
      return this.downloads.filter((d) => isActive(d.job)).length
    },
  },

  actions: {
    setStatusListener(listener: StatusListener | null) {
      statusListener = listener
    },

    async load() {
      await Promise.all([
        ...this.ids.map(async (id) => {
          try {
            this.jobs[id] = await api().getExport(id)
          } catch (e) {
            if (e instanceof ApiRequestError && e.status === 404) this.untrack(id)
          }
        }),
        ...this.regionIds.map(async (id) => {
          try {
            const detail = await api().regionDetail(id)
            this.regionNames[id] = detail.name
            if (detail.extract) {
              this.regionJobs[id] = detail.extract
            } else {
              this.untrackRegion(id)
            }
          } catch (e) {
            if (e instanceof ApiRequestError && e.status === 404) this.untrackRegion(id)
          }
        }),
      ])
      this.ensurePolling()
    },

    track(job: JobView) {
      this.jobs[job.id] = job
      if (!this.ids.includes(job.id)) {
        this.ids = [job.id, ...this.ids]
        saveIds(STORAGE_KEY, this.ids)
      }
      this.ensurePolling()
    },

    untrack(id: string) {
      this.ids = this.ids.filter((v) => v !== id)
      delete this.jobs[id]
      saveIds(STORAGE_KEY, this.ids)
    },

    trackRegion(regionId: string, name: string, job: JobView) {
      this.regionJobs[regionId] = job
      this.regionNames[regionId] = name
      if (!this.regionIds.includes(regionId)) {
        this.regionIds = [regionId, ...this.regionIds]
        saveIds(REGION_KEY, this.regionIds)
      }
      this.ensurePolling()
    },

    /// Region extracts are a shared cache, so this only forgets it locally.
    untrackRegion(regionId: string) {
      this.regionIds = this.regionIds.filter((v) => v !== regionId)
      delete this.regionJobs[regionId]
      saveIds(REGION_KEY, this.regionIds)
    },

    async requestRegion(regionId: string, name: string): Promise<JobView | null> {
      try {
        const job = await api().requestRegionExtract(regionId)
        this.trackRegion(regionId, name, job)
        return job
      } catch (e) {
        this.createError = e instanceof Error ? e.message : 'failed to request extract'
        return null
      }
    },

    async createExport(area: ExportArea, maxzoom: number, name?: string): Promise<JobView | null> {
      this.creating = true
      this.createError = null
      try {
        const job = await api().createExport(area, maxzoom, name)
        this.track(job)
        return job
      } catch (e) {
        this.createError = e instanceof Error ? e.message : 'failed to create export'
        return null
      } finally {
        this.creating = false
      }
    },

    async remove(id: string) {
      try {
        await api().deleteExport(id)
      } catch (e) {
        if (!(e instanceof ApiRequestError && e.status === 404)) return
      }
      this.untrack(id)
    },

    async refreshActive() {
      const custom = Object.values(this.jobs).filter(isActive)
      const regions = Object.entries(this.regionJobs).filter(([, job]) => isActive(job))
      await Promise.all([
        ...custom.map(async (job) => {
          try {
            const next = await api().getExport(job.id)
            this.jobs[job.id] = next
            this.notify({ key: job.id, kind: 'custom', title: next.name ?? next.id, job: next }, job.status)
          } catch {
            // transient poll failure, try again next tick
          }
        }),
        ...regions.map(async ([id, job]) => {
          try {
            const next = (await api().regionDetail(id)).extract
            if (!next) return
            this.regionJobs[id] = next
            this.notify(
              { key: `region:${id}`, kind: 'region', title: this.regionNames[id] ?? id, job: next },
              job.status,
            )
          } catch {
            // transient poll failure, try again next tick
          }
        }),
      ])
    },

    notify(entry: DownloadEntry, previous: JobStatus) {
      if (entry.job.status === previous) return
      statusListener?.(entry, previous)
    },

    ensurePolling() {
      if (this.pollHandle !== null) return
      const tick = async () => {
        await this.refreshActive()
        if (this.hasActive) {
          this.pollHandle = window.setTimeout(tick, POLL_MS)
        } else {
          this.pollHandle = null
        }
      }
      if (this.hasActive) {
        this.pollHandle = window.setTimeout(tick, POLL_MS)
      }
    },
  },
})
