// Notifications - the client half of Secondary Feature 2.11, and the channel
// 2.3 (low supply), 2.4 (announcements) and 2.9 (smart lock) deliver through.
//
// The in-app inbox works today. Browser push is a second delivery of the same
// rows and needs VAPID keys the Client hasn't supplied - see registerPush()
// below and PushChannel in app/server/notifications.ts.

import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './api'
import { queryClient } from './queryClient'

export type NotificationKind =
  | 'low_stock'
  | 'announcement'
  | 'approval_request'
  | 'approval_result'
  | 'input_logged'
  | 'collection_due'
  | 'smart_lock'
  | 'system'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string | null
  link: string | null
  tbl: string | null
  recordId: string | null
  createdAt: string
  readAt: string | null
}

export const notificationsKey = ['notifications'] as const

/** The inbox, polled on the same 20s cadence as the rest of the app so a
 * notification raised by someone else's action shows up without a refresh. */
export function useNotifications() {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: () => api<{ rows: AppNotification[]; unread: number }>('/notifications'),
    refetchInterval: 20_000,
  })
}

export function useMarkRead() {
  return useMutation({
    mutationFn: (arg: { ids?: string[]; all?: boolean }) =>
      api('/notifications/read', { method: 'POST', body: arg }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationsKey }),
  })
}

/**
 * Registers this browser for push delivery.
 *
 * Deliberately inert until the Client's VAPID public key is configured: without
 * it `PushManager.subscribe` cannot produce a usable subscription, and calling
 * it would only produce a permission prompt the user gets nothing from. Set
 * VITE_VAPID_PUBLIC_KEY and add the matching private key as a Pages secret, then
 * implement PushChannel.send on the server - no caller changes.
 *
 * Returns false when push isn't available or isn't configured, so the UI can
 * quietly stay with the in-app inbox.
 */
export async function registerPush(): Promise<boolean> {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
  if (!key) return false
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (Notification.permission === 'denied') return false
  if (Notification.permission === 'default' && (await Notification.requestPermission()) !== 'granted') {
    return false
  }
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    })
    const raw = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    await api('/notifications/subscribe', { method: 'POST', body: raw })
    return true
  } catch {
    return false
  }
}

function urlBase64ToUint8Array(base64: string) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/** Coarse relative time - good enough for an inbox, and avoids pulling a
 * formatting dependency in for one label. */
export function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}
