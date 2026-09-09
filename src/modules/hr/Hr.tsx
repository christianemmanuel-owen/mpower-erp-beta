import { useAuth } from '../../lib/auth'
import { PageHeader } from '../../components/ui'
import { RangePicker } from '../../lib/range'
import AttendanceTab from './AttendanceTab'
import LeavesTab from './LeavesTab'
import PayrollTab from './PayrollTab'
import EmployeesTab from './EmployeesTab'
import SetupTab from './SetupTab'
import KpiTab from './KpiTab'
import DrugTestsTab from './DrugTestsTab'

export type HrPage = 'attendance' | 'leaves' | 'payroll' | 'employees' | 'kpi' | 'drugTests' | 'setup'

const PAGE_TITLES: Record<HrPage, string> = {
  attendance: 'Attendance',
  leaves: 'Leaves',
  payroll: 'Payroll',
  employees: 'Employees',
  kpi: 'Performance',
  drugTests: 'Drug tests',
  setup: 'HR setup',
}

/** Pages whose figures are scoped by the global date range, so the picker belongs
 * in the header beside the title rather than buried in one card.
 *
 * Attendance is not one of them any more: half of it is about a single day, and
 * a range picker sitting over a day's grid governed nothing you could see. It
 * now travels with the period view, next to the figures it scopes. */
const RANGED: HrPage[] = ['kpi']

/**
 * HR was the last module still using a tab strip. Its screens are different record
 * types - a day's time records, a leave ledger, payroll runs, the employee roster -
 * so by the same rule applied to Collections and Accounts they are subpages, each
 * with its own URL.
 *
 * That also un-buries two finished features. KPI and Drug tests were rendered here
 * but never listed in the tab array, so nothing in the app could reach either of
 * them, and a deep link to a drug-test record landed on Attendance. Both are marked
 * shipped in the gap analysis.
 */
export default function Hr({ page = 'attendance' }: { page?: HrPage }) {
  const { seat } = useAuth()

  return (
    <>
      <PageHeader
        title={PAGE_TITLES[page]}
        right={RANGED.includes(page) ? <RangePicker /> : undefined}
      />

      {page === 'attendance' && <AttendanceTab />}
      {page === 'leaves' && <LeavesTab />}
      {page === 'payroll' && <PayrollTab />}
      {page === 'employees' && <EmployeesTab />}
      {page === 'kpi' && <KpiTab />}
      {page === 'drugTests' && <DrugTestsTab />}
      {page === 'setup' && seat?.isAdmin && <SetupTab />}
    </>
  )
}
