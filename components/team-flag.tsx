import { cn } from "@/lib/utils"

// FIFA 三字码 -> ISO 二字码（flagcdn 用小写 ISO）
const CODE_MAP: Record<string, string> = {
  ARG: "ar",
  BRA: "br",
  FRA: "fr",
  ESP: "es",
  ENG: "gb-eng",
  POR: "pt",
  NED: "nl",
  BEL: "be",
  ITA: "it",
  GER: "de",
  CRO: "hr",
  URU: "uy",
  USA: "us",
  MEX: "mx",
  CAN: "ca",
  JPN: "jp",
  KOR: "kr",
  AUS: "au",
  IRN: "ir",
  KSA: "sa",
  QAT: "qa",
  MAR: "ma",
  SEN: "sn",
  GHA: "gh",
  CIV: "ci",
  TUN: "tn",
  ALG: "dz",
  EGY: "eg",
  CMR: "cm",
  NGA: "ng",
  RSA: "za",
  COL: "co",
  ECU: "ec",
  PER: "pe",
  CHI: "cl",
  PAR: "py",
  SUI: "ch",
  POL: "pl",
  DEN: "dk",
  SWE: "se",
  NOR: "no",
  AUT: "at",
  SRB: "rs",
  UKR: "ua",
  TUR: "tr",
  WAL: "gb-wls",
  SCO: "gb-sct",
  GRE: "gr",
  CZE: "cz",
  HUN: "hu",
  ROU: "ro",
  SVN: "si",
  SVK: "sk",
  IRL: "ie",
  NZL: "nz",
  JAM: "jm",
  CRC: "cr",
  PAN: "pa",
  HON: "hn",
  CUW: "cw",
  BIH: "ba",
  HAI: "ht",
  CPV: "cv",
  IRQ: "iq",
  JOR: "jo",
  UZB: "uz",
  COD: "cd",
}

const SIZES: Record<string, string> = {
  xs: "h-3.5 w-5",
  sm: "h-4 w-6",
  md: "h-5 w-7",
  lg: "h-7 w-10",
  xl: "h-12 w-16 sm:h-14 sm:w-20",
}

export function TeamFlag({
  code,
  size = "md",
  rounded = "rounded",
  className,
}: {
  code: string
  size?: "xs" | "sm" | "md" | "lg" | "xl"
  rounded?: string
  className?: string
}) {
  const iso = CODE_MAP[code]
  const dim = SIZES[size]

  if (!iso) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center bg-secondary font-bold text-muted-foreground",
          dim,
          rounded,
          size === "xs" || size === "sm" ? "text-[8px]" : "text-[10px]",
          className,
        )}
        aria-label={code}
      >
        {code}
      </span>
    )
  }

  return (
    <img
      src={`https://flagcdn.com/${iso}.svg`}
      alt={`${code} 国旗`}
      crossOrigin="anonymous"
      className={cn("inline-block object-cover ring-1 ring-border/40", dim, rounded, className)}
      loading="lazy"
    />
  )
}
