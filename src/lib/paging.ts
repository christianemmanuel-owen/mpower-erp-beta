import { useEffect, useState } from 'react'

/**
 * Page state and the current slice.
 *
 * Lifted out of DataTable because not everything that needs paging is a table -
 * the leave balances panel is a list of cards. Writing it a second time is how
 * two pagers end up disagreeing about what "page 1" holds after a filter change.
 */
export function usePaged<T>(items: T[], pageSize?: number, resetKey?: string | number) {
  const [page, setPage] = useState(1)
  useEffect(() => {
    setPage(1)
  }, [resetKey])
  const totalPages = pageSize ? Math.max(1, Math.ceil(items.length / pageSize)) : 1
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const pageItems = pageSize ? items.slice((safePage - 1) * pageSize, safePage * pageSize) : items
  return { pageItems, page: safePage, totalPages, setPage, total: items.length, pageSize }
}
