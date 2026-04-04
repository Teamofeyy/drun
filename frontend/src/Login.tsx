import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from './api'

export function Login() {
  const nav = useNavigate()
  const [user, setUser] = useState('admin')
  const [pass, setPass] = useState('admin')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      const r = await api.login(user, pass)
      setToken(r.token)
      nav('/app')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="panel narrow">
      <h1>InfraHub</h1>
      <p className="muted">Вход в панель (JWT). По умолчанию admin / admin.</p>
      <form onSubmit={onSubmit} className="stack">
        <label>
          Логин
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {err && <p className="error">{err}</p>}
        <button type="submit" disabled={loading}>
          {loading ? '…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
