// One-time migration: earlier versions of this app kept everything in a local
// IndexedDB ("diesel-erp", via Dexie). This reads that database raw - no Dexie
// dependency - so an admin can publish it into the shared D1 database.

const LEGACY_DB = 'diesel-erp'
const TABLES = new Set([
  'suppliers', 'warehouses', 'agents', 'customers', 'bankAccounts', 'personnel',
  'trucks', 'purchases', 'sales', 'deliveries', 'supplierQuotes', 'seats',
])

async function openIfExists(): Promise<IDBDatabase | null> {
  // Don't create an empty DB just by probing for one.
  if (typeof indexedDB === 'undefined') return null
  if ('databases' in indexedDB) {
    try {
      const dbs = await indexedDB.databases()
      if (!dbs.some((d) => d.name === LEGACY_DB)) return null
    } catch {
      /* fall through to open() */
    }
  }
  return new Promise((resolve) => {
    const req = indexedDB.open(LEGACY_DB)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

/** All business records from the old local database, keyed by table name -
 * or null if there's nothing to migrate from this browser. */
export async function readLegacyLocalData(): Promise<Record<string, unknown[]> | null> {
  const idb = await openIfExists()
  if (!idb) return null
  try {
    const names = [...idb.objectStoreNames].filter((n) => TABLES.has(n))
    const out: Record<string, unknown[]> = {}
    for (const name of names) {
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const req = idb.transaction(name, 'readonly').objectStore(name).getAll()
        req.onsuccess = () => resolve(req.result as unknown[])
        req.onerror = () => reject(req.error)
      })
      if (rows.length > 0) out[name] = rows
    }
    const total = Object.values(out).reduce((sum, rows) => sum + rows.length, 0)
    return total > 0 ? out : null
  } catch {
    return null
  } finally {
    idb.close()
  }
}

export function countRecords(tables: Record<string, unknown[]>): number {
  return Object.values(tables).reduce((sum, rows) => sum + rows.length, 0)
}
