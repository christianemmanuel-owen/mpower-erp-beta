// Approval-based inputs and staff input history - the client half of Secondary
// Features 2.1 and 2.2.
//
// The design point worth repeating here, because it is what keeps the rest of
// the app untouched: a pending input is NOT a record with status 'pending'. It
// is parked server-side in `approvals` and only becomes a record on approval.
// So no read path in the app - stock, receivables, quota, payroll commission -
// needs to know this feature exists. Screens only need to handle the 202
// response (see isPending below) instead of assuming they got a record back.

import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './api'
import { queryClient } from './queryClient'
import { notificationsKey } from './notifications'
import { tableKey, type TableName } from './data'

export type ApprovalAction = 'create' | 'update' | 'delete'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ApprovalRequest {
  id: string
  tbl: string
  recordId: string
  action: ApprovalAction
  status: ApprovalStatus
  payload: Record<string, unknown>
  summary: string | null
  requestedBy: string
  requestedByName: string
  requestedAt: string
  decidedBy: string | null
  decidedByName: string | null
  decidedAt: string | null
  decisionNote: string | null
}

/** What the API returns instead of a record when a write was parked (HTTP 202). */
export interface PendingResult {
  pending: true
  approvalId: string
  summary: string
  message: string
}

/** Narrows a write's result. Any screen whose table can require approval must
 * check this before treating the response as a saved record - otherwise it will
 * show "saved" for something that has not been saved.
 *
 *   const res = await repos.purchases.add(fields)
 *   if (isPending(res)) { toast(res.message); return }
 */
export function isPending(result: unknown): result is PendingResult {
  return Boolean(result) && (result as PendingResult).pending === true
}

// ---- rules (2.1 configuration) ----------------------------------------------

export interface ApprovalRules {
  tables: string[]
  /** Only require approval above this order value. 0 = always require it.
   * Honoured server-side already; nothing sets it yet - there is no threshold in
   * Exhibit A and guessing one would be worse than leaving it open. */
  minAmount?: number
}

export interface RulesResponse {
  rules: ApprovalRules
  /** Tables that may sensibly be put under approval. */
  approvable: string[]
  /** What a database with no settings record gets. */
  defaults: string[]
}

/** Friendly names for the tables an administrator can put under approval. */
export const TABLE_LABELS: Record<string, string> = {
  purchases: 'Purchases (stock in)',
  sales: 'Sales orders',
  deliveries: 'Trips and deliveries',
  customers: 'Customer accounts',
  suppliers: 'Suppliers',
  personnel: 'Employees',
  trucks: 'Vehicles',
  supplierQuotes: 'Supplier price quotes',
  payrollRuns: 'Payroll runs',
}

export const rulesKey = ['approvalRules'] as const

export function useApprovalRules() {
  return useQuery({
    queryKey: rulesKey,
    queryFn: () => api<RulesResponse>('/approvals/rules'),
  })
}

export function useSaveApprovalRules() {
  return useMutation({
    mutationFn: (rules: ApprovalRules) =>
      api<{ rules: ApprovalRules }>('/approvals/rules', { method: 'PUT', body: rules }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rulesKey }),
  })
}

export const approvalsKey = (status: ApprovalStatus, mine: boolean) =>
  ['approvals', status, mine] as const

export function useApprovals(status: ApprovalStatus = 'pending', mine = false) {
  return useQuery({
    queryKey: approvalsKey(status, mine),
    queryFn: () =>
      api<{ rows: ApprovalRequest[]; pendingCount: number }>(
        `/approvals?status=${status}${mine ? '&mine=1' : ''}`,
      ),
    refetchInterval: 20_000,
  })
}

function invalidateAfterDecision(tbl: string) {
  queryClient.invalidateQueries({ queryKey: ['approvals'] })
  queryClient.invalidateQueries({ queryKey: notificationsKey })
  // An approval posts a real record, so the table it landed in is now stale.
  queryClient.invalidateQueries({ queryKey: tableKey(tbl as TableName) })
}

export function useDecideApproval() {
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string; tbl: string }) =>
      api<{ ok: true; status: ApprovalStatus }>(`/approvals/${id}/${decision}`, {
        method: 'POST',
        body: { note },
      }),
    onSuccess: (_res, vars) => invalidateAfterDecision(vars.tbl),
  })
}

/**
 * Change a parked submission before deciding on it (approver only).
 *
 * Sends only the fields that were edited; the server merges them over what was
 * parked, so a drawer that never loaded a field cannot blank it.
 */
export function useAmendApproval() {
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown>; tbl: string }) =>
      api<{ ok: true; row: ApprovalRequest }>(`/approvals/${id}`, { method: 'PATCH', body: { payload } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approvals'] }),
  })
}

/** Withdraw your own pending request. */
export function useWithdrawApproval() {
  return useMutation({
    mutationFn: (id: string) => api(`/approvals/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approvals'] }),
  })
}

// ---- Staff input history (2.2) ----------------------------------------------

export interface AuditRow {
  id: number
  at: string
  seatId: string
  seatName: string
  action: string
  tbl: string
  recordId: string
  summary: string | null
  /** { field: [before, after] } - present on edits only. */
  changes: Record<string, [unknown, unknown]> | null
}

export interface AuditFilter {
  seat?: string
  tbl?: string
  record?: string
  action?: string
  since?: string
  until?: string
  limit?: number
  offset?: number
}

export function useAudit(filter: AuditFilter = {}) {
  const qs = new URLSearchParams(
    Object.entries(filter).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
  ).toString()
  return useQuery({
    queryKey: ['audit', qs],
    queryFn: () => api<{ rows: AuditRow[]; limit: number; offset: number }>(`/audit${qs ? `?${qs}` : ''}`),
  })
}

/** One record's full history - for an "activity" panel on a detail screen. */
export function useRecordHistory(tbl: string, recordId: string | undefined) {
  return useAudit(recordId ? { tbl, record: recordId, limit: 50 } : {})
}

export const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  delete: 'Deleted',
  submit: 'Sent for approval',
  amend: 'Changed before approval',
  approve: 'Approved',
  reject: 'Rejected',
  upload: 'Uploaded a document',
  remove_file: 'Removed a document',
  login: 'Signed in',
}
