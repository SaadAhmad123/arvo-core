import { expect } from 'vitest';
import { deriveArvoExecutionId } from '../../../src/ArvoEventHandler/helpers/execution-id.js';
import { checkInvariants } from '../version/scenarios/invariants.js';
import type { ArvoLattice } from '../version/scenarios/lattice.js';

/**
 * What must be true of a run the handler drove, beyond what must be true
 * of any run at all.
 *
 * Everything in the version's own invariants still applies: moving who
 * decides changes nothing about what is true. These are the properties
 * that only exist once something has to decide — which execution an
 * event concerns, and which version owns it.
 */

/**
 * Every execution ran under one version for its whole life, and under
 * the one its opening event named.
 *
 * The failure this catches is silent rather than loud: a record resumed
 * under a neighbouring version reads its state through a schema that was
 * never its own, and may well succeed in doing so.
 */
export const everyExecutionKeptItsVersion = (lattice: ArvoLattice): void => {
  const seen = new Map<string, Set<string>>();
  for (const { executionId, row } of lattice.transcript.committed) {
    const versions = seen.get(executionId) ?? new Set<string>();
    versions.add(String(row.version));
    seen.set(executionId, versions);
  }

  for (const [executionId, versions] of seen) {
    expect(
      [...versions],
      `${executionId} was committed under more than one version`,
    ).toHaveLength(1);
  }
};

/**
 * Every execution's record names the version its own opening event
 * named, rather than one chosen some other way.
 */
export const everyExecutionRanWhatItsEventNamed = (
  lattice: ArvoLattice,
): void => {
  for (const row of lattice.store.values()) {
    const opening = row.initEvent as { dataschema: string } | undefined;
    if (opening === undefined) continue;

    const named = opening.dataschema.slice(
      opening.dataschema.lastIndexOf('/') + 1,
    );
    expect(
      row.version,
      `${row.executionId} ran ${row.version} for an event naming ${named}`,
    ).toBe(named);
  }
};

/**
 * Every record is stored under the identity the protocol derives for it.
 *
 * The version's own suite checks this too, but it was handed the
 * identifier. Here the handler derived it, so this is the first place
 * the derivation itself is on trial.
 */
export const everyIdentityWasDerived = async (
  lattice: ArvoLattice,
): Promise<void> => {
  for (const [executionId, row] of lattice.store) {
    const opening = row.initEvent as
      | { id: string; dataschema: string }
      | undefined;
    if (opening === undefined) continue;

    expect(
      await deriveArvoExecutionId(opening as never),
      `${executionId} is not what its own opening event derives`,
    ).toBe(executionId);
  }
};

/**
 * Every fault names the execution the store was asked about.
 *
 * `null` only where the event could not be placed at all — before that
 * there is no execution to name, and after it there always is.
 */
export const everyFaultNamesWhatWasAskedFor = (lattice: ArvoLattice): void => {
  for (const { event, fault } of lattice.transcript.faults) {
    if (fault.faultKind === 'event_unclassifiable') {
      expect(
        fault.executionId,
        `${event.id} could not be placed, so it names no execution`,
      ).toBeNull();
      continue;
    }

    expect(
      fault.executionId,
      `${fault.faultKind} on ${event.id} names no execution`,
    ).not.toBeNull();
  }
};

/**
 * Every fault carries only what the step that raised it may carry.
 *
 * An execution already at rest answered its caller once, so a second
 * answer would be discarded at that caller's gate and overwriting how it
 * ended would erase it. And an event that could not be placed has nobody
 * to tell.
 */
export const everyFaultCarriesWhatItMay = (lattice: ArvoLattice): void => {
  for (const { event, fault } of lattice.transcript.faults) {
    if (
      fault.faultKind === 'event_unclassifiable' ||
      fault.faultKind === 'lifecycle_terminal'
    ) {
      expect(
        fault.abandonmentEvent,
        `${fault.faultKind} on ${event.id} carries an answer it may not send`,
      ).toBeNull();
      expect(
        fault.abandonmentState,
        `${fault.faultKind} on ${event.id} carries a record it may not write`,
      ).toBeNull();
    }
  }
};

/** Every one of them, for a scenario that does not say which it means. */
export const checkHandlerInvariants = async (
  lattice: ArvoLattice,
): Promise<void> => {
  await checkInvariants(lattice);
  everyExecutionKeptItsVersion(lattice);
  everyExecutionRanWhatItsEventNamed(lattice);
  await everyIdentityWasDerived(lattice);
  everyFaultNamesWhatWasAskedFor(lattice);
  everyFaultCarriesWhatItMay(lattice);
};
