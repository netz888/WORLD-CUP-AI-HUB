"use client"

import { useEffect, useState } from "react"

// FIFA World Cup 2026 Final: July 19, 2026 (MetLife Stadium)
const TARGET = new Date("2026-07-19T15:00:00-04:00").getTime()

function diff() {
  const now = Date.now()
  const ms = Math.max(0, TARGET - now)
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return { days, hours, minutes, seconds }
}

export function Countdown({ size = "sm" }: { size?: "sm" | "lg" }) {
  const [t, setT] = useState(diff())
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const id = setInterval(() => setT(diff()), 1000)
    return () => clearInterval(id)
  }, [])

  const units = [
    { v: t.days, l: "天" },
    { v: t.hours, l: "时" },
    { v: t.minutes, l: "分" },
    { v: t.seconds, l: "秒" },
  ]

  const lg = size === "lg"

  return (
    <div
      role="timer"
      aria-label={
        mounted
          ? `距世界杯总决赛还有 ${t.days} 天 ${t.hours} 时 ${t.minutes} 分`
          : "总决赛倒计时"
      }
      className={`flex items-center ${lg ? "gap-2" : "gap-1.5"}`}
    >
      {units.map((u, i) => (
        <div key={u.l} className={`flex items-center ${lg ? "gap-2" : "gap-1.5"}`}>
          <div
            className={`flex flex-col items-center rounded-lg border border-border/70 bg-background/50 ${
              lg ? "min-w-14 px-3 py-2.5" : "px-2.5 py-1.5"
            }`}
          >
            <span
              className={`font-heading font-700 tabular-nums leading-none text-primary ${
                lg ? "text-3xl sm:text-4xl" : "text-lg"
              }`}
            >
              {mounted ? String(u.v).padStart(2, "0") : "--"}
            </span>
            <span
              className={`font-medium text-muted-foreground ${lg ? "mt-1 text-[10px]" : "mt-0.5 text-[9px]"}`}
            >
              {u.l}
            </span>
          </div>
          {i < units.length - 1 && (
            <span
              className={`font-heading font-700 text-muted-foreground/40 ${lg ? "text-xl" : "text-sm"}`}
            >
              :
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
