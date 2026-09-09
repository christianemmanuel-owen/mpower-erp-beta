import { useState } from 'react'

export type SortDir = 'desc' | 'asc'
export interface SortState {
  key: string
  dir: SortDir
}

/**
 * Header-click sort cycle for tables: first click sorts highest → lowest,
 * second click reverses to lowest → highest, third click clears back to the
 * table's default order.
 */
export function useSortableTable() {
  const [sort, setSort] = useState<SortState | null>(null)
  const toggle = (key: string) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'desc' }
      if (s.dir === 'desc') return { key, dir: 'asc' }
      return null
    })
  }
  return { sort, toggle }
}

/** Compares two sortable cell values (numbers or strings), honoring direction. */
export function compareValues(a: string | number, b: string | number, dir: SortDir) {
  const r = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
  return dir === 'desc' ? -r : r
}
