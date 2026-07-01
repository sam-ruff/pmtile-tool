import { defineStore } from 'pinia'
import { api } from '../api'
import { ApiRequestError } from '../api'
import type { GeoJSONGeometry, JobView } from '../api'

const STORAGE_KEY = 'pmtile-tool:job-ids'
const POLL_MS = 2000

function loadIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function saveIds(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // storage unavailable (private browsing); jobs just will not persist
  }
}

interface JobsState {
  ids: string[]
  jobs: Record<string, JobView>
  createError: string | null
  creating: boolean
  previewId: string | null
  pollHandle: number | null
}

export const useJobsStore = defineStore('jobs', {
  state: (): JobsState => ({
    ids: loadIds(),
    jobs: {},
    createError: null,
    creating: false,
    previewId: null,
    pollHandle: null,
  }),

  getters: {
    ordered(state): JobView[] {
      return state.ids
        .map((id) => state.jobs[id])
        .filter((j): j is JobView => Boolean(j))
    },
    hasActive(state): boolean {
      return Object.values(state.jobs).some(
        (j) => j.status === 'queued' || j.status === 'running',
      )
    },
    activeCount(state): number {
      return Object.values(state.jobs).filter(
        (j) => j.status === 'queued' || j.status === 'running',
      ).length
    },
  },

  actions: {
    async load() {
      await Promise.all(
        this.ids.map(async (id) => {
          try {
            this.jobs[id] = await api().getExport(id)
          } catch (e) {
            if (e instanceof ApiRequestError && e.status === 404) {
              this.untrack(id)
            }
          }
        }),
      )
      this.ensurePolling()
    },

    track(job: JobView) {
      this.jobs[job.id] = job
      if (!this.ids.includes(job.id)) {
        this.ids = [job.id, ...this.ids]
        saveIds(this.ids)
      }
      this.ensurePolling()
    },

    untrack(id: string) {
      this.ids = this.ids.filter((v) => v !== id)
      delete this.jobs[id]
      if (this.previewId === id) this.previewId = null
      saveIds(this.ids)
    },

    async createExport(
      geometry: GeoJSONGeometry,
      maxzoom: number,
      name?: string,
    ): Promise<JobView | null> {
      this.creating = true
      this.createError = null
      try {
        const job = await api().createExport(geometry, maxzoom, name)
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
        if (!(e instanceof ApiRequestError && e.status === 404)) {
          return
        }
      }
      this.untrack(id)
    },

    async refreshActive() {
      const active = Object.values(this.jobs).filter(
        (j) => j.status === 'queued' || j.status === 'running',
      )
      await Promise.all(
        active.map(async (job) => {
          try {
            this.jobs[job.id] = await api().getExport(job.id)
          } catch {
            // transient poll failure, try again next tick
          }
        }),
      )
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
