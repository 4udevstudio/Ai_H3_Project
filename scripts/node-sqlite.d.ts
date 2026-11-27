declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean })
    prepare(source: string): {
      get(...args: unknown[]): unknown
      all(...args: unknown[]): Record<string, unknown>[]
    }
    close(): void
  }
}
