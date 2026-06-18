// SQLite compatibility layer.
//
// Production currently runs on Node 20, where `node:sqlite` is not available.
// Prefer the real `better-sqlite3` package when it can be loaded, and fall
// back to the Node 24+ built-in sqlite module only in environments where the
// native dependency is unavailable.

let BetterSqlite3 = null
let DatabaseSync = null

try {
  BetterSqlite3 = (await import("better-sqlite3")).default
} catch {
  ;({ DatabaseSync } = await import("node:sqlite"))
}

class NodeSqliteStatement {
  constructor(stmt) {
    this._stmt = stmt
  }

  run(...params) {
    return this._stmt.run(...params)
  }

  get(...params) {
    return this._stmt.get(...params) ?? undefined
  }

  all(...params) {
    return this._stmt.all(...params)
  }

  raw() {
    const stmt = this._stmt
    return {
      all(...params) {
        return stmt.all(...params).map((row) => Object.values(row))
      },
      get(...params) {
        const row = stmt.get(...params)
        return row ? Object.values(row) : undefined
      },
    }
  }
}

class NodeSqliteDatabase {
  constructor(filename, options = {}) {
    this._db = new DatabaseSync(filename, {
      readOnly: Boolean(options.readonly),
    })
  }

  _requireReady() {
    if (!this._db) {
      throw new Error("node:sqlite database is not initialized yet")
    }
  }

  prepare(sql) {
    this._requireReady()
    return new NodeSqliteStatement(this._db.prepare(sql))
  }

  exec(sql) {
    this._requireReady()
    this._db.exec(sql)
    return this
  }

  pragma(str) {
    this._requireReady()
    this._db.exec(`PRAGMA ${str}`)
  }

  transaction(fn) {
    this._requireReady()
    const db = this._db
    return (...args) => {
      db.exec("BEGIN")
      try {
        const result = fn(...args)
        db.exec("COMMIT")
        return result
      } catch (err) {
        try {
          db.exec("ROLLBACK")
        } catch {
          // Ignore rollback failures and rethrow the original error.
        }
        throw err
      }
    }
  }

  close() {
    this._requireReady()
    this._db.close()
  }
}

export default BetterSqlite3 || NodeSqliteDatabase
