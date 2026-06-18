// 类型声明：node:sqlite 兼容层（见 sqlite-node.mjs）。仅覆盖项目用到的子集。
export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface RawStatement {
  all(...params: unknown[]): unknown[][]
  get(...params: unknown[]): unknown[] | undefined
}

export interface Statement {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  raw(): RawStatement
}

export default class Database {
  constructor(filename: string, options?: { readonly?: boolean })
  prepare(sql: string): Statement
  exec(sql: string): this
  pragma(str: string): void
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
  close(): void
}
