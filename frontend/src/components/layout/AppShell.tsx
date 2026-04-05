import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  children: ReactNode
  title?: string
  subtitle?: string
  actions?: ReactNode
  /** Ссылка слева в шапке (например «Назад») */
  leading?: ReactNode
  className?: string
}

export function AppShell({
  children,
  title,
  subtitle,
  actions,
  leading,
  className,
}: Props) {
  return (
    <div className={cn('min-h-svh bg-background', className)}>
      <div className="mx-auto max-w-[1360px] px-5 py-3 md:px-6">
        {(title || actions || leading) && (
          <header className="mb-3 flex flex-col gap-2 border-b border-border/70 pb-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              {leading && (
                <div className="mb-1 text-sm text-muted-foreground">
                  {leading}
                </div>
              )}
              {title && (
                <h1 className="text-xl font-semibold tracking-tight">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="max-w-3xl text-sm text-muted-foreground leading-relaxed">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {actions}
              </div>
            )}
          </header>
        )}
        {children}
      </div>
    </div>
  )
}
