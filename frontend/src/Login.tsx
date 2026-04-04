import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from './api'

export function Login() {
  const nav = useNavigate()
  const [user, setUser] = useState('admin')
  const [pass, setPass] = useState('admin')

  const login = useMutation({
    mutationFn: () => api.login(user, pass),
    onSuccess: (data) => {
      setToken(data.token)
      nav('/app')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    login.mutate()
  }

  return (
    <div className="panel narrow">
      <h1>InfraHub</h1>
      <p className="muted">Вход в панель. По умолчанию admin / admin.</p>
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
        {login.isError && (
          <p className="error">
            {login.error instanceof Error
              ? login.error.message
              : 'Не удалось войти'}
          </p>
        )}
        <button type="submit" disabled={login.isPending}>
          {login.isPending ? '…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
