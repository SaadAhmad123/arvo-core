import type {
  ArvoDependencyScope,
  IArvoEventHandlerDependency,
} from 'arvo-core';
import type {
  Catalogue,
  DistributedDependencies,
} from '../../distributed/handler/dependencies.js';

/**
 * The distributed handlers' catalogue, held in memory, so a load run needs
 * no database and the outbox is the only storage under test. It answers as
 * the Postgres catalogue does, `reserve` taking stock once per key however
 * often it is called.
 */

/** Every item and reservation one load run shares between its deliveries. */
export type CatalogueData = {
  readonly skusByCategory: Map<string, readonly string[]>;
  readonly heldBySku: Map<string, number>;
  readonly takenByIdempotencyKey: Map<string, number>;
};

/**
 * A catalogue of `itemCount` items under `orders`, most held, and a chain of
 * categories beneath it `walkDepth` deep, for the walk to descend.
 */
export const createCatalogueData = (param: {
  readonly itemCount: number;
  readonly walkDepth: number;
}): CatalogueData => {
  const skusByCategory = new Map<string, readonly string[]>();
  const heldBySku = new Map<string, number>();
  const orderSkus = Array.from(
    { length: param.itemCount },
    (_unused, position) => `sku-${position}`,
  );
  skusByCategory.set('orders', orderSkus);
  for (const [position, sku] of orderSkus.entries()) {
    // most are held and some are not, so an answer tells them apart
    heldBySku.set(sku, position % 7 === 0 ? 0 : 1_000_000);
  }
  let category = 'orders';
  for (let level = 1; level <= param.walkDepth; level += 1) {
    category = `${category}/level-${level}`;
    const levelSku = `sku-level-${level}`;
    skusByCategory.set(category, [levelSku]);
    heldBySku.set(levelSku, 1_000_000);
  }
  return {
    skusByCategory,
    heldBySku,
    takenByIdempotencyKey: new Map(),
  };
};

/** The catalogue's operations over the data. */
const catalogueOver = (data: CatalogueData): Catalogue => ({
  itemsIn: (category) =>
    Promise.resolve(data.skusByCategory.get(category) ?? []),
  childrenOf: (category) =>
    Promise.resolve(
      [...data.skusByCategory.keys()].filter(
        (candidate) =>
          candidate.startsWith(`${category}/`) &&
          candidate.split('/').length === category.split('/').length + 1,
      ),
    ),
  heldOf: (sku) => Promise.resolve(data.heldBySku.get(sku) ?? 0),
  reserve: (sku, wanted, idempotencyKey) => {
    const alreadyTaken = data.takenByIdempotencyKey.get(idempotencyKey);
    if (alreadyTaken !== undefined) return Promise.resolve(alreadyTaken);
    const held = data.heldBySku.get(sku);
    if (held === undefined) return Promise.resolve(0);
    const taking = Math.min(held, wanted);
    data.takenByIdempotencyKey.set(idempotencyKey, taking);
    data.heldBySku.set(sku, held - taking);
    return Promise.resolve(taking);
  },
});

/** What one delivery's handler is given: the catalogue, opened for its execution. */
export class InMemoryCatalogue
  implements IArvoEventHandlerDependency<DistributedDependencies>
{
  #scope: ArvoDependencyScope | null = null;

  constructor(private readonly data: CatalogueData) {}

  open(scope: ArvoDependencyScope): Promise<void> {
    this.#scope = scope;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.#scope = null;
    return Promise.resolve();
  }

  get attributes(): DistributedDependencies {
    if (this.#scope === null) throw new Error('this catalogue is not open');
    return {
      catalogue: catalogueOver(this.data),
      executionId: this.#scope.executionId,
      attempt: this.#scope.attempt,
      resumed: this.#scope.state,
    };
  }
}
