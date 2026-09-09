// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import FilePreview, { FileThumb, isImage, isPdf } from './FilePreview'
import { downloadAttachment } from '../lib/attachments'
import type { Attachment } from '../lib/attachments'

const file = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'a1', tbl: 'purchases', recordId: 'p1', slot: 'supplierPo',
  filename: 'PO-2026-0041.pdf', contentType: 'application/pdf', sizeBytes: 240_000,
  referenceNo: null, uploadedBy: 's1', uploadedAt: '2026-09-09T00:00:00.000Z',
  signStatus: 'none', url: '/api/attachments/a1/file',
  ...over,
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.setItem('erp-token', 'tok-123')
  // jsdom implements neither.
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  // A hand-rolled response: jsdom's Response does not implement blob().
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['x']) }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

describe('reaching the bytes', () => {
  it('sends the seat token, which is the whole reason a plain src fails', () => {
    // The API authenticates with an Authorization header out of localStorage.
    // <img src>, <a href> and <iframe src> send no such header, so every one of
    // them 401'd - silently, in the case of a download.
    render(<FilePreview file={file()} onClose={() => {}} />)
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok-123' })
  })

  it('never puts the token in the URL', () => {
    // A query-string token would end up in history, logs and any copied link.
    render(<FilePreview file={file()} onClose={() => {}} />)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/attachments/a1/file')
  })

  it('saves through the same authenticated fetch', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await downloadAttachment(file())
    expect(fetchMock).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })
})

describe('FileThumb', () => {
  it('shows an image document as itself', async () => {
    const { container } = render(<FileThumb file={file({ contentType: 'image/jpeg' })} />)
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:fake'))
  })

  it('does not fetch a file it has no picture for', () => {
    // A PDF page at 40px is a grey rectangle; pulling 15 MB to draw one is
    // worse than showing its kind.
    render(<FileThumb file={file()} />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is only a button when there is something to open', () => {
    const { container, rerender } = render(<FileThumb file={file()} />)
    expect(container.querySelector('button')).toBeNull()
    rerender(<FileThumb file={file()} onClick={vi.fn()} />)
    expect(container.querySelector('button')).toBeTruthy()
  })
})

describe('FilePreview', () => {
  it('renders a PDF in place', async () => {
    render(<FilePreview file={file()} onClose={() => {}} />)
    await waitFor(() => expect(document.querySelector('iframe')?.getAttribute('src')).toBe('blob:fake'))
  })

  it('renders an image in place', async () => {
    render(<FilePreview file={file({ contentType: 'image/png', filename: 'scan.png' })} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByAltText('scan.png').getAttribute('src')).toBe('blob:fake'))
  })

  it('says so when the bytes cannot be had, rather than framing a blank', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, blob: async () => new Blob() })
    render(<FilePreview file={file()} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeTruthy())
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('says so plainly for a type it cannot show, and does not fetch it', () => {
    render(<FilePreview
      file={file({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'costs.xlsx' })}
      onClose={() => {}}
    />)
    expect(screen.getByText(/Preview is not available/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('releases the object URL when it closes', async () => {
    const { unmount } = render(<FilePreview file={file()} onClose={() => {}} />)
    await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy())
    unmount()
    // These are whole files held in memory - ten opened documents would
    // otherwise stay resident until reload.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })
})

describe('type checks', () => {
  it('tells the kinds apart', () => {
    expect(isImage(file({ contentType: 'image/heic' }))).toBe(true)
    expect(isImage(file())).toBe(false)
    expect(isPdf(file())).toBe(true)
    expect(isPdf(file({ contentType: 'image/png' }))).toBe(false)
  })
})
