import type { VersionedArvoContract } from '../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import type { ArvoDomain } from './index.js';

/** One of {@link ArvoDomain}'s members. */
export type ArvoDomainSymbol = (typeof ArvoDomain)[keyof typeof ArvoDomain];

/**
 * A `domain` as a caller may supply it: the value itself, or one of
 * {@link ArvoDomain}'s symbols naming where to read it from.
 */
export type ArvoDomainInput = string | ArvoDomainSymbol;

/**
 * The sources {@link ArvoDomain}'s symbols read from.
 *
 * Each is optional but one: a symbol whose source is absent resolves to
 * `null`, so a caller supplies whichever sources the symbols they use need.
 */
export type ArvoDomainContext = {
  /** The contract the event being built belongs to. */
  eventContract: VersionedArvoContract;
  /** The contract of whoever is building the event, where that differs. */
  selfContract?: VersionedArvoContract;
  /** The event that caused the one being built. */
  triggeringEvent?: ArvoEvent;
};
