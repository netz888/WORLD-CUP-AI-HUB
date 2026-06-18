"use client"

type Axis = { label: string; home: number; away: number }

type RadarCompareProps = {
  axes: Axis[]
  homeName?: string
  awayName?: string
  className?: string
}

/**
 * Dependency-free SVG radar chart comparing two teams across N dimensions.
 * Values are expected on a 0-100 scale.
 */
export function RadarCompare({ axes, homeName, awayName, className }: RadarCompareProps) {
  const size = 260
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 38
  const n = axes.length
  const levels = 4

  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2

  const pointFor = (i: number, value: number) => {
    const r = (value / 100) * radius
    const a = angleFor(i)
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  }

  const polygon = (key: "home" | "away") =>
    axes.map((ax, i) => pointFor(i, ax[key]).join(",")).join(" ")

  return (
    <div className={`flex flex-col items-center gap-3${className ? ` ${className}` : ""}`}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-auto w-full max-w-[300px]"
        role="img"
        aria-label="两队实力雷达对比"
      >
        {/* grid rings */}
        {Array.from({ length: levels }).map((_, l) => {
          const r = (radius * (l + 1)) / levels
          const pts = axes
            .map((_, i) => {
              const a = angleFor(i)
              return [cx + r * Math.cos(a), cy + r * Math.sin(a)].join(",")
            })
            .join(" ")
          return (
            <polygon
              key={l}
              points={pts}
              fill="none"
              stroke="oklch(1 0 0 / 8%)"
              strokeWidth={1}
            />
          )
        })}

        {/* spokes + labels */}
        {axes.map((ax, i) => {
          const [ex, ey] = pointFor(i, 100)
          const lr = radius + 18
          const a = angleFor(i)
          const lx = cx + lr * Math.cos(a)
          const ly = cy + lr * Math.sin(a)
          return (
            <g key={ax.label}>
              <line
                x1={cx}
                y1={cy}
                x2={ex}
                y2={ey}
                stroke="oklch(1 0 0 / 8%)"
                strokeWidth={1}
              />
              <text
                x={lx}
                y={ly}
                fill="oklch(0.68 0.03 255)"
                fontSize={10}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {ax.label}
              </text>
            </g>
          )
        })}

        {/* away polygon (accent/gold) */}
        <polygon
          points={polygon("away")}
          fill="oklch(0.82 0.16 85 / 18%)"
          stroke="oklch(0.82 0.16 85)"
          strokeWidth={2}
          className="animate-float-up"
        />
        {/* home polygon (primary/green) */}
        <polygon
          points={polygon("home")}
          fill="oklch(0.85 0.21 145 / 20%)"
          stroke="oklch(0.85 0.21 145)"
          strokeWidth={2}
          className="animate-float-up"
        />
      </svg>

      {(homeName || awayName) && (
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            {homeName}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
            {awayName}
          </span>
        </div>
      )}
    </div>
  )
}
