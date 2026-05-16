/**
 * `lib/time/` v1 export surface — ADR-0034 Slice 1.
 *
 * The symbols re-exported here ARE the public API of the time module.
 * Adding new exports requires either a new AC in a later slice or a
 * spec amendment in this slice. Workers MUST NOT export `new Date()` /
 * `Date.now()` from `lib/time/` directly; the sole sanctioned wrapper
 * is `nowUtc()`.
 *
 * `tests/time/index.test.ts` snapshots `Object.keys(* as Time).sort()`
 * against the exact symbol list below, so a worker who adds a symbol
 * without updating that test will see the test fail loudly.
 */

export { nowUtc } from './now';
export { CLUB_TZ_DEFAULT, isValidIanaZone, type IanaZone } from './zones';
export { formatInZone } from './display';
export {
  momentUtc,
  wallClockIntent,
  vendorMoment,
  jurisdictionalDate,
  type Moment,
  type WallClockIntent,
  type VendorMoment,
  type JurisdictionalDate,
} from './categories';
export { formatAuditRowDualZone } from './audit-render';
