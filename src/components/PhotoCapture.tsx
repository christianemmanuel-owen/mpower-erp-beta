import { useRef, useState } from 'react'
import { Camera, Loader2, Paperclip, X } from 'lucide-react'
import {
  fmtFileSize, slotLabel, useAttachmentUrl, useAttachments, useDeleteAttachment, useUploadAttachment, type Attachment,
} from '../lib/attachments'
import FilePreview, { FileGlyph, isImage } from './FilePreview'

/**
 * Filing a document from a phone: the delivery receipt at the customer's
 * gate, photographed there and then.
 *
 * Two ways in, because phones offer both and people expect both. "Take a
 * photo" opens the camera straight away - `capture="environment"` asks for
 * the back camera on iOS and Android alike, and a browser that does not
 * honour it (a desktop, say) falls back to its file picker, so the button is
 * never a dead end. "Attach" opens the picker - the photo they took a minute
 * ago, a PDF someone sent them, a scan from another app.
 *
 * What is filed shows as a grid of thumbnails rather than a list of
 * filenames: IMG_4821.jpg tells a driver nothing, the picture does.
 */
export default function PhotoCapture({ tbl, recordId, slot, readOnly }: {
  tbl: string
  recordId: string
  slot: string
  readOnly?: boolean
}) {
  const { data: rows, isLoading, error } = useAttachments(tbl, recordId)
  const upload = useUploadAttachment(tbl, recordId)
  const remove = useDeleteAttachment(tbl, recordId)
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const files = (rows ?? []).filter((r) => r.slot === slot)

  const take = (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) upload.mutate({ file, slot })
  }

  const btn = 'flex h-[52px] flex-1 cursor-pointer items-center justify-center gap-[8px] rounded-[12px] border font-meta text-[14px] font-semibold disabled:cursor-default disabled:opacity-50'

  return (
    <div className="mb-[12px]">
      <p className="m-0 mb-[8px] flex items-baseline gap-[8px] font-meta text-[12px] font-semibold uppercase tracking-[.08em] text-mut">
        {slotLabel(slot)}
        <span className="font-normal normal-case tracking-normal text-faint">
          {isLoading ? 'Loading…' : files.length === 0 ? 'No photo yet' : `${files.length} on file`}
        </span>
      </p>

      {!readOnly && (
        <div className="flex gap-[10px]">
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { take(e.target.files); e.target.value = '' }}
          />
          <input
            ref={picker}
            type="file"
            multiple
            accept=".pdf,image/*"
            className="hidden"
            onChange={(e) => { take(e.target.files); e.target.value = '' }}
          />
          <button type="button" disabled={upload.isPending} onClick={() => camera.current?.click()} className={`${btn} border-ink bg-ink text-white`}>
            {upload.isPending ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} strokeWidth={2} />}
            Take a photo
          </button>
          <button type="button" disabled={upload.isPending} onClick={() => picker.current?.click()} className={`${btn} border-inputline bg-white text-lab`}>
            <Paperclip size={17} strokeWidth={2} />
            Attach
          </button>
        </div>
      )}

      {error && <p className="m-0 mt-[8px] font-meta text-[12px] font-semibold text-redtext">Couldn’t load documents - {(error as Error).message}</p>}
      {upload.error && <p className="m-0 mt-[8px] font-meta text-[12px] font-semibold text-redtext">{(upload.error as Error).message}</p>}

      {files.length > 0 && (
        <ul className="m-0 mt-[10px] grid list-none grid-cols-3 gap-[8px] p-0">
          {files.map((f) => (
            <Shot key={f.id} file={f} readOnly={readOnly} onRemove={() => remove.mutate(f.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Shot({ file, readOnly, onRemove }: { file: Attachment; readOnly?: boolean; onRemove: () => void }) {
  const { url, failed } = useAttachmentUrl(isImage(file) ? file : null)
  const [open, setOpen] = useState(false)
  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${file.filename}`}
        className="block aspect-square w-full cursor-pointer overflow-hidden rounded-[10px] border border-line bg-fill2 p-0"
      >
        {isImage(file) && url && !failed
          ? <img src={url} alt="" className="h-full w-full object-cover" />
          : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-[4px] px-[6px] text-mut">
              <FileGlyph file={file} size={22} />
              <span className="w-full truncate font-meta text-[10.5px]">{file.filename}</span>
            </span>
          )}
      </button>
      <span className="mt-[3px] block truncate font-meta text-[10.5px] text-faint">{fmtFileSize(file.sizeBytes)}</span>
      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${file.filename}`}
          className="absolute right-[-6px] top-[-6px] flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-full border border-line bg-white text-mut shadow-[0_1px_3px_rgba(20,24,27,.18)]"
        >
          <X size={13} strokeWidth={2.2} />
        </button>
      )}
      {open && <FilePreview file={file} onClose={() => setOpen(false)} />}
    </li>
  )
}
