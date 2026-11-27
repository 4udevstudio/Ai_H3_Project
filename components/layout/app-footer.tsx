import { APP_CREDIT, APP_NAME } from '@/lib/app-config'

export function AppFooter() {
  return (
    <footer className="studio-footer shrink-0 border-t border-border px-4 py-3 text-center text-[11px] text-muted-foreground sm:px-6">
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span className="font-heading text-xs font-semibold tracking-wide text-foreground">{APP_NAME}</span>
        <span aria-hidden="true">·</span>
        <span>{APP_CREDIT}</span>
      </p>
    </footer>
  )
}
