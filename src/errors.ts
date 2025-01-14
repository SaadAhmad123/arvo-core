export type ViolationErrorParam<T extends string = string> = {
  type: T,
  message: string,
  metadata?: Record<string, any>
}

export class ViolationError<T extends string = string> extends Error {
  readonly type: T
  readonly metadata: Record<string, any> | null
  readonly name: `ViolationError<${T}>`
  
  constructor({type, message, metadata}: ViolationErrorParam<T>) {
    super(`ViolationError<${type}> ${message}`)
    this.type = type
    this.name = `ViolationError<${this.type}>`
    this.metadata = metadata ?? null
  }
}
