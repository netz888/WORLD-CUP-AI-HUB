import type { Lineup, Team } from "@/lib/data"
import { TeamFlag } from "@/components/team-flag"

export function Pitch({
  team,
  lineup,
  accent = "primary",
}: {
  team: Team
  lineup: Lineup
  accent?: "primary" | "accent"
}) {
  const dot =
    accent === "primary"
      ? "bg-primary text-primary-foreground"
      : "bg-accent text-accent-foreground"

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TeamFlag code={team.code} size="sm" />
          <span className="text-sm font-bold">{team.name}</span>
        </div>
        <span className="rounded-md bg-secondary px-2 py-0.5 font-heading text-xs font-700 tracking-wide">
          {lineup.formation}
        </span>
      </div>

      <div
        className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-border"
        style={{
          background:
            "linear-gradient(0deg, oklch(0.42 0.11 150) 0%, oklch(0.46 0.12 150) 100%)",
        }}
      >
        {/* mowing stripes */}
        <div className="pointer-events-none absolute inset-0 opacity-40">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={i % 2 === 0 ? "bg-white/5" : ""}
              style={{ position: "absolute", top: `${(i / 6) * 100}%`, height: `${100 / 6}%`, left: 0, right: 0 }}
            />
          ))}
        </div>

        {/* pitch markings */}
        <svg
          viewBox="0 0 100 133"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full text-white/35"
        >
          <rect x="3" y="3" width="94" height="127" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <line x1="3" y1="66.5" x2="97" y2="66.5" stroke="currentColor" strokeWidth="0.6" />
          <circle cx="50" cy="66.5" r="11" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <circle cx="50" cy="66.5" r="0.8" fill="currentColor" />
          {/* bottom (own) box */}
          <rect x="28" y="111" width="44" height="19" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <rect x="40" y="124" width="20" height="6" fill="none" stroke="currentColor" strokeWidth="0.6" />
          {/* top (attack) box */}
          <rect x="28" y="3" width="44" height="19" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <rect x="40" y="3" width="20" height="6" fill="none" stroke="currentColor" strokeWidth="0.6" />
        </svg>

        {/* players */}
        {lineup.players.map((p, i) => (
          <div
            key={i}
            className="animate-float-up absolute flex -translate-x-1/2 translate-y-[-50%] flex-col items-center"
            style={{
              left: `${p.x}%`,
              top: `${100 - p.y}%`,
              animationDelay: `${i * 40}ms`,
            }}
          >
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-700 shadow-md ring-2 ring-white/30 sm:h-7 sm:w-7 sm:text-xs ${dot}`}
            >
              {p.num}
            </span>
            <span className="mt-0.5 max-w-[3.5rem] truncate rounded bg-black/45 px-1 text-[8px] font-medium leading-tight text-white sm:text-[9px]">
              {p.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
