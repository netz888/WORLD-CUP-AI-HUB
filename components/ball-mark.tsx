import { cn } from "@/lib/utils"

// Clean World Cup style trophy mark.
export function BallMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(className)}
      aria-hidden="true"
    >
      {/* cup bowl */}
      <path d="M7 4h10v4.2a5 5 0 0 1-10 0V4z" fill="currentColor" stroke="none" />
      <path d="M7 4h10v4.2a5 5 0 0 1-10 0V4z" />
      {/* handles */}
      <path d="M7 5H4.4a1 1 0 0 0-1 1v1.2A3 3 0 0 0 6.4 10.2" />
      <path d="M17 5h2.6a1 1 0 0 1 1 1v1.2a3 3 0 0 1-3 3" />
      {/* stem + base */}
      <path d="M12 13.4V17" />
      <path d="M8.5 20.2h7l-.8-3.2H9.3l-.8 3.2z" fill="currentColor" stroke="none" />
      <path d="M8.5 20.2h7l-.8-3.2H9.3l-.8 3.2z" />
    </svg>
  )
}
