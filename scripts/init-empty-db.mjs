import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const outPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "data", "wc.db")

fs.mkdirSync(path.dirname(outPath), { recursive: true })
for (const suffix of ["", "-shm", "-wal"]) {
  const file = `${outPath}${suffix}`
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

const db = new Database(outPath)
db.pragma("journal_mode = DELETE")

db.exec(`
CREATE TABLE live_scores (
  match_key TEXT PRIMARY KEY,
  fixture_id INTEGER,
  home_code TEXT,
  away_code TEXT,
  home_score INTEGER,
  away_score INTEGER,
  status TEXT NOT NULL,
  status_desc TEXT,
  status_short TEXT,
  elapsed INTEGER,
  extra INTEGER,
  kickoff_ms INTEGER,
  round TEXT,
  as_of TEXT NOT NULL
);

CREATE TABLE lineups (
  match_key TEXT NOT NULL,
  side TEXT NOT NULL,
  team_code TEXT NOT NULL,
  team_name TEXT,
  formation TEXT,
  coach TEXT,
  kind TEXT NOT NULL DEFAULT 'confirmed',
  source TEXT NOT NULL DEFAULT 'api-football',
  fixture_id INTEGER,
  start_xi TEXT NOT NULL,
  subs TEXT,
  as_of TEXT NOT NULL,
  PRIMARY KEY (match_key, side)
);

CREATE TABLE events (
  fixture_id INTEGER NOT NULL,
  match_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  minute INTEGER,
  extra INTEGER,
  side TEXT NOT NULL,
  team_code TEXT NOT NULL,
  team_name TEXT,
  type TEXT NOT NULL,
  detail TEXT,
  player TEXT,
  assist TEXT,
  source TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (fixture_id, seq)
);

CREATE TABLE referees (
  match_key TEXT PRIMARY KEY,
  fixture_id INTEGER,
  name TEXT NOT NULL,
  nat TEXT NOT NULL DEFAULT '',
  avg_yellow REAL NOT NULL DEFAULT 4.2,
  avg_red REAL NOT NULL DEFAULT 0.2,
  penalty_rate REAL NOT NULL DEFAULT 0.27,
  note TEXT,
  as_of TEXT NOT NULL
);

CREATE TABLE match_stats (
  match_key TEXT NOT NULL,
  side TEXT NOT NULL,
  team_code TEXT NOT NULL,
  fixture_id INTEGER,
  possession INTEGER,
  total_shots INTEGER,
  shots_on INTEGER,
  shots_off INTEGER,
  blocked INTEGER,
  inside_box INTEGER,
  fouls INTEGER,
  corners INTEGER,
  offsides INTEGER,
  yellow INTEGER,
  red INTEGER,
  gk_saves INTEGER,
  passes INTEGER,
  passes_pct INTEGER,
  xg REAL,
  goals_prevented REAL,
  as_of TEXT NOT NULL,
  PRIMARY KEY (match_key, side)
);

CREATE TABLE champion_sim (
  team_code TEXT PRIMARY KEY,
  champ REAL NOT NULL DEFAULT 0,
  final REAL NOT NULL DEFAULT 0,
  sf REAL NOT NULL DEFAULT 0,
  qf REAL NOT NULL DEFAULT 0,
  r16 REAL NOT NULL DEFAULT 0,
  qualify REAL NOT NULL DEFAULT 0,
  as_of TEXT NOT NULL
);

CREATE TABLE champion_sim_meta (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  results_hash TEXT NOT NULL DEFAULT '',
  n_sims INTEGER NOT NULL DEFAULT 0,
  as_of TEXT NOT NULL
);
`)

db.close?.()

console.log(`empty database created: ${path.relative(root, outPath)}`)
