import { useTable } from './data'
import { repos } from '../data/repo'
import { DEFAULT_HR_CONFIG, mergeHrConfig } from '../data/statutory'
import type { HrConfig, HrSettingsRecord } from '../data/types'

/** The live HR configuration - one hrSettings record merged over the official
 * defaults, so a fresh installation (no record yet) works out of the box and new
 * config fields never break old records. `loaded` is false while fetching. */
export function useHrConfig(): { config: HrConfig; record: HrSettingsRecord | undefined; loaded: boolean } {
  const rows = useTable('hrSettings')
  const record = rows?.[0]
  return { config: mergeHrConfig(record?.config), record, loaded: rows !== undefined }
}

/** Persists a config change (admin-only server-side), creating the record on first save. */
export async function saveHrConfig(record: HrSettingsRecord | undefined, patch: Partial<HrConfig>): Promise<void> {
  if (record) {
    await repos.hrSettings.update(record.id, { config: { ...mergeHrConfig(record.config), ...patch } })
  } else {
    await repos.hrSettings.add({ config: { ...DEFAULT_HR_CONFIG, ...patch } })
  }
}
