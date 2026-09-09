// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { usePaged } from './paging'

afterEach(cleanup)

/** Renders the hook and exposes its latest return value. */
function probe<T>(items: T[], pageSize?: number, resetKey?: string) {
  const seen: ReturnType<typeof usePaged<T>>[] = []
  function Probe({ items, resetKey }: { items: T[]; resetKey?: string }) {
    seen.push(usePaged(items, pageSize, resetKey))
    return null
  }
  const view = render(<Probe items={items} resetKey={resetKey} />)
  return { seen, view, last: () => seen[seen.length - 1] }
}

const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('usePaged', () => {
  it('slices to the requested page size', () => {
    const { last } = probe(nums(25), 8)
    expect(last().pageItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(last().totalPages).toBe(4)
    expect(last().total).toBe(25)
  })

  it('returns everything when no page size is given', () => {
    const { last } = probe(nums(25))
    expect(last().pageItems).toHaveLength(25)
    expect(last().totalPages).toBe(1)
  })

  it('clamps a page that no longer exists after the list shrinks', () => {
    // Search while on page 4 and the filtered list may only have one page. Without
    // the clamp the panel renders an empty page and reads as broken.
    const seen: { page: number; items: number[] }[] = []
    function Probe({ items }: { items: number[] }) {
      const p = usePaged(items, 8)
      seen.push({ page: p.page, items: p.pageItems })
      return <button onClick={() => p.setPage(() => 4)}>go</button>
    }
    const view = render(<Probe items={nums(25)} />)
    act(() => { view.container.querySelector('button')!.click() })
    expect(seen[seen.length - 1].page).toBe(4)

    view.rerender(<Probe items={nums(5)} />)
    expect(seen[seen.length - 1].page).toBe(1)
    expect(seen[seen.length - 1].items).toEqual([1, 2, 3, 4, 5])
  })

  it('jumps back to page one when the reset key changes', () => {
    const seen: number[] = []
    function Probe({ resetKey }: { resetKey: string }) {
      const p = usePaged(nums(25), 8, resetKey)
      seen.push(p.page)
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return <button onClick={() => p.setPage(() => 3)}>go</button>
    }
    const view = render(<Probe resetKey="" />)
    act(() => { view.container.querySelector('button')!.click() })
    expect(seen[seen.length - 1]).toBe(3)
    view.rerender(<Probe resetKey="santos" />)
    expect(seen[seen.length - 1]).toBe(1)
  })

  it('never reports a zero page count for an empty list', () => {
    const { last } = probe<number>([], 8)
    expect(last().totalPages).toBe(1)
    expect(last().page).toBe(1)
    expect(last().pageItems).toEqual([])
  })
})
