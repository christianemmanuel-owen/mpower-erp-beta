import { todayISO } from '../../lib/format'
import { useState } from 'react'
import { repos } from '../../data/repo'
import { Field, GhostButton, Input, PrimaryButton, Select, Dialog } from '../../components/ui'
import type { Supplier } from '../../data/types'

export default function QuoteForm({ open, suppliers, onClose }: {
  open: boolean
  suppliers: Supplier[]
  onClose: () => void
}) {
  const [supplierId, setSupplierId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [price, setPrice] = useState(52)

  async function save() {
    const sid = supplierId || suppliers[0]?.id
    if (!sid || price <= 0) return
    await repos.supplierQuotes.add({ supplierId: sid, date: new Date(date).toISOString(), pricePerLiter: price })
    onClose()
  }

  return (
    <Dialog
      open={open} title="Record quote" onClose={onClose} width={560}
      footer={
        <>
          <PrimaryButton onClick={save}>Save quote</PrimaryButton>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
        </>
      }
    >
      <div className="flex flex-col gap-[14px]">
        <Field label="Supplier">
          <Select value={supplierId || suppliers[0]?.id || ''} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Date quoted">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Quoted price per liter (₱)" hint="Record it even if you don't buy - that's what makes the price history useful.">
          <Input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </Field>
      </div>
    </Dialog>
  )
}
