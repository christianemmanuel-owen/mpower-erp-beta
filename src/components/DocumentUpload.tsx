import { useRef, useState } from 'react'
import { Download, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  downloadAttachment, fmtFileSize, slotLabel, useAttachments, useDeleteAttachment,
  useSetAttachmentReference, useUploadAttachment, type Attachment,
} from '../lib/attachments'
import { fmtDate } from '../lib/format'
import { Input } from './ui'
import FilePreview, { FileThumb } from './FilePreview'

/**
 * The uploaded-digital-copy control (Exhibit A 1.2, 1.3, 1.4, 1.5).
 *
 * One component for all fourteen places the spec asks for "reference number and
 * uploaded digital copy of ...". Give it the owning record and a list of
 * document slots; it lists what is filed and where the gaps are.
 *
 * It used to draw a bordered card per slot, each holding a grey block, each
 * holding a bordered thumbnail and a bordered input - four surfaces around one
 * file, and three empty cards to report that nothing had been uploaded yet. It
 * is one list now: a heading per document type, a row per file.
 *
 * Slots are validated server-side against SLOTS in app/server/attachments.ts, so
 * a typo here fails loudly at upload rather than silently creating a new
 * document type nobody configured.
 */
export default function DocumentUpload({ tbl, recordId, slots, readOnly, showReference = true }: {
  tbl: string
  recordId: string
  /** Which documents belong on this record, in the order they should appear. */
  slots: readonly string[]
  readOnly?: boolean
  /** Hide the reference-number field for documents that don't carry one. */
  showReference?: boolean
}) {
  const { data: rows, isLoading, error } = useAttachments(tbl, recordId)
  const upload = useUploadAttachment(tbl, recordId)
  const remove = useDeleteAttachment(tbl, recordId)

  if (isLoading) return <p className="m-0 py-3 font-meta text-[12px] text-mut">Loading documents…</p>
  if (error) {
    return <p className="m-0 py-3 font-meta text-[12px] text-redtext">Couldn’t load documents - {(error as Error).message}</p>
  }

  const bySlot = new Map<string, Attachment[]>()
  for (const row of rows ?? []) {
    bySlot.set(row.slot, [...(bySlot.get(row.slot) ?? []), row])
  }

  return (
    <div className="overflow-hidden rounded-[8px] border border-line">
      {slots.map((slot) => (
        <SlotGroup
          key={slot}
          slot={slot}
          files={bySlot.get(slot) ?? []}
          readOnly={readOnly}
          showReference={showReference}
          busy={upload.isPending}
          onUpload={(file) => upload.mutate({ file, slot })}
          onRemove={(id) => remove.mutate(id)}
          tbl={tbl}
          recordId={recordId}
        />
      ))}
      {upload.error && (
        <p className="m-0 border-t border-linesoft px-[12px] py-[8px] font-meta text-[12px] font-semibold text-redtext">
          {(upload.error as Error).message}
        </p>
      )}
    </div>
  )
}

/**
 * One document type, and everything filed under it.
 *
 * A slot holds a list, not a file - the API appends on every upload and always
 * has. The button used to say "Replace" once something was filed, which was
 * simply untrue: the second scan of a two-page purchase order joined the first
 * rather than displacing it. It says Add, and both pages are listed.
 */
function SlotGroup({ slot, files, readOnly, showReference, busy, onUpload, onRemove, tbl, recordId }: {
  slot: string
  files: Attachment[]
  readOnly?: boolean
  showReference: boolean
  busy: boolean
  onUpload: (file: File) => void
  onRemove: (id: string) => void
  tbl: string
  recordId: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function take(list: FileList | null) {
    // Several at once: a delivery receipt photographed front and back is two
    // files of one document, and asking for two trips through the picker to
    // file them is a needless one.
    for (const file of Array.from(list ?? [])) onUpload(file)
  }

  return (
    <div
      onDragOver={(e) => { if (!readOnly) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (readOnly) return
        e.preventDefault()
        setDragging(false)
        take(e.dataTransfer.files)
      }}
      className={`border-b border-line transition-colors last:border-0 ${dragging ? 'bg-tealbadge' : ''}`}
    >
      <div className="flex items-center gap-[10px] bg-paper px-[12px] py-[7px]">
        <p className="m-0 font-meta text-[10px] font-semibold uppercase tracking-[.09em] text-mut">
          {slotLabel(slot)}
        </p>
        {files.length > 1 && (
          <span className="font-meta text-[12px] text-faint">{files.length} files</span>
        )}
        {files.length === 0 && (
          <span className="font-meta text-[12px] text-faint">
            {dragging ? 'Release to upload' : 'Not on file'}
          </span>
        )}
        {!readOnly && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,image/*,.xlsx,.docx"
              onChange={(e) => { take(e.target.files); e.target.value = '' }}
            />
            {/* Ghost, not the ink primary it used to be: on a form whose main
                action is Save, attaching a scan should not outrank it. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="ml-auto flex h-[26px] shrink-0 cursor-pointer items-center gap-[4px] rounded-[6px] border border-inputline bg-white px-[9px] font-meta text-[12px] font-semibold text-lab transition-colors hover:bg-fill2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} strokeWidth={2} />}
              {files.length ? 'Add' : 'Upload'}
            </button>
          </>
        )}
      </div>

      {files.map((f) => (
        <FileRow
          key={f.id}
          file={f}
          readOnly={readOnly}
          showReference={showReference}
          onRemove={() => onRemove(f.id)}
          tbl={tbl}
          recordId={recordId}
        />
      ))}
    </div>
  )
}

/** One filed document: what it is, what is known about it, what you can do with it. */
function FileRow({ file, readOnly, showReference, onRemove, tbl, recordId }: {
  file: Attachment
  readOnly?: boolean
  showReference: boolean
  onRemove: () => void
  tbl: string
  recordId: string
}) {
  const setRef = useSetAttachmentReference(tbl, recordId)
  const [ref, setRefValue] = useState(file.referenceNo ?? '')
  const [preview, setPreview] = useState(false)

  return (
    <div className="flex items-center gap-[10px] border-t border-linesoft px-[12px] py-[8px]">
      <FileThumb file={file} onClick={() => setPreview(true)} />

      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setPreview(true)}
          title={file.filename}
          className="block max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-ink hover:underline"
        >
          {file.filename}
        </button>
        <span className="mt-[1px] block font-meta text-[12px] text-mut">
          {fmtFileSize(file.sizeBytes)} · {fmtDate(file.uploadedAt)}
        </span>
      </span>

      {showReference && (
        <span className="w-[168px] shrink-0">
          <Input
            value={ref}
            disabled={readOnly}
            placeholder="Reference no."
            aria-label={`Reference number for ${file.filename}`}
            onChange={(e) => setRefValue(e.target.value)}
            onBlur={() => {
              if (ref !== (file.referenceNo ?? '')) setRef.mutate({ id: file.id, referenceNo: ref })
            }}
          />
        </span>
      )}

      <span className="flex shrink-0 items-center gap-[2px]">
        <button
          type="button"
          onClick={() => { void downloadAttachment(file) }}
          title="Download"
          aria-label={`Download ${file.filename}`}
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-ink"
        >
          <Download size={14} strokeWidth={1.8} />
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove this document"
            aria-label={`Remove ${file.filename}`}
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-mut transition-colors hover:bg-fill2 hover:text-redtext"
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        )}
      </span>

      {preview && <FilePreview file={file} onClose={() => setPreview(false)} />}
    </div>
  )
}
