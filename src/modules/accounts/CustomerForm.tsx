import { useEffect, useMemo, useState } from 'react'
import {
  Field, FormSection, GhostButton, Input, PrimaryButton, Select, Textarea, Dialog,
} from '../../components/ui'
import { FormNav, useSectionNav, type FormNavSection } from '../../components/FormNav'
import { RailAside, RailRow, RailSection } from '../../components/SummaryRail'
import DocumentUpload from '../../components/DocumentUpload'
import { ACCOUNT_OPENING_SLOTS, slotLabel, useAttachments } from '../../lib/attachments'
import { isPending } from '../../lib/approvals'
import { repos } from '../../data/repo'
import type { ContactPoint, Customer, PaymentMode, PreferredContact } from '../../data/types'

/**
 * The account master record - Exhibit A 1.4.
 *
 * The spec asks for three separate contact points (office, delivery, collection)
 * rather than one address, because in practice they are three different places
 * with three different people: the office signs the paperwork, the delivery site
 * receives the fuel, and someone else entirely hands over the cheque. Flattening
 * them into one contact is what forces staff to keep the real ones in a chat
 * thread.
 *
 * Each section can be copied from the office details, since plenty of accounts
 * genuinely do use one address for everything - the point is that it is recorded
 * as a deliberate answer rather than an assumption.
 */

const PLATFORMS: ReadonlyArray<{ value: NonNullable<PreferredContact['platform']>; label: string }> = [
  { value: 'viber', label: 'Viber' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'call', label: 'Phone call' },
]

const emptyContact = (): ContactPoint => ({
  address: '', contactPerson: '', designation: '', email: '', contactNumber: '',
})

const filled = (c: ContactPoint) => Object.values(c).some((v) => (v ?? '').trim() !== '')

const SECTIONS = [
  { id: 'sec-company', title: 'Company' },
  { id: 'sec-office', title: 'Office' },
  { id: 'sec-delivery', title: 'Delivery' },
  { id: 'sec-collection', title: 'Collection' },
  { id: 'sec-reach', title: 'How to reach them' },
  { id: 'sec-terms', title: 'Commercial terms' },
  { id: 'sec-notes', title: 'Notes' },
  { id: 'sec-docs', title: 'Documents' },
] as const

export default function CustomerForm({ open, editing, onClose, onNotice }: {
  open: boolean
  editing: Customer | null
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const [form, setForm] = useState(blank)
  const [error, setError] = useState<string | null>(null)
  /** What is wrong with which field, said on the field rather than in a banner. */
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const docs = useAttachments('customers', editing?.id)
  const { active, jump } = useSectionNav(SECTIONS.map((s) => s.id))

  useEffect(() => {
    if (!open) return
    setForm(editing ? toForm(editing) : blank())
    setError(null)
    setErrors({})
  }, [open, editing])

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const setPoint = (which: 'office' | 'delivery' | 'collection', k: keyof ContactPoint, v: string) =>
    setForm((f) => ({ ...f, [which]: { ...f[which], [k]: v } }))

  /** Copies the office details across - the common case where one address does
   * for everything, made explicit rather than left blank and guessed at. */
  const copyFromOffice = (which: 'delivery' | 'collection') =>
    setForm((f) => ({ ...f, [which]: { ...f.office } }))

  const onFile = useMemo(() => new Set((docs.data ?? []).map((d) => d.slot)), [docs.data])
  const missingDocs = ACCOUNT_OPENING_SLOTS.filter((slot) => !onFile.has(slot))

  const navSections: FormNavSection[] = SECTIONS.map((s) => {
    const done = {
      'sec-company': form.company.trim() !== '',
      'sec-office': filled(form.office),
      'sec-delivery': filled(form.delivery),
      'sec-collection': filled(form.collection),
      'sec-reach': form.platform !== '' || form.handle.trim() !== '',
      'sec-terms': form.paymentTermDays !== '',
      'sec-notes': form.notes.trim() !== '',
      'sec-docs': Boolean(editing) && missingDocs.length === 0,
    }[s.id]
    // A field in error outranks a field that is filled in, so the nav points at
    // the section that needs a person rather than the one furthest down.
    const bad = Object.keys(errors).some((k) => SECTION_OF[k] === s.id)
    return { id: s.id, title: s.title, state: bad ? 'problem' : done ? 'done' : 'todo' }
  })

  /**
   * Checked here rather than one failure at a time.
   *
   * Save used to return at the first problem with a banner at the top of a
   * 1,200px form, so you fixed one thing to be told about the next - and the
   * message sat nowhere near the field it was about.
   */
  function check(): Record<string, string> {
    const bad: Record<string, string> = {}
    if (!form.company.trim()) bad.company = 'An account needs a company name.'

    const num = (v: string | number) => (v === '' ? null : Number(v))
    const price = num(form.usualPricePerLiter)
    if (price !== null && (Number.isNaN(price) || price < 0)) bad.usualPricePerLiter = 'Enter a price of zero or more.'
    const markup = num(form.usualMarkupPct)
    if (markup !== null && (Number.isNaN(markup) || markup < 0)) bad.usualMarkupPct = 'Enter a percentage of zero or more.'
    const term = num(form.paymentTermDays)
    if (term === null || Number.isNaN(term) || term < 0) bad.paymentTermDays = 'Enter a number of days, or 0 for on the spot.'
    const score = num(form.creditScoreOverride)
    if (score !== null && (Number.isNaN(score) || score < 0 || score > 100)) bad.creditScoreOverride = 'A score runs from 0 to 100.'

    for (const which of ['office', 'collection'] as const) {
      const email = (form[which].email ?? '').trim()
      if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad[`${which}.email`] = 'That does not look like an email address.'
    }
    return bad
  }

  async function save() {
    const bad = check()
    setErrors(bad)
    if (Object.keys(bad).length > 0) {
      // Land on the first section that has a problem, so a message below the
      // fold is not a message nobody sees.
      const firstBad = SECTIONS.find((s) => Object.keys(bad).some((k) => SECTION_OF[k] === s.id))
      if (firstBad) jump(firstBad.id)
      return
    }

    setSaving(true)
    setError(null)

    const clean = (c: ContactPoint): ContactPoint | undefined => (filled(c) ? c : undefined)

    const payload: Partial<Customer> = {
      company: form.company.trim(),
      brand: form.brand.trim(),
      // The flat fields stay the office details so every screen written before
      // the commercial profile existed keeps working unchanged.
      address: form.office.address ?? '',
      contactPerson: form.office.contactPerson ?? '',
      contactNumber: form.office.contactNumber ?? '',
      collectionAddress: form.collection.address?.trim() || undefined,
      customerSince: form.customerSince || undefined,
      paymentTermDays: Number(form.paymentTermDays) || 0,
      leadGeneratedBy: form.leadGeneratedBy.trim() || undefined,
      office: clean(form.office),
      delivery: clean(form.delivery),
      collection: clean(form.collection),
      preferredContact: form.platform || form.handle.trim()
        ? { platform: form.platform || undefined, handle: form.handle.trim() || undefined }
        : undefined,
      usualPricePerLiter: form.usualPricePerLiter === '' ? undefined : Number(form.usualPricePerLiter),
      usualMarkupPct: form.usualMarkupPct === '' ? undefined : Number(form.usualMarkupPct),
      usualPaymentMode: form.usualPaymentMode || undefined,
      creditScoreOverride: form.creditScoreOverride === '' ? undefined : Number(form.creditScoreOverride),
      notes: form.notes.trim() || undefined,
    }

    try {
      const result = editing
        ? await repos.customers.update(editing.id, payload)
        : await repos.customers.add(payload as Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>)
      if (isPending(result)) onNotice(result.message)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save this account.')
    } finally {
      setSaving(false)
    }
  }

  const contactFields = (which: 'office' | 'delivery' | 'collection', withEmail: boolean) => (
    <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
      <Field label="Address" span2>
        <Input value={form[which].address ?? ''} onChange={(e) => setPoint(which, 'address', e.target.value)} />
      </Field>
      <Field label="Contact person">
        <Input value={form[which].contactPerson ?? ''} onChange={(e) => setPoint(which, 'contactPerson', e.target.value)} />
      </Field>
      <Field label="Designation">
        <Input
          value={form[which].designation ?? ''}
          placeholder="e.g. Purchasing Officer"
          onChange={(e) => setPoint(which, 'designation', e.target.value)}
        />
      </Field>
      <Field label="Contact number" span2={!withEmail}>
        <Input value={form[which].contactNumber ?? ''} onChange={(e) => setPoint(which, 'contactNumber', e.target.value)} />
      </Field>
      {withEmail && (
        <Field label="Email" error={errors[`${which}.email`]}>
          <Input type="email" value={form[which].email ?? ''} onChange={(e) => setPoint(which, 'email', e.target.value)} />
        </Field>
      )}
    </div>
  )

  const copyButton = (which: 'delivery' | 'collection') => (
    <button
      type="button"
      onClick={() => copyFromOffice(which)}
      className="cursor-pointer rounded-[6px] border border-inputline bg-white px-[9px] py-[4px] font-meta text-[11px] font-semibold normal-case tracking-normal text-lab transition-colors hover:bg-fill2"
    >
      Same as office
    </button>
  )

  return (
    <Dialog
      open={open}
      title={editing ? editing.company : 'New account'}
      subtitle={editing
        ? [editing.brand, 'Account details'].filter(Boolean).join(' · ')
        : 'A customer account, its three contact points and its terms'}
      onClose={onClose}
      width={1000}
      nav={<FormNav sections={navSections} active={active} onJump={jump} />}
      rail={
        <>
          {/* Three contact points is the point of this form (Exhibit A 1.4), and
              on a long scroll it was impossible to see which of them you had
              actually filled in without going back up. */}
          <RailSection title="Contact points">
            <RailRow label="Office" value={filled(form.office) ? 'Recorded' : '—'} />
            <RailRow label="Delivery" value={filled(form.delivery) ? 'Recorded' : '—'} />
            <RailRow label="Collection" value={filled(form.collection) ? 'Recorded' : '—'} />
            {!filled(form.delivery) && !filled(form.collection) && (
              <RailAside>Plenty of accounts use one address for everything - copy the office details so it reads as an answer rather than a blank.</RailAside>
            )}
          </RailSection>

          <RailSection title="Account opening documents">
            {editing ? (
              <>
                <RailRow
                  label="On file"
                  value={`${ACCOUNT_OPENING_SLOTS.length - missingDocs.length} of ${ACCOUNT_OPENING_SLOTS.length}`}
                />
                {missingDocs.length > 0
                  ? <RailAside>Still to file: {missingDocs.map(slotLabel).join(', ')}.</RailAside>
                  : <RailAside>Complete.</RailAside>}
              </>
            ) : (
              <RailAside>Create the account first, then reopen it to file the BIR 2303, business permit, bank details and customer profile form.</RailAside>
            )}
            {/* A standing caveat about the whole section, not about a field -
                it used to be a footnote under the uploader with a section label
                nested inside a paragraph. */}
            <RailAside>
              Electronic signature is a Dependent Item (2.14) and is not part of the System today: upload the signed copies.
            </RailAside>
          </RailSection>
        </>
      }
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
          </PrimaryButton>
        </>
      }
    >
      {error && (
        <p className="mb-3 rounded-[6px] border border-redf bg-redbadge px-3 py-2 text-[13px] font-semibold text-redtext">{error}</p>
      )}

      <FormSection first id="sec-company">Company</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Company name" error={errors.company}>
          <Input value={form.company} onChange={(e) => set('company', e.target.value)} />
        </Field>
        <Field label="Brand">
          <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        </Field>
        <Field label="Who generated the lead" hint="The agent, referrer, or channel this account came from.">
          <Input
            value={form.leadGeneratedBy}
            placeholder="e.g. Referral - R. Cruz"
            onChange={(e) => set('leadGeneratedBy', e.target.value)}
          />
        </Field>
        <Field label="Customer since" hint="Drives length of relationship.">
          <Input type="date" value={form.customerSince} onChange={(e) => set('customerSince', e.target.value)} />
        </Field>
      </div>

      <FormSection id="sec-office">Office</FormSection>
      {contactFields('office', true)}

      <FormSection id="sec-delivery" right={copyButton('delivery')}>Delivery</FormSection>
      {contactFields('delivery', false)}

      <FormSection id="sec-collection" right={copyButton('collection')}>Collection</FormSection>
      {contactFields('collection', true)}

      <FormSection id="sec-reach">How to reach them</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Platform">
          <Select value={form.platform} onChange={(e) => set('platform', e.target.value)}>
            <option value="">—</option>
            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Username or group chat">
          <Input
            value={form.handle}
            placeholder="e.g. MPower × Acme Ops"
            onChange={(e) => set('handle', e.target.value)}
          />
        </Field>
      </div>

      <FormSection id="sec-terms">Commercial terms</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field
          label="Usual selling price (₱/L)"
          hint="Reference only - not enforced on a sale."
          error={errors.usualPricePerLiter}
        >
          <Input
            type="number" step="0.01" min={0} className="nospin tnum"
            value={form.usualPricePerLiter}
            onChange={(e) => set('usualPricePerLiter', e.target.value)}
          />
        </Field>
        <Field label="Usual markup (%)" hint="The purchaser’s markup, where applicable." error={errors.usualMarkupPct}>
          <Input
            type="number" step="0.01" min={0} className="nospin tnum"
            value={form.usualMarkupPct}
            onChange={(e) => set('usualMarkupPct', e.target.value)}
          />
        </Field>
        <Field label="Usual mode of payment">
          <Select value={form.usualPaymentMode} onChange={(e) => set('usualPaymentMode', e.target.value)}>
            <option value="">—</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
          </Select>
        </Field>
        <Field label="Payment terms (days)" hint="0 = due on the spot." error={errors.paymentTermDays}>
          <Input
            type="number" min={0} className="nospin tnum"
            value={form.paymentTermDays}
            onChange={(e) => set('paymentTermDays', e.target.value)}
          />
        </Field>
      </div>

      <FormSection id="sec-notes">Notes</FormSection>
      <div className="grid grid-cols-2 gap-x-4 gap-y-[14px]">
        <Field label="Account notes" span2>
          <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {/* The computed credit score is deliberately unavailable until the
            Parties agree the formula (Exhibit A 1.4). This is the honest
            stand-in: a human judgement, labelled as one wherever it is shown. */}
        <Field
          label="Manual credit score"
          hint="Optional. Shown as a human judgement, not a computed figure - the scoring formula is still to be confirmed."
          error={errors.creditScoreOverride}
        >
          <Input
            type="number" min={0} max={100} className="nospin tnum"
            value={form.creditScoreOverride}
            onChange={(e) => set('creditScoreOverride', e.target.value)}
          />
        </Field>
      </div>

      <FormSection id="sec-docs">Account opening documents</FormSection>
      {editing ? (
        <DocumentUpload tbl="customers" recordId={editing.id} slots={[...ACCOUNT_OPENING_SLOTS, 'other']} />
      ) : (
        <p className="m-0 font-meta text-[12px] text-mut">
          Create the account first, then reopen it to file the signed copies.
        </p>
      )}
    </Dialog>
  )
}

/** Which section a field's message belongs to, so the nav can mark it and Save
 *  can jump to it. */
const SECTION_OF: Record<string, string> = {
  company: 'sec-company',
  'office.email': 'sec-office',
  'collection.email': 'sec-collection',
  usualPricePerLiter: 'sec-terms',
  usualMarkupPct: 'sec-terms',
  paymentTermDays: 'sec-terms',
  creditScoreOverride: 'sec-notes',
}

function blank() {
  return {
    company: '', brand: '', leadGeneratedBy: '', customerSince: '',
    office: emptyContact(), delivery: emptyContact(), collection: emptyContact(),
    platform: '' as PreferredContact['platform'] | '',
    handle: '',
    usualPricePerLiter: '' as number | '' | string,
    usualMarkupPct: '' as number | '' | string,
    usualPaymentMode: '' as PaymentMode | '',
    paymentTermDays: '30' as string,
    creditScoreOverride: '' as number | '' | string,
    notes: '',
  }
}

function toForm(c: Customer): ReturnType<typeof blank> {
  return {
    company: c.company,
    brand: c.brand ?? '',
    leadGeneratedBy: c.leadGeneratedBy ?? '',
    customerSince: c.customerSince ? c.customerSince.slice(0, 10) : '',
    // Fall back to the flat fields so an account created before the commercial
    // profile existed opens with its details in place rather than blank.
    office: {
      ...emptyContact(),
      address: c.office?.address ?? c.address,
      contactPerson: c.office?.contactPerson ?? c.contactPerson,
      contactNumber: c.office?.contactNumber ?? c.contactNumber,
      designation: c.office?.designation ?? '',
      email: c.office?.email ?? '',
    },
    delivery: { ...emptyContact(), ...c.delivery },
    collection: {
      ...emptyContact(),
      ...c.collection,
      address: c.collection?.address ?? c.collectionAddress ?? '',
    },
    platform: c.preferredContact?.platform ?? '',
    handle: c.preferredContact?.handle ?? '',
    usualPricePerLiter: c.usualPricePerLiter ?? '',
    usualMarkupPct: c.usualMarkupPct ?? '',
    usualPaymentMode: c.usualPaymentMode ?? '',
    paymentTermDays: String(c.paymentTermDays ?? 30),
    creditScoreOverride: c.creditScoreOverride ?? '',
    notes: c.notes ?? '',
  }
}
