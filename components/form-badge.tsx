import { cn } from "@/lib/utils"

const MAP: Record<string, { label: string; cls: string }> = {
  W: { label: "胜", cls: "bg-primary/20 text-primary border-primary/30" },
  D: { label: "平", cls: "bg-muted-foreground/15 text-muted-foreground border-border" },
  L: { label: "负", cls: "bg-destructive/20 text-destructive border-destructive/30" },
}

export function FormBadge({ result }: { result: "W" | "D" | "L" }) {
  const m = MAP[result]
  return (
    <span
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-md border text-[10px] font-bold",
        m.cls,
      )}
    >
      {m.label}
    </span>
  )
}

export function FormRow({ form }: { form: ("W" | "D" | "L")[] }) {
  return (
    <div className="flex items-center gap-1">
      {form.map((f, i) => (
        <FormBadge key={i} result={f} />
      ))}
    </div>
  )
}
