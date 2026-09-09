import { Chip, Dialog, FormSection, GhostButton, InfoTip, PrimaryButton } from '../../components/ui'
import { RailAside, RailClose, RailRow, RailSection } from '../../components/SummaryRail'
import { fmtCompactPeso, fmtCurrency, fmtDate, fmtLiters, fmtTerm, label } from '../../lib/format'
import { isInstallmentOverdue, type CustomerStat } from '../../lib/metrics'
import { accountActivity, creditScore } from '../../lib/credit'
import { ACCOUNT_OPENING_SLOTS, slotLabel, useAttachments } from '../../lib/attachments'
import type { ContactPoint, Sale } from '../../data/types'

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

/** A sale's payment badge summarized across its installments - collapses to a single status
 * when they all agree, otherwise "x/y collected" so a partial settlement isn't flattened
 * into one misleading chip. */
function installmentBadge(installments: Sale['installments']) {
  const total = installments.length
  const collected = installments.filter((i) => i.status === 'collected').length
  const allCancelled = total > 0 && installments.every((i) => i.status === 'cancelled')
  const allCollected = total > 0 && collected === total
  const statusKey = allCancelled ? 'cancelled' : allCollected ? 'collected' : 'pending'
  const text = total > 1 && !allCancelled && !allCollected ? `${collected}/${total} collected` : label(statusKey)
  return { statusKey, text, anyOverdue: installments.some((i) => isInstallmentOverdue(i)) }
}

/** One of the three contact points. An unrecorded one still gets its card - a
 * missing card would read as "this account has no delivery address" rather than
 * "nobody has written it down". */
function ContactCard({ title, point }: { title: string; point?: ContactPoint }) {
  const lines = [
    point?.address,
    [point?.contactPerson, point?.designation].filter(Boolean).join(' - '),
    point?.contactNumber,
    point?.email,
  ].filter((l) => l && l.trim() !== '')
  return (
    <div className="min-w-0 rounded-[6px] border border-linesoft px-3 py-[9px]">
      <p className="m-0 mb-[3px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">{title}</p>
      {lines.length > 0
        ? lines.map((l, i) => <p key={i} className="m-0 break-words text-[13px] leading-[1.45]">{l}</p>)
        : <p className="m-0 text-[13px] text-faint">Not recorded</p>}
    </div>
  )
}

/**
 * One attribute.
 *
 * An unset field renders as "Not recorded" rather than disappearing. Half the
 * fields Exhibit A asks for are unset on most accounts here, and hiding them
 * meant the drawer quietly shortened itself - you could not tell whether the
 * System had no field for a lead source or simply had no value in it.
 *
 * Neither side is `shrink-0`. They were, which is what let a long label and a
 * long value push the two-column grid wider than the dialog and leave the whole
 * thing scrolling sideways.
 */
function Row({ label: l, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === '' || value === '—'
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-linesoft py-[7px] text-[13px] last:border-b-0">
      <span className="min-w-0 font-meta text-[12px] text-mut">{l}</span>
      <span className="tnum min-w-0 break-words text-right font-semibold">
        {empty ? <span className="font-normal text-faint">Not recorded</span> : value}
      </span>
    </div>
  )
}

/** A period figure, big enough to be read at a glance rather than looked up. */
function Tile({ label: l, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[6px] border border-linesoft px-3 py-[9px]">
      <p className="m-0 font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">{l}</p>
      <p className="tnum m-0 mt-[3px] text-[18px] font-semibold leading-[1.15]">{value}</p>
    </div>
  )
}

export default function CustomerDetail({ stat, sales, onClose, onEdit, inRangeFn }: {
  stat: CustomerStat | null
  sales: Sale[]
  onClose: () => void
  onEdit?: () => void
  /** Whether a sale date falls in the screen's selected interval - account
   * activity is an interval figure per Exhibit A 1.4. */
  inRangeFn?: (isoDate: string) => boolean
}) {
  // Hooks must run on every render, so this cannot sit behind the null guard.
  const docs = useAttachments('customers', stat?.customer.id)

  if (!stat) return <Dialog open={false} title="" onClose={onClose}><span /></Dialog>
  const c = stat.customer
  const recent = sales
    .filter((s) => s.customerId === c.id && s.status !== 'draft')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)

  const activity = accountActivity(c.id, sales, inRangeFn ?? (() => true))
  const score = creditScore(c, stat.history)
  const filed = new Set((docs.data ?? []).map((d) => d.slot))
  const missing = ACCOUNT_OPENING_SLOTS.filter((slot) => !filed.has(slot))

  return (
    <Dialog
      open
      title={c.company}
      // The brand, the tenure and the terms are what identify the account; they
      // were a grey sentence under a chip, at the same size as everything else
      // on the screen.
      subtitle={[
        c.brand,
        stat.yearsWith !== null ? `${Math.max(Math.round(stat.yearsWith), 1)} years with us` : 'New account',
        fmtTerm(c.paymentTermDays),
      ].filter(Boolean).join(' · ')}
      aside={stat.rating ? <Chip status={stat.rating} text={`Credit: ${stat.rating}`} /> : undefined}
      onClose={onClose}
      width={1000}
      /**
       * How the account stands, beside what it has done.
       *
       * Credit history used to be the sixth block down a scroll, in the same
       * type as the lead source - so the two questions anyone opens an account
       * to ask (are they good for it, do they owe us anything now) were the
       * hardest things on the screen to find. They stay in view here while the
       * detail scrolls.
       */
      rail={
        <>
          <RailSection title="Credit standing">
            <RailRow label="Punctuality of payment" value={pct(stat.history.punctuality)} />
            <RailRow label="Ease of collection" value={pct(stat.history.ease)} />
            <RailRow
              label="Average days late"
              value={stat.history.avgDaysLate !== null ? `${stat.history.avgDaysLate} days` : 'Never late'}
            />
            <RailRow label="Payments settled" value={stat.history.settled} />
            <RailRow label="Bounced payments" value={stat.history.bounced || 'None'} />
            <RailClose
              label="Credit score"
              value={score.value !== null ? score.value : 'Not set'}
            />
            <span className="mt-[6px] flex items-center gap-[6px]">
              <span className="font-meta text-[12px] text-faint">Set by hand</span>
              <InfoTip label="How the credit score is derived">{score.explanation}</InfoTip>
            </span>
          </RailSection>

          <RailSection title="Owed now">
            {stat.overdueCount > 0 ? (
              <>
                <RailRow label="Overdue installments" value={stat.overdueCount} />
                <RailClose label="Overdue amount" tone="bad" value={fmtCompactPeso(stat.overdueAmount)} />
              </>
            ) : (
              <RailAside>Nothing overdue.</RailAside>
            )}
          </RailSection>

          <RailSection title="Account opening documents">
            <RailRow
              label="On file"
              value={`${ACCOUNT_OPENING_SLOTS.length - missing.length} of ${ACCOUNT_OPENING_SLOTS.length}`}
            />
            {missing.length > 0
              ? <RailAside>Still to file: {missing.map(slotLabel).join(', ')}. Add them from Edit account.</RailAside>
              : <RailAside>Complete.</RailAside>}
          </RailSection>
        </>
      }
      footer={
        <>
          <GhostButton onClick={onClose}>Close</GhostButton>
          {onEdit && <PrimaryButton onClick={onEdit}>Edit account</PrimaryButton>}
        </>
      }
    >
      <span className="flex items-center gap-[6px]">
        <FormSection first>Activity this period</FormSection>
        <InfoTip label="How inquiries are counted">
          Inquiries are counted as draft orders. The System has no separate enquiry record, so this
          undercounts anything answered verbally and never keyed in.
        </InfoTip>
      </span>
      <div className="grid grid-cols-4 gap-[10px]">
        <Tile label="Inquiries" value={activity.inquiries} />
        <Tile label="Successful" value={activity.successful} />
        <Tile label="Cancelled" value={activity.cancelled} />
        <Tile label="Returned" value={activity.returned} />
      </div>

      {/* Two columns: what the account has done on the left, what was agreed
          with it on the right. Both are `min-w-0`, without which a long value
          sets the column's minimum and the dialog scrolls sideways. */}
      <div className="grid grid-cols-2 gap-x-5">
        <div className="min-w-0">
          <FormSection>Ordering behaviour</FormSection>
          <div>
            <Row label="Orders on record" value={stat.orderCount} />
            <Row label="Average order" value={fmtLiters(Math.round(stat.avgOrderLiters))} />
            <Row label="Reorders" value={stat.reorderDays !== null ? `every ${stat.reorderDays} days` : null} />
            <Row label="Price paid" value={stat.avgPrice > 0 ? `₱${stat.avgPrice.toFixed(2)}/L` : null} />
            <Row label="Markup earned" value={stat.markup !== null ? `+₱${stat.markup.toFixed(2)}/L` : null} />
            <Row label="Usual payment" value={stat.usualPayment ? label(stat.usualPayment) : null} />
          </div>
        </div>

        <div className="min-w-0">
          <FormSection>Agreed terms</FormSection>
          <div>
            <Row label="Customer since" value={c.customerSince ? fmtDate(c.customerSince) : null} />
            <Row label="Payment terms" value={fmtTerm(c.paymentTermDays)} />
            <Row label="Usual price" value={c.usualPricePerLiter ? `₱${c.usualPricePerLiter.toFixed(2)}/L` : null} />
            <Row label="Usual markup" value={c.usualMarkupPct ? `${c.usualMarkupPct}%` : null} />
            <Row label="Usual payment" value={c.usualPaymentMode ? label(c.usualPaymentMode) : null} />
            <Row label="Lead generated by" value={c.leadGeneratedBy} />
            <Row
              label="Prefers"
              value={[
                c.preferredContact?.platform ? label(c.preferredContact.platform) : null,
                c.preferredContact?.handle,
              ].filter(Boolean).join(' · ')}
            />
          </div>
        </div>
      </div>

      {/* Exhibit A 1.4 asks for three contact points, because in practice they
          are three different places with three different people. */}
      <FormSection>Contacts</FormSection>
      <div className="grid grid-cols-3 gap-[10px]">
        <ContactCard
          title="Office"
          point={c.office ?? { address: c.address, contactPerson: c.contactPerson, contactNumber: c.contactNumber }}
        />
        <ContactCard title="Delivery" point={c.delivery} />
        <ContactCard
          title="Collection"
          point={c.collection ?? (c.collectionAddress ? { address: c.collectionAddress } : undefined)}
        />
      </div>

      <FormSection>Recent orders</FormSection>
      <div className="overflow-hidden rounded-[8px] border border-line">
        <div className="grid grid-cols-[96px_1fr_120px_auto] items-center gap-3 border-b border-linesoft bg-paper px-[12px] py-[7px] font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-faint">
          <span>Date</span>
          <span>Volume</span>
          <span className="text-right">Value</span>
          <span className="text-right">Payment</span>
        </div>
        {recent.map((s) => {
          const badge = installmentBadge(s.installments)
          return (
            <div
              key={s.id}
              className="grid grid-cols-[96px_1fr_120px_auto] items-center gap-3 border-b border-linesoft px-[12px] py-[8px] text-[13px] last:border-b-0"
            >
              <span className="font-meta text-[12px] text-mut">{fmtDate(s.date).replace(', 2026', '')}</span>
              <span className="tnum font-semibold">{fmtLiters(s.volumeLiters)}</span>
              <span className="tnum text-right text-lab">
                {fmtCurrency(s.volumeLiters * s.pricePerLiter).replace('.00', '')}
              </span>
              <span className="flex items-center justify-end gap-[5px]">
                <Chip status={badge.statusKey} text={badge.text} />
                {badge.anyOverdue && <Chip status="overdue" text="Overdue" />}
              </span>
            </div>
          )
        })}
        {recent.length === 0 && <p className="m-0 py-5 text-center text-[13px] text-faint">No orders yet.</p>}
      </div>
    </Dialog>
  )
}
