import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { InlineNotice } from '../../components/Notice'
import { Check, Settings as SettingsIcon, X } from 'lucide-react'
import ApprovalDrawer from './ApprovalDrawer'
import { Card, DataTable, Dialog, Field, GhostButton, InfoTip, Input, MiniDark, PageHeader, PrimaryButton, td } from '../../components/ui'
import { fmtDate } from '../../lib/format'
import { departmentFor, submissionTitle } from '../../lib/approvalFields'
import { useAuth } from '../../lib/auth'
import {
  TABLE_LABELS, useApprovalRules, useApprovals, useDecideApproval, useSaveApprovalRules,
  useWithdrawApproval, type ApprovalRequest, type ApprovalStatus,
} from '../../lib/approvals'

/**
 * Pending inputs queue - Secondary Feature 2.1.
 *
 * "Staff-entered records ... enter a pending state and require an
 * administrator's approval before being confirmed and posted to the System."
 *
 * Nothing in this queue has been posted. Approving applies the parked write;
 * rejecting discards it. Either way the person who submitted it gets a
 * notification (2.11).
 */
export default function Approvals() {
  const { seat } = useAuth()
  const mayApprove = Boolean(seat?.isAdmin || seat?.canApprove)
  const [tab, setTab] = useState<ApprovalStatus>('pending')
  const { data, isLoading } = useApprovals(tab, !mayApprove)

  const rows = data?.rows ?? []

  return (
    <div className="p-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-[6px]">
            Approvals
            <InfoTip label="What a parked input means">
              {mayApprove
                ? 'Nothing here counts towards stock, sales or receivables until it is approved.'
                : 'Inputs you have sent for approval. They post to the System once an administrator approves them.'}
            </InfoTip>
          </span>
        }
        right={
          <div className="flex items-center gap-1">
            {(['pending', 'approved', 'rejected'] as ApprovalStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTab(s)}
                className={`cursor-pointer rounded-[8px] px-3 py-[6px] text-[12px] font-semibold capitalize ${
                  tab === s ? 'bg-inkcard text-white' : 'bg-fill2 text-lab hover:bg-inputline'
                }`}
              >
                {s}
              </button>
            ))}
            {seat?.isAdmin && <RulesButton />}
          </div>
        }
      />

      <Card className="mt-3">
        {isLoading ? (
          <p className="p-6 text-[13px] text-faint">Loading…</p>
        ) : (
          <DataTable
            cols={[
              { label: 'Date' },
              { label: 'Department' },
              // Not 'Sale': the queue carries purchases, trips and customer
              // records too, and the column holds what the submission is called
              // rather than what kind of thing it is - Department says that.
              { label: 'Title' },
              { label: 'Details' },
              { label: 'Staff' },
              { label: 'Review' },
              { label: 'Action', align: 'right' },
            ]}
            empty={
              tab === 'pending'
                ? 'Nothing is waiting for approval.'
                : `No ${tab} inputs yet.`
            }
          >
            {rows.map((r) => (
              <Row key={r.id} row={r} mayApprove={mayApprove} mine={r.requestedBy === seat?.id} tab={tab} />
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  )
}

/**
 * Which record types need approval - the Q9 answer, made configurable rather
 * than hard-coded.
 *
 * Exhibit A names purchase orders and client sales "for example", so the list
 * was always going to grow. Keeping it in a settings record means adding
 * "Trips" or "Customer accounts" later is a tick-box here, not a redeploy.
 */
function RulesButton() {
  const { data, isLoading } = useApprovalRules()
  const save = useSaveApprovalRules()
  const [open, setOpen] = useState(false)

  if (isLoading || !data) return null
  const selected = new Set(data.rules.tables)

  function toggle(tbl: string) {
    const next = new Set(selected)
    if (next.has(tbl)) next.delete(tbl)
    else next.add(tbl)
    save.mutate({ tables: [...next], minAmount: data?.rules.minAmount ?? 0 })
  }

  const summary = data.rules.tables.length
    ? data.rules.tables.map((t) => TABLE_LABELS[t] ?? t).join(', ')
    : 'Nothing - every input posts straight to the System.'

  return (
    <>
      {/* This was a full-width bar above the queue, permanently restating a
          setting that changes about once. The queue is what the page is for;
          the rule behind it is a setting, so it gets a settings control and
          stays out of the way until someone wants it. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="What needs approval"
        aria-label="What needs approval"
        className="ml-1 flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-inputline bg-white text-mut transition-colors hover:border-linesoft hover:bg-fill2 hover:text-ink"
      >
        <SettingsIcon size={14} strokeWidth={1.8} />
      </button>

      <Dialog
        open={open}
        title="What needs approval"
        subtitle={summary}
        onClose={() => setOpen(false)}
        width={520}
        footer={<GhostButton onClick={() => setOpen(false)}>Done</GhostButton>}
      >
        <div className="grid grid-cols-2 gap-2">
          {data.approvable.map((tbl) => (
            <label key={tbl} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-[6px] text-[13px] hover:bg-fill2">
              <input
                type="checkbox"
                checked={selected.has(tbl)}
                onChange={() => toggle(tbl)}
                className="cursor-pointer accent-teal"
              />
              <span className="text-lab">{TABLE_LABELS[tbl] ?? tbl}</span>
            </label>
          ))}
        </div>
        {/* Each tick saves on its own, so there is nothing to submit - but that
            is invisible unless it is said. */}
        <p className="m-0 mt-3 font-meta text-[12px] text-faint">
          Saved as you tick. Records already waiting are unaffected.
        </p>
      </Dialog>
    </>
  )
}

function Row({ row, mayApprove, mine, tab }: {
  row: ApprovalRequest
  mayApprove: boolean
  mine: boolean
  tab: ApprovalStatus
}) {
  const decide = useDecideApproval()
  const withdraw = useWithdrawApproval()
  const [open, setOpen] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  // A seat that may approve still cannot wave through its own input unless it is
  // an admin - that is the entire point of the feature.
  const canDecideThis = mayApprove && tab === 'pending'

  // The figures, without the "New sale -" the server prefixes them with; the
  // Sale column says that part.
  const details = row.summary?.split(' - ').slice(1).join(' - ') || '—'

  return (
    <tr>
      <td className={`${td} whitespace-nowrap text-mut`}>{fmtDate(row.requestedAt)}</td>

      <td className={`${td} whitespace-nowrap text-mut`}>{departmentFor(row.tbl)}</td>

      <td className={`${td} whitespace-nowrap font-semibold text-lab`}>
        {submissionTitle(row.action, row.tbl)}
      </td>

      <td className={td}>
        {details}
        {row.decisionNote && <span className="block text-[12px] text-faint">“{row.decisionNote}”</span>}
        {tab !== 'pending' && row.decidedByName && (
          <span className="block font-meta text-[12px] text-faint">
            {tab === 'approved' ? 'Approved' : 'Rejected'} by {row.decidedByName}
            {row.decidedAt ? ` · ${fmtDate(row.decidedAt)}` : ''}
          </span>
        )}
      </td>

      <td className={`${td} whitespace-nowrap text-mut`}>{row.requestedByName}</td>

      <td className={td}>
        {/* The whole submission, which is the only way to decide on one
            honestly - the columns beside this name four fields out of fifteen.
            Notes on a decision are taken in there too, which is why the quick
            actions on the right no longer carry an input of their own. */}
        <MiniDark onClick={() => setOpen(true)} title="Open the full submission">Review</MiniDark>
        {open && (
          <ApprovalDrawer row={row} canDecide={canDecideThis} onClose={() => setOpen(false)} />
        )}
        {/* Approving needs no explanation; rejecting does. The row's ✕ asks for
            one rather than discarding someone's work on a single click - and
            the reason reaches the submitter with the decision, which is the
            difference between "not approved" and something they can act on. */}
        <Dialog
          open={rejecting}
          title="Reject this input"
          subtitle={`${submissionTitle(row.action, row.tbl)} · ${row.requestedByName}`}
          onClose={() => { setRejecting(false); setNote('') }}
          width={480}
          footer={
            <>
              <GhostButton onClick={() => { setRejecting(false); setNote('') }}>Cancel</GhostButton>
              <PrimaryButton
                onClick={() => {
                  decide.mutate({ id: row.id, decision: 'reject', note, tbl: row.tbl })
                  setRejecting(false)
                  setNote('')
                }}
              >
                Reject
              </PrimaryButton>
            </>
          }
        >
          <Field label="Reason" hint="Optional. This is the only explanation the submitter receives.">
            <Input
              value={note}
              placeholder="Incorrect depot, price does not match the quote…"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </Dialog>
      </td>

      <td className={`${td} text-right`}>
        {canDecideThis ? (
          <span className="flex items-center justify-end gap-[6px]">
            <button
              type="button"
              title="Reject"
              aria-label="Reject"
              onClick={() => setRejecting(true)}
              className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border border-inputline bg-white text-mut transition-colors hover:border-redf hover:text-redtext"
            >
              <X size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              title="Approve"
              aria-label="Approve"
              onClick={() => decide.mutate({ id: row.id, decision: 'approve', tbl: row.tbl })}
              className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border border-ink bg-ink text-white transition-colors hover:bg-inkhov"
            >
              <Check size={14} strokeWidth={2} />
            </button>
          </span>
        ) : tab !== 'pending' ? (
          <span
            title={tab === 'approved' ? 'Approved' : 'Rejected'}
            className={`inline-flex h-[26px] w-[26px] items-center justify-center ${tab === 'approved' ? 'text-sec' : 'text-redtext'}`}
          >
            {tab === 'approved' ? <Check size={14} strokeWidth={2} /> : <X size={14} strokeWidth={2} />}
          </span>
        ) : mine ? (
          <GhostButton onClick={() => withdraw.mutate(row.id)}>Withdraw</GhostButton>
        ) : (
          <span className="text-[12px] text-faint">Waiting</span>
        )}
      </td>
    </tr>
  )
}

/** Small banner for a module screen, so staff see their own parked inputs where
 * they work rather than only in this queue. */
export function PendingBanner({ tbl }: { tbl: string }) {
  const navigate = useNavigate()
  const { data } = useApprovals('pending', true)
  const mine = (data?.rows ?? []).filter((r) => r.tbl === tbl)
  if (!mine.length) return null
  return (
    // One line, in the app's own colours. This was a two-line amber card at the
    // top of seven screens, drawn in raw Tailwind ambers that appear nowhere
    // else in the System - a band of the page, every visit, to report a number.
    // Nothing here is wrong, so nothing here is red: an input waiting for an
    // approver is the feature working.
    <InlineNotice className="mb-3" action="Open" onAction={() => navigate('/settings/approvals')}>
      {mine.length} {mine.length === 1 ? 'input is' : 'inputs are'} waiting for an administrator,
      and {mine.length === 1 ? 'is' : 'are'} not yet reflected in the figures
    </InlineNotice>
  )
}
