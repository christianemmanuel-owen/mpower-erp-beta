// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AnnouncementsCard from './AnnouncementsCard'
import { repos } from '../../data/repo'
import type { Announcement } from '../../data/types'

/**
 * Secondary Feature 2.4. Editing keeps the original author and date, and
 * deleting is deliberate - an expired notice is hidden rather than removed
 * precisely because people ask what it said afterwards.
 */

const post = (over: Partial<Announcement> = {}): Announcement => ({
  id: 'a1', title: 'Diesel price change', body: 'Up ₱1.20 from Monday.',
  postedBy: 'seat9', postedByName: 'Ramon Cruz', pinned: false,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', ...over,
} as Announcement)

let POSTS: Announcement[] = []
let IS_ADMIN = true

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ seat: { id: 'seat1', name: 'Admin', isAdmin: IS_ADMIN, modules: [] } }),
}))
vi.mock('../../lib/data', () => ({ useTable: () => POSTS }))
vi.mock('../../data/repo', () => ({
  repos: { announcements: { add: vi.fn(), update: vi.fn(), remove: vi.fn() } },
}))

beforeEach(() => { vi.clearAllMocks(); POSTS = [post()]; IS_ADMIN = true })
afterEach(cleanup)

const renderCard = (composing = false) =>
  render(<AnnouncementsCard composing={composing} onCloseCompose={vi.fn()} />)

describe('AnnouncementsCard', () => {
  it('lets an admin edit a post without rewriting who posted it', () => {
    renderCard()
    fireEvent.click(screen.getByLabelText(/edit "Diesel price change"/i))
    fireEvent.change(screen.getByDisplayValue('Diesel price change'), { target: { value: 'Diesel price held' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    expect(repos.announcements.update).toHaveBeenCalledWith('a1', {
      title: 'Diesel price held',
      body: 'Up ₱1.20 from Monday.',
      // Both reach fields go every time, empty included - see the note in post().
      audienceModules: [],
      expiresAt: '',
    })
    // postedBy / postedByName / createdAt are absent: an edit must not
    // reattribute the notice to whoever happened to fix a typo.
    const payload = vi.mocked(repos.announcements.update).mock.calls[0][1]
    expect(payload).not.toHaveProperty('postedBy')
    expect(payload).not.toHaveProperty('postedByName')
  })

  it('asks before deleting, and does nothing until confirmed', () => {
    renderCard()
    fireEvent.click(screen.getByLabelText(/edit "Diesel price change"/i))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(repos.announcements.remove).not.toHaveBeenCalled()
    expect(screen.getByText(/delete for good\?/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(repos.announcements.remove).toHaveBeenCalledWith('a1')
  })

  it('lets you back out of a delete', () => {
    renderCard()
    fireEvent.click(screen.getByLabelText(/edit "Diesel price change"/i))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    fireEvent.click(screen.getByRole('button', { name: /keep/i }))
    expect(screen.queryByText(/delete for good\?/i)).toBeNull()
    expect(repos.announcements.remove).not.toHaveBeenCalled()
  })

  it('posts a new one when the dialog is opened from the top bar', () => {
    renderCard(true)
    fireEvent.change(screen.getByPlaceholderText(/diesel price change from monday/i), { target: { value: 'Depot closed Saturday' } })
    fireEvent.click(screen.getByRole('button', { name: /post to the board/i }))
    expect(repos.announcements.add).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Depot closed Saturday', pinned: false, postedByName: 'Admin',
    }))
  })

  it('sends an empty audience on edit, so a restriction can be lifted', () => {
    // Update is a merge server-side and JSON.stringify drops undefined keys, so
    // an audience cleared as `undefined` would leave the old one standing and
    // the notice would stay restricted with nothing on screen saying so.
    // Relative, not a fixed date. This was '2026-09-01T15:59:59.000Z', which
    // the card correctly filtered out of the list the moment that day passed -
    // so the row, and its edit control, stopped existing and the test failed on
    // a calendar change rather than a code change. All this case needs is a
    // post that has SOME expiry, so the dialog has one to clear.
    const stillLive = new Date(Date.now() + 7 * 86_400_000).toISOString()
    POSTS = [post({ audienceModules: ['sales'], expiresAt: stillLive })]
    renderCard()
    fireEvent.click(screen.getByLabelText(/edit "Diesel price change"/i))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sales' }))
    fireEvent.change(screen.getByLabelText(/hide after/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    const payload = vi.mocked(repos.announcements.update).mock.calls[0][1]
    expect(payload.audienceModules).toEqual([])
    expect(payload.expiresAt).toBe('')
  })

  it('prefills the dialog with the audience and expiry a post already has', () => {
    POSTS = [post({ audienceModules: ['sales', 'collection'] })]
    renderCard()
    fireEvent.click(screen.getByLabelText(/edit "Diesel price change"/i))
    expect(screen.getByRole('checkbox', { name: 'Sales' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox', { name: 'Collect' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox', { name: 'Stock' }).getAttribute('aria-checked')).toBe('false')
  })

  it('omits the reach fields entirely on a post that sets neither', () => {
    renderCard(true)
    fireEvent.change(screen.getByPlaceholderText(/diesel price change from monday/i), { target: { value: 'Depot closed Saturday' } })
    fireEvent.click(screen.getByRole('button', { name: /post to the board/i }))
    const payload = vi.mocked(repos.announcements.add).mock.calls[0][0]
    expect(payload).not.toHaveProperty('audienceModules')
    expect(payload).not.toHaveProperty('expiresAt')
  })

  it('carries a chosen audience onto a new post', () => {
    renderCard(true)
    fireEvent.change(screen.getByPlaceholderText(/diesel price change from monday/i), { target: { value: 'Tanker delayed' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trips' }))
    fireEvent.click(screen.getByRole('button', { name: /post to the board/i }))
    expect(repos.announcements.add).toHaveBeenCalledWith(expect.objectContaining({
      audienceModules: ['logistics'],
    }))
  })

  it('names the audience on the board the way the sidebar names it', () => {
    POSTS = [post({ audienceModules: ['collection', 'logistics'] })]
    renderCard()
    // Not "collection, logistics" - a reader has to match this against the nav.
    expect(screen.getByText(/Collect, Trips only/)).toBeTruthy()
  })

  it('does not silently cut the board off', () => {
    POSTS = Array.from({ length: 7 }, (_, i) => post({ id: `a${i}`, title: `Notice ${i}` }))
    renderCard()
    expect(screen.queryByText('Notice 6')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /show all 7/i }))
    expect(screen.getByText('Notice 6')).toBeTruthy()
  })

  it('gives a non-admin no way to edit or delete', () => {
    IS_ADMIN = false
    renderCard()
    expect(screen.queryByLabelText(/edit "Diesel price change"/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
    // The board itself is still readable.
    expect(screen.getByText('Diesel price change')).toBeTruthy()
  })

  it('does not open the compose dialog for a non-admin, even if asked to', () => {
    IS_ADMIN = false
    renderCard(true)
    expect(screen.queryByRole('button', { name: /post to the board/i })).toBeNull()
  })
})
