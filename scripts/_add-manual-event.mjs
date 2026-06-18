import Database from "../lib/db/sqlite-node.mjs"
const db = new Database("data/wc.db")
// 确保 source 列存在
try { db.exec("ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'api'") } catch { /* 已存在 */ }

const matchKey = "FRA-SEN"
const fid = 1489383

// 这条手动 VAR：第60分钟，姆巴佩点球被 VAR 取消（法国 home）
const manual = {
  fixture_id: fid, match_key: matchKey,
  minute: 60, extra: null, side: "home", team_code: "FRA", team_name: "France",
  type: "Var", detail: "Penalty cancelled", player: "K. Mbappe", assist: null, source: "manual",
}

// 取现有全部事件，合并手动条目，按时间重排 seq 后整体重写
const existing = db.prepare("SELECT fixture_id,match_key,minute,extra,side,team_code,team_name,type,detail,player,assist,source FROM events WHERE match_key = ?").all(matchKey)
// 去掉同分钟同类型的旧手动重复，避免多次运行叠加
const filtered = existing.filter((e) => !(e.source === "manual" && e.minute === manual.minute && e.type === manual.type))
const merged = [...filtered, manual].sort((a, b) => {
  const am = (a.minute ?? 0) * 100 + (a.extra ?? 0)
  const bm = (b.minute ?? 0) * 100 + (b.extra ?? 0)
  return am - bm
})

const ins = db.prepare(`INSERT OR REPLACE INTO events
  (fixture_id,match_key,seq,minute,extra,side,team_code,team_name,type,detail,player,assist,source)
  VALUES (@fixture_id,@match_key,@seq,@minute,@extra,@side,@team_code,@team_name,@type,@detail,@player,@assist,@source)`)
const tx = db.transaction(() => {
  db.prepare("DELETE FROM events WHERE match_key = ?").run(matchKey)
  merged.forEach((r, i) => ins.run({ ...r, seq: i }))
})
tx()

const after = db.prepare("SELECT seq,minute,extra,type,detail,player,source FROM events WHERE match_key = ? ORDER BY seq").all(matchKey)
console.log("写入后事件:")
after.forEach((e) => console.log(`  seq${e.seq} ${e.minute}${e.extra ? "+" + e.extra : ""}' [${e.type}/${e.detail}] ${e.player} <${e.source}>`))
