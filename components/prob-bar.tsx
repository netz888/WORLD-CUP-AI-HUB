import { cn } from "@/lib/utils"

type Props = {
  homeWin: number
  draw: number
  awayWin: number
  className?: string
}

export function ProbBar({ homeWin, draw, awayWin, className }: Props) {
  return (
    <div className={cn("space-y-2", className)}>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`胜负概率：主胜 ${homeWin}%，平局 ${draw}%，客胜 ${awayWin}%`}
      >
        <div
          className="animate-bar h-full bg-primary"
          style={{ width: `${homeWin}%` }}
        />
        <div
          className="animate-bar h-full bg-muted-foreground/40"
          style={{ width: `${draw}%` }}
        />
        <div
          className="animate-bar h-full bg-accent"
          style={{ width: `${awayWin}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] font-medium">
        <span className="flex items-center gap-1 text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          主胜 {homeWin}%
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          平 {draw}%
        </span>
        <span className="flex items-center gap-1 text-accent">
          客胜 {awayWin}%
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
      </div>
    </div>
  )
}
