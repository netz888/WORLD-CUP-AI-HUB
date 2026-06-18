"use client"

import { useEffect, useRef, useState } from "react"

type CountUpProps = {
  value: number
  duration?: number
  decimals?: number
  suffix?: string
  prefix?: string
  className?: string
}

/**
 * Animates a number from 0 to `value` when it scrolls into view.
 * Lightweight, dependency-free, respects prefers-reduced-motion.
 */
export function CountUp({
  value,
  duration = 1100,
  decimals = 0,
  suffix = "",
  prefix = "",
  className,
}: CountUpProps) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) {
      setDisplay(value)
      return
    }

    const run = () => {
      if (started.current) return
      started.current = true
      const start = performance.now()
      const tick = (now: number) => {
        const p = Math.min((now - start) / duration, 1)
        // easeOutExpo
        const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p)
        setDisplay(value * eased)
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            run()
            io.disconnect()
          }
        }
      },
      { threshold: 0.3 },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [value, duration])

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display.toFixed(decimals)}
      {suffix}
    </span>
  )
}
