import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import '../src/index.css'
import App from '../src/App'
import { queryClient } from '../src/lib/queryClient'
import { makeDemoData } from '../src/data/seed'
const demo = makeDemoData() as Record<string, any[]>
const crew = location.search.includes('crew')
const collector = location.search.includes('collector')
const seat = crew
  ? { id: 'seat1', createdAt: '', updatedAt: '', name: 'Efren Garcia', username: 'efren', role: 'Driver', isAdmin: false, scope: 'own', modules: ['logistics'] }
  : collector
    // Personnel id is filled in below, once the demo staff exist, so the
    // collector's own installments are the ones that reach the screen.
    ? { id: 'seat1', createdAt: '', updatedAt: '', name: 'Dina Cruz', username: 'dina', role: 'Office', isAdmin: false, scope: 'own', modules: ['collection'], personnelId: '' }
    : { id: 'seat1', createdAt: '', updatedAt: '', name: 'Ramon Reyes', username: 'ramon', role: 'Owner', isAdmin: true, modules: [] }
if (collector) {
  const dina = demo.personnel.find((p) => p.name === 'Dina Cruz') ?? demo.personnel[0]
  seat.personnelId = dina.id
  seat.name = dina.name
  // The demo assigns collectors on the sale, so point a good spread of work at
  // this one rather than whatever the seed happened to give her.
  demo.sales.slice(0, 40).forEach((s, i) => { if (i % 2 === 0) s.collectorId = dina.id })
}
localStorage.setItem('erp-token', 'preview')
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
// A planned-stage trip for tomorrow, so the drawer opens on the plan stage.
const d = demo.deliveries.find((x) => x.status === 'scheduled') ?? demo.deliveries[0]
d.scheduleTime = '08:00'; d.deliveryAddress = 'Calamba, Laguna'
;(window as any).__edit = d.id
// A trip out for delivery, for the crew screen.
const it = demo.deliveries.find((x) => x.status === 'in_transit')
if (it) { it.scheduleDate = new Date().toISOString(); it.deliveryAddress = 'Wawa, Montalban'; it.documents = { ...(it.documents ?? {}), deliveryReceipt: { referenceNo: 'DR-2026-00187' } } }
const slots = [['09:00', 2, 'Cubao, Quezon City'], ['10:00', 1.5, 'Marikina'], ['19:00', 2.5, 'San Pedro, Laguna']] as const
slots.forEach(([t, h, a], i) => demo.deliveries.push({ ...d, id: 'clone' + i, scheduleTime: t, durationHours: h, deliveryAddress: a, travelEstimate: undefined }))
const line = (a: [number, number], b: [number, number], wob = 0): [number, number][] =>
  Array.from({ length: 12 }, (_, i) => { const t = i / 11; return [a[0] + (b[0] - a[0]) * t + Math.sin(t * Math.PI) * wob, a[1] + (b[1] - a[1]) * t] })
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const path = url.replace(/^.*\/api/, '').split('?')[0]
  if (path === '/me') return ok(seat)
  if (path === '/route-estimate') {
    await new Promise((r) => setTimeout(r, 200))
    const o: [number, number] = [14.62, 121.03], t: [number, number] = [14.21, 121.16]
    return ok({ provider: 'osrm', from: 'depot', to: 'x', origin: { lat: o[0], lng: o[1], label: 'Depot' }, destination: { lat: t[0], lng: t[1], label: 'Calamba' }, at: new Date().toISOString(),
      routes: [{ minutes: 76, km: 58.2, summary: 'via SLEX', line: line(o, t) }, { minutes: 94, km: 61.7, summary: 'via Sucat', line: line(o, t, 0.08) }, { minutes: 102, km: 55.9, summary: 'via Daang Hari', line: line(o, t, -0.08) }] })
  }
  if (path === '/geocode') return ok({ lat: 14.21, lng: 121.16, label: 'Calamba' })
  if (path.startsWith('/attachments')) return ok({ rows: [] })
  if (path.startsWith('/approvals')) return ok({ rows: [], pendingCount: 0 })
  if (path.startsWith('/audit')) return ok({ rows: [], total: 0, limit: 25, offset: 0 })
  if ((init?.method ?? 'GET') !== 'GET') return ok({})
  return ok(demo[path.slice(1)] ?? [])
}
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><App /></BrowserRouter></QueryClientProvider></StrictMode>)
