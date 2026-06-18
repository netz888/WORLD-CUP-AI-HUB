"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarDays, LayoutGrid, BarChart3, Trophy, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { LiveTicker } from "@/components/live-ticker"
import { BallMark } from "@/components/ball-mark"
import { AmbientBg } from "@/components/ambient-bg"
import { GithubButton } from "@/components/github-button"
import { GITHUB_REPO_URL } from "@/lib/github-config"

const NAV = [
  { href: "/", label: "赛程", icon: CalendarDays },
  { href: "/groups", label: "小组", icon: LayoutGrid },
  { href: "/champions", label: "夺冠榜", icon: Trophy },
  { href: "/rankings", label: "数据", icon: BarChart3 },
]

export function SiteShell({
  children,
  stars,
}: {
  children: React.ReactNode
  stars: number | null
}) {
  const pathname = usePathname()
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" || pathname.startsWith("/match") : pathname.startsWith(href)

  return (
    <div className="relative min-h-dvh pitch-grid">
      <AmbientBg />

      <header
        className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl"
        style={{ viewTransitionName: "persistent-nav" }}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="group flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <BallMark className="h-6 w-6 transition-transform duration-700 group-hover:rotate-180" />
            </span>
            <span className="flex flex-col leading-none">
              <span className="font-heading text-lg font-700 tracking-tight">
                WORLD CUP <span className="text-primary text-glow">AI</span> HUB
              </span>
              <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                AI 预测 · 实时分析
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "press flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-primary" />
              <span className="sm:hidden">opus4.8</span>
              <span className="hidden sm:inline">opus4.8 实时预测</span>
            </div>
            <GithubButton href={GITHUB_REPO_URL} stars={stars} />
          </div>
        </div>

        <LiveTicker />
      </header>

      <main className="animate-page-enter mx-auto max-w-6xl px-4 pb-28 pt-6 md:pb-12">
        {children}
      </main>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "press flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-full transition-colors",
                    active && "bg-primary/15",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                {item.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
