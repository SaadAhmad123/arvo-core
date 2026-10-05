/**
 * What a run fans out over, and how deep it goes.
 *
 * Derived from what the order asked for rather than read from anywhere.
 * The shape of a run is the caller's to choose — a width and a depth on
 * the init event — so there is nothing for a store to hold, and nothing
 * a mechanism has to seed before a run means anything.
 */

/** How many children a category has, where it has any. */
const BRANCHES = 2;

/** The items an order of this width fans out over. */
export const itemsFor = (orderRef: string, width: number): readonly string[] =>
  Array.from(
    { length: width },
    (_unused, position) => `${orderRef}/item-${position}`,
  );

/** The categories one level under this one. */
export const childrenOf = (category: string): readonly string[] =>
  Array.from(
    { length: BRANCHES },
    (_unused, branch) => `${category}/${branch}`,
  );

/**
 * How much of one item is held.
 *
 * A pure function of the name, so every mechanism finds the same answer
 * for the same item and a run's result can be compared across them.
 * Some items come back short, so a run's answer distinguishes what it
 * checked from what it found sufficient.
 */
export const heldOf = (sku: string): number => {
  let total = 0;
  for (const character of sku)
    total = (total * 31 + character.charCodeAt(0)) % 97;
  return total % 7 === 0 ? 0 : 1 + (total % 5);
};
