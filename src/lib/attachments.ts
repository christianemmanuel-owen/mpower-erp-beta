// Uploaded digital copies - the client half of Exhibit A 1.2, 1.3, 1.4, 1.5, 1.9.
//
// Fourteen Exhibit A line items ask for "reference number and uploaded digital
// copy of ...". They are one operation against different records, so screens use
// the <DocumentUpload> component (src/components/DocumentUpload.tsx) over these
// hooks rather than each building their own uploader.

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError, api, apiUpload, getToken } from './api'
import { queryClient } from './queryClient'

export interface Attachment {
  id: string
  tbl: string
  recordId: string
  slot: string
  filename: string
  contentType: string
  sizeBytes: number
  referenceNo: string | null
  uploadedBy: string
  uploadedAt: string
  /** 'none' until an e-signature service is procured - Secondary Feature 2.14 (D). */
  signStatus: string
  /** Fetch/preview URL. Guarded by the same seat rules as the owning record. */
  url: string
}

/** Human labels for the document slots. Keep in step with SLOTS in
 * app/server/attachments.ts - the server is the one that enforces them. */
export const SLOT_LABELS: Record<string, string> = {
  // Inventory (1.2)
  supplierPo: 'Purchase order to supplier',
  supplierInvoice: 'Supplier invoice',
  permitToLoad: 'Permit to load',
  supplierDeliveryReceipt: 'Supplier delivery receipt',
  fuelAnalysisSlip: 'Fuel analysis slip',
  paymentProof: 'Proof of payment to supplier',
  // Sales (1.3)
  clientPo: 'Purchase order from client',
  // Accounts (1.4) - account opening checklist
  bir2303: 'BIR 2303',
  businessPermit: 'Business permit',
  bankAccounts: 'Bank accounts',
  customerProfileForm: 'Customer profile form',
  other: 'Other document',
  // Logistics (1.5)
  preDispatchChecklist: 'Pre-dispatch checklist',
  deliveryReceipt: 'Delivery receipt',
  clientLoadingSlip: 'Loading slip from client',
  signedReceipt: 'Signed receipt',
  depotLoadingSlip: 'Loading slip from depot',
  supplierReceipt: 'Receipt from supplier',
  internalReceipt: 'Internal receipt',
  // Collection (1.6)
  collectionForm: 'Collection form',
  depositSlip: 'Deposit slip',
  checkImage: 'Check',
  // HR (1.7)
  drugTestResult: 'Drug test result',
  contract: 'Employment contract',
  govId: 'Government ID',
}

/** The four documents an account needs on file before it is fully opened
 * (Exhibit A 1.4 "Account opening document checklist"). */
export const ACCOUNT_OPENING_SLOTS = ['bir2303', 'businessPermit', 'bankAccounts', 'customerProfileForm'] as const

export const slotLabel = (slot: string) => SLOT_LABELS[slot] ?? slot

export const attachmentsKey = (tbl: string, recordId: string) => ['attachments', tbl, recordId] as const

/** Every document filed against one record. */
export function useAttachments(tbl: string, recordId: string | undefined) {
  return useQuery({
    queryKey: attachmentsKey(tbl, recordId ?? ''),
    queryFn: () => api<{ rows: Attachment[] }>(`/attachments?tbl=${tbl}&record=${recordId}`).then((r) => r.rows),
    enabled: Boolean(recordId),
  })
}

export function useUploadAttachment(tbl: string, recordId: string) {
  return useMutation({
    mutationFn: ({ file, slot, referenceNo }: { file: File; slot: string; referenceNo?: string }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('tbl', tbl)
      form.append('record', recordId)
      form.append('slot', slot)
      if (referenceNo) form.append('referenceNo', referenceNo)
      return apiUpload<Attachment>('/attachments', form)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attachmentsKey(tbl, recordId) }),
  })
}

export function useDeleteAttachment(tbl: string, recordId: string) {
  return useMutation({
    mutationFn: (id: string) => api(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attachmentsKey(tbl, recordId) }),
  })
}

export function useSetAttachmentReference(tbl: string, recordId: string) {
  return useMutation({
    mutationFn: ({ id, referenceNo }: { id: string; referenceNo: string }) =>
      api<Attachment>(`/attachments/${id}`, { method: 'PUT', body: { referenceNo } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attachmentsKey(tbl, recordId) }),
  })
}

/**
 * Attachment bytes cannot be reached by a plain URL, and never could.
 *
 * The API authenticates with `authorization: Bearer <token>` out of
 * localStorage. A browser fetching `<img src>`, an `<a href>` download or an
 * `<iframe src>` sends no such header, so every one of those got a 401 - the
 * old "Download" link and the filename link included. Nothing looked broken
 * because a failed download is silent; putting a thumbnail on the row is what
 * finally made it visible.
 *
 * So the bytes are fetched the same way every other request is, and handed to
 * the browser as an object URL. The alternative - a token in the query string -
 * would put a live session key into history, logs and any copied link.
 */
async function fetchBlob(a: Attachment): Promise<Blob> {
  const res = await fetch(a.url, { headers: { authorization: `Bearer ${getToken() ?? ''}` } })
  if (!res.ok) throw new ApiError(res.status, res.status === 401 ? 'Your session expired.' : 'Couldn’t load this document.')
  return res.blob()
}

/**
 * An object URL for one attachment, revoked when it is no longer needed.
 *
 * Pass null to hold nothing - a thumbnail for a PDF has no picture to fetch and
 * should not pull 15 MB to decide that.
 */
export function useAttachmentUrl(file: Attachment | null) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setUrl(null)
    setFailed(false)
    if (!file) return
    let live = true
    let objectUrl = ''
    fetchBlob(file)
      .then((blob) => {
        if (!live) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => { if (live) setFailed(true) })
    return () => {
      live = false
      // Freeing it matters: these are whole files held in memory, and a form
      // that opens ten documents would otherwise keep all ten until reload.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  return { url, failed }
}

/** Saves the file, going through the same authenticated fetch. */
export async function downloadAttachment(a: Attachment): Promise<void> {
  const blob = await fetchBlob(a)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = a.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** Opens the file in its own tab. The object URL outlives this call, so it is
 *  released on a timer rather than immediately - revoking it now would hand the
 *  new tab a dead link. */
export async function openAttachment(a: Attachment): Promise<void> {
  const blob = await fetchBlob(a)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function fmtFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Allocates the next number in a System-issued series (Exhibit A 1.2, 1.3, 1.5,
 * 1.6). A POST, not a GET, so refreshing never burns a number and leaves a gap.
 * Externally-supplied numbers - the client's own PO, the supplier's DR - are
 * typed in by staff and don't come from here. */
export function allocateReference(series: 'PO' | 'DR' | 'LS' | 'PDC' | 'CF' | 'IR') {
  return api<{ referenceNo: string }>(`/refs/${series}`, { method: 'POST' }).then((r) => r.referenceNo)
}
