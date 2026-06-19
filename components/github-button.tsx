import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

/** GitHub 品牌标志（lucide 已移除该图标，使用官方 SVG 路径内联） */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.21 11.19.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.37-1.34-1.74-1.34-1.74-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.22 1.84 1.22 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.58-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.12-.3-.54-1.52.12-3.16 0 0 1.01-.32 3.3 1.21a11.6 11.6 0 0 1 3-.4c1.02 0 2.05.13 3 .4 2.29-1.53 3.3-1.21 3.3-1.21.66 1.64.24 2.86.12 3.16.77.83 1.24 1.88 1.24 3.17 0 4.53-2.81 5.53-5.49 5.82.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .31.21.68.83.56A12.02 12.02 0 0 0 24 12.29C24 5.78 18.63.5 12 .5Z" />
    </svg>
  )
}

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return String(n)
}

export function GithubButton({
  href,
  stars,
  className,
}: {
  href: string
  stars: number | null
  className?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="在 GitHub 上查看开源仓库"
      className={cn(
        "press inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-secondary",
        className,
      )}
    >
      <GithubMark className="h-4 w-4" />
      <span className="hidden sm:inline">GitHub</span>
      <span className="h-3 w-px bg-border" aria-hidden="true" />
      <span className="inline-flex h-3.5 items-center gap-1 text-muted-foreground">
        <Star className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" />
        <span className="block h-3.5 leading-[14px] tabular-nums">{stars !== null ? formatStars(stars) : "Star"}</span>
      </span>
    </a>
  )
}
