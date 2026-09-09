import type { ReactNode } from 'react'
import { FileSpreadsheet, FileText, Image as ImageIcon } from 'lucide-react'
import { Dialog, GhostButton } from './ui'
import { downloadAttachment, fmtFileSize, openAttachment, useAttachmentUrl, type Attachment } from '../lib/attachments'
import { fmtDate } from '../lib/format'

/**
 * Looking at a filed document, rather than reading its filename.
 *
 * The row said "2024-25_1 Theo 13 Turabian style ..." and truncated there,
 * which tells you nothing about whether the right scan got attached - the one
 * question anyone has about an uploaded purchase order. Now the row carries a
 * thumbnail and opens the document itself.
 */

export const isImage = (a: Attachment) => a.contentType.startsWith('image/')
export const isPdf = (a: Attachment) => a.contentType === 'application/pdf'

/** The mark for a file that has no picture of its own. */
export function FileGlyph({ file, size = 16 }: { file: Attachment; size?: number }) {
  const Icon = isImage(file) ? ImageIcon
    : /sheet|excel|csv/.test(file.contentType) ? FileSpreadsheet
    : FileText
  return <Icon size={size} strokeWidth={1.8} className="text-mut" />
}

/**
 * A small square of the document.
 *
 * Images show themselves. Everything else shows its kind - a PDF page rendered
 * at 40px is a grey rectangle, which is worse than the icon because it looks
 * like a broken image rather than a deliberate one.
 */
export function FileThumb({ file, onClick }: { file: Attachment; onClick?: () => void }) {
  // Only images are worth fetching for a 40px square; everything else shows its
  // kind without pulling the file down.
  const { url, failed } = useAttachmentUrl(isImage(file) ? file : null)
  const inner = isImage(file) && url && !failed ? (
    <img src={url} alt="" className="h-full w-full rounded-[5px] object-cover" />
  ) : (
    <FileGlyph file={file} size={17} />
  )
  const cls = 'flex h-[40px] w-[40px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-line bg-white'
  if (!onClick) return <span className={cls}>{inner}</span>
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open this document"
      className={`${cls} cursor-pointer p-0 transition-colors hover:border-inputline`}
    >
      {inner}
    </button>
  )
}

export default function FilePreview({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const showable = isImage(file) || isPdf(file)
  const { url, failed } = useAttachmentUrl(showable ? file : null)

  return (
    <Dialog
      open
      title={file.filename}
      subtitle={`${fmtFileSize(file.sizeBytes)} · uploaded ${fmtDate(file.uploadedAt)}`}
      onClose={onClose}
      width={860}
      footer={
        <>
          <GhostButton onClick={() => { void openAttachment(file) }}>Open in a new tab</GhostButton>
          <GhostButton onClick={() => { void downloadAttachment(file) }}>Download</GhostButton>
        </>
      }
    >
      {showable && failed ? (
        <Unshowable file={file}>
          <p className="m-0 text-[13px] text-lab">This document could not be loaded.</p>
          <p className="m-0 font-meta text-[12px] text-mut">Your session may have expired. Sign in again and retry.</p>
        </Unshowable>
      ) : showable && !url ? (
        <p className="py-12 text-center font-meta text-[12px] text-mut">Loading…</p>
      ) : isImage(file) ? (
        <img src={url ?? ''} alt={file.filename} className="mx-auto max-h-[62vh] rounded-[6px] object-contain" />
      ) : isPdf(file) ? (
        <iframe src={url ?? ''} title={file.filename} className="h-[62vh] w-full rounded-[6px] border border-line" />
      ) : (
        // Said plainly rather than shown as an empty frame. A spreadsheet has
        // no in-browser rendering here, and pretending otherwise gives the
        // reader a blank box to interpret.
        <Unshowable file={file}>
          <p className="m-0 text-[13px] text-lab">Preview is not available for this file type.</p>
          <p className="m-0 font-meta text-[12px] text-mut">Download the file to open it in the appropriate application.</p>
        </Unshowable>
      )}
    </Dialog>
  )
}

function Unshowable({ file, children }: { file: Attachment; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-[10px] py-12 text-center">
      <FileGlyph file={file} size={26} />
      {children}
    </div>
  )
}
