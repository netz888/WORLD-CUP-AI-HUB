/**
 * Subtle sport-tech ambient background: soft glows + pitch grid.
 * Fixed, non-interactive, sits behind all content.
 */
export function AmbientBg() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute inset-0 pitch-grid opacity-40" />
      <div className="animate-glow-drift absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-primary/10 blur-[120px]" />
      <div className="animate-glow-drift-slow absolute -right-32 top-1/3 h-[28rem] w-[28rem] rounded-full bg-accent/8 blur-[120px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    </div>
  )
}
