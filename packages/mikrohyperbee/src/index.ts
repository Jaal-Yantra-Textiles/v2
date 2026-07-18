/**
 * @jytextiles/mikrohyperbee — a Hyperbee-backed DAL with a staged write-contract.
 *
 * Medusa-free core. See apps/docs/notes/MIKROHYPERBEE_FRAMEWORK.md for the design.
 */
export { defineContract, applyShape, checkInvariants } from "./contract";
export { HyperbeeBaseRepository, hyperbeeRepositoryFor } from "./repository";
export {
  AutobeeRepository,
  autobeeRepositoryFor,
  makeApply,
  authorizeWriter,
} from "./autobee";
export type { AutobaseLike, AutobeeOp } from "./autobee";
export {
  ContractError,
} from "./types";
export type {
  Contract,
  FieldSpec,
  FieldType,
  RelationSpec,
  RelationKind,
  ModelRepository,
  RepositoryContext,
  BeeLike,
  Where,
  WhereCond,
  ListConfig,
} from "./types";
