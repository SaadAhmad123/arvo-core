/** Throws where a lease asked of `outboxName` is no whole number of milliseconds greater than zero. */
export const refuseInvalidLease = (
  outboxName: string,
  leaseMs: number | undefined,
): void => {
  if (leaseMs === undefined) return;
  if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
    throw new RangeError(
      `${outboxName} cannot lease events for ${leaseMs} milliseconds; a lease must be a whole number of milliseconds greater than zero, or left out for none.`,
    );
  }
};
