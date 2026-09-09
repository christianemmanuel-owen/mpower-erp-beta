import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Click-through from the Dashboard to a specific record - Exhibit A 1.1, "all
 * dashboard contents link through to the corresponding module record on click".
 *
 * The dashboard used to link to module *index* pages: clicking a sale took you
 * to Sales and left you to find the row yourself. On a busy day that is a
 * filter-and-scan exercise, which is exactly the work the dashboard exists to
 * save.
 *
 * The mechanism is a query parameter rather than a route segment, deliberately.
 * Every module is one screen with drawers over it; `/sales?record=abc` opens
 * Sales and pops the drawer for `abc`, and stripping the parameter leaves a URL
 * that still works. A `/sales/abc` route would imply a page that does not exist
 * and would need a not-found state for a deleted record.
 *
 * The parameter is consumed once and cleared from the URL, so a refresh does not
 * re-open a drawer the user has closed, and the back button behaves.
 */

export const RECORD_PARAM = 'record'

/** Which module screen owns each table. */
const MODULE_PATH: Record<string, string> = {
  purchases: '/inventory',
  sales: '/sales',
  deliveries: '/logistics',
  customers: '/accounts',
  suppliers: '/accounts',
  // These three used to all say '/hr', which opened the attendance grid - so a
  // click on an employee, a drug test or a payroll run landed on a screen that
  // does not show any of them. HR has subpages now, so they can be specific.
  personnel: '/hr/employees',
  drugTests: '/hr/drug-tests',
  payrollRuns: '/hr/payroll',
}

/** The href for a record, or null when its table has no screen to open. */
export function recordHref(tbl: string, id: string): string | null {
  const path = MODULE_PATH[tbl]
  return path ? `${path}?${RECORD_PARAM}=${encodeURIComponent(id)}` : null
}

/**
 * The record id a dashboard click asked this module to open, and a way to say it
 * has been handled.
 *
 * Deliberately NOT a callback hook. Modules fetch their data asynchronously and
 * return early while it loads, so a hook that invoked a callback on mount would
 * fire against an empty list and the link would silently do nothing - the exact
 * failure a first-time click is most likely to hit, since that is when nothing
 * is cached.
 *
 * Holding the id in state instead lets a module act on it in its render body
 * once the data has actually arrived:
 *
 *     const [pending, clearPending] = usePendingRecord()
 *     ...
 *     if (!data) return null
 *     if (pending) {
 *       const found = data.sales.find((s) => s.id === pending)
 *       clearPending()
 *       if (found) { setEditing(found); setFormOpen(true) }
 *     }
 *
 * Clearing unconditionally matters: a record that has been deleted since the
 * dashboard rendered must not leave a pending id retrying on every render.
 * Landing on the list is the right outcome there - an error page for a record
 * someone legitimately deleted explains nothing.
 *
 * The URL parameter is stripped as soon as it is read, so a refresh does not
 * re-open a drawer the user closed and Back leaves the module rather than
 * re-triggering.
 */
export function usePendingRecord(): [string | null, () => void] {
  const location = useLocation()
  const navigate = useNavigate()
  const param = new URLSearchParams(location.search).get(RECORD_PARAM)
  const [pending, setPending] = useState<string | null>(param)

  useEffect(() => {
    if (!param) return
    setPending(param)
    navigate(location.pathname, { replace: true })
    // `navigate` and `location.pathname` are stable for a given route; the
    // parameter is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param])

  return [pending, () => setPending(null)]
}
