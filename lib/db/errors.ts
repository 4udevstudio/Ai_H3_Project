/**
 * Expected failure from the film data-access layer.
 * Route handlers turn this into a JSON `{ error, detail? }` response.
 */
export class DbError extends Error {
  readonly status: number
  readonly detail?: string

  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'DbError'
    this.status = status
    this.detail = detail
  }
}
