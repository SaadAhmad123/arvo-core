/**
 * Utility class for generating standardized event type strings for the Arvo orchestrator.
 * This class provides methods to create consistent event type identifiers with predefined prefixes
 * and suffixes for different event states (init, complete, error).
 * 
 * @example
 * ```typescript
 * // Generate event types for a 'payment' event
 * const initEvent = ArvoOrchestratorEventTypeGen.init('payment')      // 'arvo.orc.payment'
 * const doneEvent = ArvoOrchestratorEventTypeGen.complete('payment')  // 'arvo.orc.payment.done'
 * const errorEvent = ArvoOrchestratorEventTypeGen.systemError('payment') // 'sys.arvo.orc.payment.error'
 * ```
 */
export class ArvoOrchestratorEventTypeGen {
  /**
   * The standard prefix used for all Arvo orchestrator events.
   * This prefix helps identify events that belong to the Arvo orchestrator system.
   */
  public static readonly prefix: 'arvo.orc' = 'arvo.orc' as const

  /**
   * Generates an initialization event type string for a given event name.
   * 
   * @param name - The base name of the event
   * @returns A type-safe string combining the standard prefix with the provided name
   * @typeParam T - String literal type for the event name
   * 
   * @example
   * ```typescript
   * ArvoOrchestratorEventTypeGen.init('userRegistration') // Returns: 'arvo.orc.userRegistration'
   * ```
   */
  public static init<T extends string>(name: T): `${typeof ArvoOrchestratorEventTypeGen.prefix}.${T}` {
    return `${ArvoOrchestratorEventTypeGen.prefix}.${name}`
  }

  /**
   * Generates a completion event type string for a given event name.
   * Appends '.done' to the initialization event type.
   * 
   * @param name - The base name of the event
   * @returns A type-safe string for the completion event
   * @typeParam T - String literal type for the event name
   * 
   * @example
   * ```typescript
   * ArvoOrchestratorEventTypeGen.complete('userRegistration') // Returns: 'arvo.orc.userRegistration.done'
   * ```
   */
  public static complete<T extends string>(name: T): `${ReturnType<typeof ArvoOrchestratorEventTypeGen.init<T>>}.done` {
    return `${ArvoOrchestratorEventTypeGen.init(name)}.done`
  }

  /**
   * Generates a system error event type string for a given event name.
   * Prepends 'sys.' and appends '.error' to the initialization event type.
   * 
   * @param name - The base name of the event
   * @returns A type-safe string for the system error event
   * @typeParam T - String literal type for the event name
   * 
   * @example
   * ```typescript
   * ArvoOrchestratorEventTypeGen.systemError('userRegistration') // Returns: 'sys.arvo.orc.userRegistration.error'
   * ```
   */
  public static systemError<T extends string>(name: T): `sys.${ReturnType<typeof ArvoOrchestratorEventTypeGen.init<T>>}.error` {
    return `sys.${ArvoOrchestratorEventTypeGen.init(name)}.error`
  }
}