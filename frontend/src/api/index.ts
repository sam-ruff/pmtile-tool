import { HttpPmtilesApi } from './HttpPmtilesApi'
import { MockPmtilesApi } from './MockPmtilesApi'
import type { PmtilesApi } from './PmtilesApi'

export const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true'

let instance: PmtilesApi | undefined

export function api(): PmtilesApi {
  if (!instance) {
    instance = useMockApi ? new MockPmtilesApi() : new HttpPmtilesApi()
  }
  return instance
}

export * from './types'
export type { PmtilesApi } from './PmtilesApi'
