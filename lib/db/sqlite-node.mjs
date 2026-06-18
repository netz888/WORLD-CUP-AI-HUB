// better-sqlite3 兼容层，底层用 Node 24 内置的 `node:sqlite`（DatabaseSync）。
//
// 背景：better-sqlite3 是原生模块，需针对 Node ABI 编译 .node 二进制。本运行环境
// （Node 24 / ABI v137）既无预编译包、也无 C++ 编译器，导致 "Could not locate the
// bindings file" 崩溃。node:sqlite 是 Node 内置模块，零原生依赖、API 与 better-sqlite3
// 高度一致，因此用它实现一个等价 Shim，供 app（lib/db/client.ts）与抓取脚本共用。
//
// 仅实现项目实际用到的子集：
//   Database: new Database(path[, {readonly}]) / .prepare / .exec / .pragma / .transaction / .close
//   Statement: .run / .get / .all / .raw()（raw 供 drizzle 取列值数组）
import { DatabaseSync } from "node:sqlite"

class Statement {
  constructor(stmt) {
    this._stmt = stmt
  }
  run(...params) {
    return this._stmt.run(...params) // { changes, lastInsertRowid }
  }
  get(...params) {
    return this._stmt.get(...params) ?? undefined
  }
  all(...params) {
    return this._stmt.all(...params)
  }
  // drizzle 的 better-sqlite3 适配器会调用 stmt.raw().all()/.get() 取「列值数组」。
  // node:sqlite 只返回对象行；这里用 Object.values 转换（node:sqlite 保留 SELECT 列顺序），
  // 正是 drizzle 按位置映射所需。
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

export default class Database {
  constructor(filename, options = {}) {
    // better-sqlite3 用 { readonly }，node:sqlite 用 { readOnly }
    this._db = new DatabaseSync(filename, {
      readOnly: Boolean(options.readonly),
    })
  }
  prepare(sql) {
    return new Statement(this._db.prepare(sql))
  }
  exec(sql) {
    this._db.exec(sql)
    return this
  }
  // better-sqlite3 的 .pragma("journal_mode = WAL") → node:sqlite 用 exec("PRAGMA ...")
  pragma(str) {
    this._db.exec(`PRAGMA ${str}`)
  }
  // better-sqlite3 的 .transaction(fn) 返回一个「调用即在事务中执行 fn」的函数。
  transaction(fn) {
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
          /* 忽略回滚失败 */
        }
        throw err
      }
    }
  }
  close() {
    this._db.close()
  }
}
