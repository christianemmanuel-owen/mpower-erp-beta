# MPower Diesel Trading — ERP

ERP for a diesel trading company (IBM Plex Sans, dark rail navigation, teal accent). Screens: Home, Stock, Sales, Collect, Accounts, Trips (with simulated GPS truck tracking), HR, Admin — with per-seat logins and module access.

Specs: `../docs/superpowers/specs/2026-07-12-erp-prototype-design.md`, `../docs/superpowers/specs/2026-07-19-hr-module-design.md`, `../docs/superpowers/specs/2026-07-21-collection-module-design.md`

**Collection module** (receivables): every pending sale installment in one queue — table with inline mark-collected/cancel and collector assignment, the kanban board (moved from Sales), a receivables-only cash-flow calendar, per-customer outstanding balances with AR aging buckets (1–30/31–60/61–90/90+), and workload per collector. Person in charge and receiving bank account resolve per installment with a sale-level default (`installmentCollector`/`installmentBankAccount` in `src/lib/metrics.ts`); customers can carry a separate collection address. "Overdue" stays derived, never stored.

**HR module** (PH-specific payroll): attendance encoding with shifts, leaves with balances, the 2026 holiday calendar (Proclamation 1006), and snapshot payroll runs — OT/night-diff/rest-day/holiday premiums per DOLE multipliers, SSS/PhilHealth/Pag-IBIG and BIR TRAIN withholding from editable tables (HR → Setup, admin-only), commissions from Sales, 13th-month report, printable payslips. The payroll math lives in `src/lib/payroll.ts` (pure functions, unit-tested); official table values in `src/data/statutory.ts`. Employee records extend the same `personnel` table Trips uses; the API hides pay fields from seats without HR access.

**Infrastructure layers** (added 2026-08-20, see `../docs/superpowers/specs/2026-08-20-infrastructure-gap-analysis.md`) — the cross-cutting pieces most Exhibit A line items depend on:

| Layer | Exhibit A | Where |
|---|---|---|
| Uploaded digital copies (R2) | 1.2–1.5, 1.9 | `server/attachments.ts`, `src/lib/attachments.ts`, `src/components/DocumentUpload.tsx` |
| Document reference numbering | 1.2, 1.3, 1.5, 1.6 | `server/refs.ts` |
| Staff input history | 2.2 | `server/audit.ts`, `src/modules/settings/InputHistory.tsx` |
| Approval-based inputs | 2.1 | `server/approvals.ts`, `src/modules/settings/Approvals.tsx` |
| Notifications + push | 2.11 (and 2.3, 2.4, 2.9) | `server/notifications.ts`, `src/components/NotificationBell.tsx` |
| Printable documents | 1.9, 2.6 | `src/lib/printDoc.ts` |
| Spreadsheet export | 2.12 | `src/lib/exportXlsx.ts` |

The design point that keeps the rest of the app untouched: **a pending input is not a record with `status: 'pending'`.** It is parked server-side in the `approvals` table and only written into `records` when someone approves it. So no read path — stock on hand, receivables, quota attainment, payroll commission — needs to know the feature exists. A screen whose table can require approval only has to check `isPending(result)` (`src/lib/approvals.ts`) instead of assuming a write returned a record.

## Architecture

- **Frontend:** React + Vite single-page app.
- **Backend:** one Cloudflare Pages Function (`functions/api/[[path]].ts`) routing `/api/*`, over shared modules in `server/` (which sits outside `functions/` because everything inside `functions/` is a route).
- **Database:** Cloudflare D1 (`schema.sql`). Business records are JSON documents keyed by `(tbl, id)`; the client owns the shapes (`src/data/types.ts`). The infrastructure tables — `attachments`, `audit_log`, `approvals`, `notifications`, `push_subscriptions`, `counters` — are real indexed tables instead, because they're queried by time, actor, target and unread-state rather than read whole.
- **Documents:** Cloudflare R2 (`DOCS` binding). Downloads are proxied through the API, so a document inherits exactly the seat guard of the record it hangs off.
- **Data layer:** all reads go through react-query hooks (`src/lib/data.ts`, polling every 20s so everyone sees everyone's edits), all writes through `src/data/repo.ts`.
- **Auth:** username/password per seat, hashed server-side, bearer-token sessions (30 days). Admin seats manage seats; other seats see only their assigned modules. See `src/lib/auth.tsx` + the seats guards in the API function.
- GPS tracking uses the `TrackingProvider` interface (`src/modules/logistics/tracking.ts`). The prototype ships `SimulatedTrackingProvider`; a real telematics feed implements the same interface in production.

## First-time Cloudflare setup

One-time, from `app/` (needs a Cloudflare account; `npx wrangler login` first):

```bash
npx wrangler d1 create erp-mvp          # 1. create the database
# → copy the database_id it prints into wrangler.toml

npx wrangler r2 bucket create erp-mvp-docs   # 2. bucket for uploaded digital copies

npm run db:remote                       # 3. apply schema.sql to the real D1 (creates the admin/admin login)

npm run deploy                          # 4. build + create the Pages project and deploy
```

Then open the deployed URL, sign in with **admin / admin**, and **change the password immediately** (Admin → Seats). If this browser still has data from the old local-only version, an admin sees a one-click **"Publish data"** banner that uploads it into D1 for the whole team. Otherwise, Admin → "Reset demo data" fills D1 with the demo dataset, or just start entering real records.

To give your client access: create a seat for them (Admin → Seats, tick the modules they should see) and send them the URL + their username/password.

`schema.sql` is entirely `IF NOT EXISTS`, so `npm run db:remote` is safe to re-run against a live database — that is how the infrastructure tables are added to a deployment that predates them. Until the R2 bucket exists, uploads return a clear "document storage isn't configured" message rather than failing oddly; everything else works.

Subsequent deploys are just `npm run deploy` (or connect the repo in the Cloudflare dashboard: build command `npm run build`, output `dist`, root directory `app`).

## Run locally

Two terminals, both from `app/`:

```bash
npm install
npm run build && npm run db:local && npm run dev:api   # terminal 1 — API + local D1 on :8788
npm run dev                                            # terminal 2 — Vite dev server, proxies /api to :8788
```

Sign in with admin / admin (local D1 state lives in `.wrangler/`, wiped by deleting that folder + rerunning `npm run db:local`).

## Test and build

```bash
npx vitest run   # unit tests (metrics, demo data, auth)
npm run build    # typecheck (app + functions) + production build to dist/
```

`public/_redirects` handles SPA routing.
# mpower-erp
# mpower-erp-beta
# mpower-erp-beta
