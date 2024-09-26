export const ArvoOrchestratorEventTypeGen = {
  __prefix: `arvo.orc` as `arvo.orc`,
  init: <T extends string>(name: T) => `${ArvoOrchestratorEventTypeGen.__prefix}.${name}` as `${typeof ArvoOrchestratorEventTypeGen.__prefix}.${T}`,
  complete: <T extends string>(name: T) => `${ArvoOrchestratorEventTypeGen.init(name)}.done` as `${ReturnType<typeof ArvoOrchestratorEventTypeGen.init<T>>}.done`,
  systemError: <T extends string>(name: T) => `sys.${ArvoOrchestratorEventTypeGen.init(name)}.error` as `sys.${ReturnType<typeof ArvoOrchestratorEventTypeGen.init<T>>}.error`
}