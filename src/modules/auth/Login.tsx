import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Field, Input } from '../../components/ui'
import logo from '../../assets/logo.png'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Nudge shown only while the bootstrap login is the sole seat in the shared DB.
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api<{ seats: number; records: number }>('/status'),
    refetchInterval: false,
    retry: false,
  })
  const firstRun = status.data?.seats === 1

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const err = await login(username, password)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-6">
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-[16px] bg-white p-8 shadow-[0_20px_60px_rgba(20,28,40,.35)]" style={{ animation: 'popIn .18s ease both' }}>
        <div className="mb-6 flex items-center gap-3">
          <img src={logo} alt="MPower Diesel Trading" className="h-11 w-11 object-contain" />
          <div>
            <p className="m-0 text-[16px] font-semibold">MPower Diesel Trading</p>
            <p className="m-0 text-[12px] text-mut">Sign in to your seat</p>
          </div>
        </div>

        {error && <div className="mb-4 rounded-[10px] border border-redf/30 bg-redbadge p-3 text-[13px] text-redtext">{error}</div>}

        <div className="flex flex-col gap-[14px]">
          <Field label="Username">
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => { setUsername(e.target.value); setError('') }} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} />
          </Field>
        </div>

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="mt-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-inkcard px-[18px] py-[11px] text-[13px] font-semibold text-white hover:bg-inkhov disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogIn size={15} strokeWidth={2} />
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {firstRun && (
          <p className="mb-0 mt-4 text-center text-[12px] text-faint">
            First time here? Sign in with <b>admin / admin</b>, then change the password under Admin → Seats.
          </p>
        )}
      </form>
    </div>
  )
}
