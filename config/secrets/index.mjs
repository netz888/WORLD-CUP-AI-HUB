import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const LOCAL_KEYS_URL = new URL("./keys.local.mjs", import.meta.url)

const DEFAULTS = {
  FOOTBALL_DATA_API_KEY: "",
  API_FOOTBALL_KEY: "",
  API_FOOTBALL_DELAY_MS: "",
  API_FOOTBALL_RETRY_WAIT_MS: "",
  GLM_API_KEY: "",
  GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  GLM_MODEL: "glm-4-flash",
  MIMO_API_KEY: "",
  MIMO_BASE_URL: "https://api.xiaomimimo.com/v1",
  MIMO_MODEL: "mimo-v2.5-pro",
  MIMO_WEB_SEARCH: "true",
  MIMO_SEARCH_DELAY_MS: "",
}

let cachedLocal = null

async function loadLocalKeys() {
  if (cachedLocal) return cachedLocal
  const localPath = fileURLToPath(LOCAL_KEYS_URL)
  if (!existsSync(localPath)) {
    cachedLocal = {}
    return cachedLocal
  }

  const mod = await import(LOCAL_KEYS_URL.href)
  cachedLocal = { ...(mod.default ?? {}), ...mod }
  delete cachedLocal.default
  return cachedLocal
}

function normalizeValue(value) {
  if (value == null) return ""
  return String(value).trim()
}

function isPlaceholder(value) {
  const v = normalizeValue(value)
  return !v || /^YOUR_/i.test(v) || /^PLACEHOLDER/i.test(v) || /^REPLACE_/i.test(v)
}

export async function getApiKeys() {
  const local = await loadLocalKeys()
  const out = {}
  for (const [name, fallback] of Object.entries(DEFAULTS)) {
    const envValue = normalizeValue(process.env[name])
    const localValue = normalizeValue(local[name])
    out[name] = envValue || localValue || normalizeValue(fallback)
  }
  return out
}

export async function requireKey(name) {
  const keys = await getApiKeys()
  const value = keys[name]
  if (isPlaceholder(value)) {
    throw new Error(`Missing required secret: ${name}`)
  }
  return value
}

export function maskKey(value) {
  const v = normalizeValue(value)
  if (!v) return "(empty)"
  if (v.length <= 8) return `${v[0] ?? ""}***${v[v.length - 1] ?? ""}`
  return `${v.slice(0, 4)}...${v.slice(-4)}`
}
