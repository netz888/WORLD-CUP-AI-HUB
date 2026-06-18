import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const outPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "data", "sample.wc.db")

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
  kind TEXT NOT NULL DEFAULT 'sample',
  source TEXT NOT NULL DEFAULT 'sample',
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
  fixture_id INTEGER NOT NULL,
  match_key TEXT NOT NULL,
  team_code TEXT NOT NULL,
  team_name TEXT,
  shots_on_goal INTEGER,
  shots_off_goal INTEGER,
  total_shots INTEGER,
  blocked_shots INTEGER,
  shots_inside_box INTEGER,
  shots_outside_box INTEGER,
  fouls INTEGER,
  corners INTEGER,
  offsides INTEGER,
  ball_possession INTEGER,
  yellow_cards INTEGER,
  red_cards INTEGER,
  goalkeeper_saves INTEGER,
  total_passes INTEGER,
  passes_accurate INTEGER,
  passes_pct INTEGER,
  expected_goals REAL,
  as_of TEXT NOT NULL,
  PRIMARY KEY (fixture_id, team_code)
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

const now = "2026-06-18T00:00:00.000Z"
const kickoffBase = Date.UTC(2026, 5, 18, 20, 0, 0)

const sampleRows = {
  live_scores: [
    ["MEX-CZE", 100001, "MEX", "CZE", null, null, "upcoming", "Not Started", "NS", null, null, kickoffBase + 86400000, "Group Stage", now],
    ["CAN-SUI", 100002, "CAN", "SUI", 1, 0, "live", "First Half", "1H", 34, null, kickoffBase - 34 * 60000, "Group Stage", now],
    ["BRA-MAR", 100003, "BRA", "MAR", 2, 1, "finished", "Match Finished", "FT", 90, null, kickoffBase - 86400000, "Group Stage", now],
  ],
  lineups: [
    [
      "CAN-SUI",
      "home",
      "CAN",
      "Canada",
      "4-2-3-1",
      "Sample Coach",
      "sample",
      "sample",
      100002,
      JSON.stringify([
        { player: "Sample Goalkeeper", number: 1, pos: "G" },
        { player: "Sample Defender", number: 4, pos: "D" },
        { player: "Sample Midfielder", number: 8, pos: "M" },
        { player: "Sample Forward", number: 9, pos: "F" },
      ]),
      JSON.stringify([{ player: "Sample Substitute", number: 18, pos: "M" }]),
      now,
    ],
    [
      "CAN-SUI",
      "away",
      "SUI",
      "Switzerland",
      "3-4-2-1",
      "Sample Coach",
      "sample",
      "sample",
      100002,
      JSON.stringify([
        { player: "Sample Keeper", number: 1, pos: "G" },
        { player: "Sample Centre Back", number: 5, pos: "D" },
        { player: "Sample Playmaker", number: 10, pos: "M" },
        { player: "Sample Striker", number: 11, pos: "F" },
      ]),
      JSON.stringify([{ player: "Sample Bench Player", number: 20, pos: "F" }]),
      now,
    ],
  ],
  events: [
    [100002, "CAN-SUI", 1, 18, null, "home", "CAN", "Canada", "Goal", "Normal Goal", "Sample Forward", "Sample Midfielder"],
    [100002, "CAN-SUI", 2, 32, null, "away", "SUI", "Switzerland", "Card", "Yellow Card", "Sample Defender", null],
  ],
  referees: [
    ["CAN-SUI", 100002, "Sample Referee", "Neutral", 4.1, 0.15, 0.24, "Artificial sample row for schema demonstration.", now],
  ],
  match_stats: [
    [100002, "CAN-SUI", "CAN", "Canada", 3, 2, 7, 2, 5, 2, 6, 4, 1, 52, 1, 0, 2, 280, 235, 84, 0.86, now],
    [100002, "CAN-SUI", "SUI", "Switzerland", 2, 3, 6, 1, 4, 2, 7, 3, 2, 48, 1, 0, 3, 260, 215, 83, 0.63, now],
  ],
  champion_sim: [
    ["BRA", 18.4, 31.2, 46.8, 64.1, 78.5, 90.4, now],
    ["ARG", 16.2, 29.8, 44.0, 62.3, 76.1, 89.2, now],
    ["FRA", 15.6, 28.7, 42.5, 60.8, 75.0, 88.6, now],
    ["CAN", 1.1, 3.8, 8.5, 17.2, 34.6, 52.0, now],
  ],
  champion_sim_meta: [["singleton", "sample-results-hash", 1000, now]],
}

const insert = {
  live_scores: db.prepare("INSERT INTO live_scores VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
  lineups: db.prepare("INSERT INTO lineups VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
  events: db.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
  referees: db.prepare("INSERT INTO referees VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
  match_stats: db.prepare("INSERT INTO match_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
  champion_sim: db.prepare("INSERT INTO champion_sim VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
  champion_sim_meta: db.prepare("INSERT INTO champion_sim_meta VALUES (?, ?, ?, ?)"),
}

const tx = db.transaction(() => {
  for (const [table, rows] of Object.entries(sampleRows)) {
    for (const row of rows) insert[table].run(...row)
  }
})
tx()
db.close?.()

console.log(`sample database created: ${path.relative(root, outPath)}`)
