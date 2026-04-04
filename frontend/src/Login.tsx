import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, setRole, setToken } from './api'

export function Login() {
  const nav = useNavigate()
  const [user, setUser] = useState('admin')
  const [pass, setPass] = useState('admin')

  const login = useMutation({
    mutationFn: () => api.login(user, pass),
    onSuccess: (data) => {
      setToken(data.token)
      setRole((data.role || 'operator').toLowerCase())
      nav('/app')
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    login.mutate()
  }

  return (
    <AppShell>
      <div className="flex min-h-[70vh] items-center justify-center">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl">InfraHub</CardTitle>
            <CardDescription>
              Вход в панель. По умолчанию admin / admin.
            </CardDescription>
          </CardHeader>
          <form onSubmit={onSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="user">Логин</Label>
                <Input
                  id="user"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pass">Пароль</Label>
                <Input
                  id="pass"
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              {login.isError && (
                <p className="text-sm text-destructive">
                  {login.error instanceof Error
                    ? login.error.message
                    : 'Не удалось войти'}
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending ? 'Вход…' : 'Войти'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </AppShell>
  )
}
