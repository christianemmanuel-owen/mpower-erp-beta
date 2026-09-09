// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Attachment } from '../lib/attachments'

const uploadMutate = vi.fn()
const removeMutate = vi.fn()
let ROWS: Attachment[] = []

vi.mock('../lib/attachments', async () => {
  const actual = await vi.importActual<typeof import('../lib/attachments')>('../lib/attachments')
  return {
    ...actual,
    useAttachments: () => ({ data: ROWS, isLoading: false, error: null }),
    useUploadAttachment: () => ({ mutate: uploadMutate, isPending: false, error: null }),
    useDeleteAttachment: () => ({ mutate: removeMutate }),
    useSetAttachmentReference: () => ({ mutate: vi.fn() }),
    useAttachmentUrl: () => ({ url: null, failed: false }),
    downloadAttachment: vi.fn(),
  }
})

const DocumentUpload = (await import('./DocumentUpload')).default

const file = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'a1', tbl: 'purchases', recordId: 'p1', slot: 'supplierPo',
  filename: 'po-page-1.pdf', contentType: 'application/pdf', sizeBytes: 425_000,
  referenceNo: null, uploadedBy: 's1', uploadedAt: '2026-09-09T00:00:00.000Z',
  signStatus: 'none', url: '/api/attachments/a1/file',
  ...over,
})

const SLOTS = ['supplierPo', 'supplierDeliveryReceipt'] as const
const show = () => render(<DocumentUpload tbl="purchases" recordId="p1" slots={SLOTS} />)

beforeEach(() => { ROWS = []; uploadMutate.mockClear(); removeMutate.mockClear() })
afterEach(cleanup)

describe('DocumentUpload', () => {
  it('lists every file filed under one document type', () => {
    // A two-page purchase order is two files of one document. The API has
    // always appended; only the UI implied otherwise.
    ROWS = [file(), file({ id: 'a2', filename: 'po-page-2.jpg' })]
    show()
    expect(screen.getByText('po-page-1.pdf')).toBeTruthy()
    expect(screen.getByText('po-page-2.jpg')).toBeTruthy()
    expect(screen.getByText('2 files')).toBeTruthy()
  })

  it('says Add once something is filed, because that is what it does', () => {
    // It said "Replace", which was untrue - the second upload joined the first
    // rather than displacing it.
    ROWS = [file()]
    show()
    expect(screen.getByRole('button', { name: /Add/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Replace/ })).toBeNull()
  })

  it('says Upload while a slot is empty', () => {
    show()
    expect(screen.getAllByRole('button', { name: /Upload/ }).length).toBe(2)
  })

  it('files several dropped scans at once', () => {
    // Front and back of a delivery receipt should not need two trips through
    // the picker.
    show()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.multiple).toBe(true)
    fireEvent.change(input, {
      target: { files: [new File(['a'], 'front.jpg'), new File(['b'], 'back.jpg')] },
    })
    expect(uploadMutate).toHaveBeenCalledTimes(2)
    expect(uploadMutate.mock.calls[0][0]).toMatchObject({ slot: 'supplierPo' })
  })

  it('reports an empty slot in one line rather than a card of its own', () => {
    show()
    expect(screen.getAllByText('Not on file').length).toBe(2)
  })

  it('gives each file its own reference number', () => {
    ROWS = [file(), file({ id: 'a2', filename: 'po-page-2.jpg' })]
    show()
    expect(screen.getByLabelText('Reference number for po-page-1.pdf')).toBeTruthy()
    expect(screen.getByLabelText('Reference number for po-page-2.jpg')).toBeTruthy()
  })

  it('removes the one file that was asked for', () => {
    ROWS = [file(), file({ id: 'a2', filename: 'po-page-2.jpg' })]
    show()
    fireEvent.click(screen.getByLabelText('Remove po-page-2.jpg'))
    expect(removeMutate).toHaveBeenCalledWith('a2')
  })

  it('offers nothing to change when read-only', () => {
    ROWS = [file()]
    render(<DocumentUpload tbl="purchases" recordId="p1" slots={SLOTS} readOnly />)
    expect(screen.queryByRole('button', { name: /Add|Upload/ })).toBeNull()
    expect(screen.queryByLabelText(/^Remove /)).toBeNull()
    // Reading is still allowed.
    expect(screen.getByLabelText('Download po-page-1.pdf')).toBeTruthy()
  })
})
