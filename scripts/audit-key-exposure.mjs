import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getApiKeys, maskKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const keys = await getApiKeys()

const scanDirs = [
  "app",
  "components",
  "lib",
  "scripts",
  "config/secrets",
  ".next/static",
]
const allowedFiles = new Set([
  path.normalize("config/secrets/keys.local.mjs"),
])
const secretNames = new Set([
  "FOOTBALL_DATA_API_KEY",
  "API_FOOTBALL_KEY",
  "GLM_API_KEY",
  "MIMO_API_KEY",
])
const textExt = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".html", ".css", ".txt", ".map"])

function walk(dir) {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) return []
  const out = []
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.name === "node_modules") continue
    const p = path.join(abs, ent.name)
    if (ent.isDirectory()) out.push(...walk(path.relative(root, p)))
    else if (textExt.has(path.extname(ent.name))) out.push(p)
  }
  return out
}

function rel(p) {
  return path.relative(root, p).replace(/\\/g, "/")
}

const findings = []
for (const file of scanDirs.flatMap(walk)) {
  const relative = path.normalize(path.relative(root, file))
  const text = fs.readFileSync(file, "utf8")
  if ((relative.startsWith(`app${path.sep}`) || relative.startsWith(`components${path.sep}`)) && text.includes("config/secrets")) {
    findings.push(`${rel(file)} imports config/secrets from client-facing code`)
  }
  for (const [name, value] of Object.entries(keys)) {
    if (!secretNames.has(name)) continue
    if (!value || value.length < 8) continue
    if (allowedFiles.has(relative)) continue
    if (text.includes(value)) {
      findings.push(`${rel(file)} contains ${name} value ${maskKey(value)}`)
    }
  }
}

if (findings.length) {
  console.error("Key exposure audit failed:")
  for (const f of findings) console.error(`- ${f}`)
  process.exit(1)
}

console.log("Key exposure audit passed")
