// Re-exports Meta Comet's passive `__debug.modulesMap` module observer from
// the shared `src/engines/meta-comet/` engine (used by both Facebook and
// Instagram).
export type {
  AnyFunction,
  Loose,
  ModuleRecord,
  PageLoader,
  RequireLazy,
} from '../engines/meta-comet';
export { isObject, observeModules, readModulesMap } from '../engines/meta-comet';
