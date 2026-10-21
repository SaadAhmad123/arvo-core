import { describe, expect, it, vi } from 'vitest';
import { ArvoEventHandlerValidationError } from '../../../src/ArvoEventHandler/errors.js';
import type {
  ArvoEventHandlerMiddlewareEntry,
  IArvoEventHandlerMiddleware,
} from '../../../src/ArvoEventHandler/types/middleware.js';
import { setupArvoEventHandler } from '../../../src/factories/setupArvoEventHandler.js';
import { orderContract } from '../fixtures.js';

/** A layer that does nothing, named as asked. */
const layerNamed = (id: string): IArvoEventHandlerMiddleware => ({ id });

const declareOrderHandler = (
  middleware?: readonly ArvoEventHandlerMiddlewareEntry[],
  options?: { maxDepth: number },
) =>
  setupArvoEventHandler({
    contracts: { self: orderContract },
    ...(middleware === undefined ? {} : { middleware }),
    ...(options === undefined ? {} : { options }),
  }).handler('1.0.0', async () => undefined);

const refusalFrom = (built: () => unknown): ArvoEventHandlerValidationError => {
  try {
    built();
  } catch (raised) {
    return raised as ArvoEventHandlerValidationError;
  }
  throw new Error('the declaration was accepted');
};

describe('a handler declaring no layers', () => {
  it('holds none where none were named', () => {
    expect(declareOrderHandler().build().middleware).toBeNull();
  });

  it('holds none where an empty list was named, the two meaning the same', () => {
    expect(declareOrderHandler([]).build().middleware).toBeNull();
  });
});

describe('a handler declaring layers', () => {
  it('holds every one, in the order declared, as given', () => {
    const firstLayer = layerNamed('first');
    const secondLayer = layerNamed('second');
    const heldMiddleware = declareOrderHandler([
      firstLayer,
      secondLayer,
    ]).build().middleware;
    expect(heldMiddleware).toEqual([firstLayer, secondLayer]);
    expect(heldMiddleware?.[0]).toBe(firstLayer);
    expect(heldMiddleware?.[1]).toBe(secondLayer);
  });

  it('holds them as a list nothing can change', () => {
    const heldMiddleware = declareOrderHandler([layerNamed('first')]).build()
      .middleware;
    expect(Object.isFrozen(heldMiddleware)).toBe(true);
  });

  it('is not changed by the list it was given changing later', () => {
    const givenList = [layerNamed('first')];
    const handler = declareOrderHandler(givenList).build();
    givenList.push(layerNamed('second'));
    expect(handler.middleware).toHaveLength(1);
  });

  it('carries them through every version added to the declaration', () => {
    const onlyLayer = layerNamed('only');
    const setup = setupArvoEventHandler({
      contracts: { self: orderContract },
      middleware: [onlyLayer],
    });
    expect(
      setup.handler('1.0.0', async () => undefined).build().middleware,
    ).toEqual([onlyLayer]);
  });

  it('holds a way to make a layer as given, and does not call it', () => {
    const makeLayer = vi.fn(() => layerNamed('made'));
    const heldMiddleware = declareOrderHandler([makeLayer]).build().middleware;
    expect(heldMiddleware?.[0]).toBe(makeLayer);
    expect(makeLayer).not.toHaveBeenCalled();
  });
});

describe('a declaration naming two layers with one identifier', () => {
  it('is refused', () => {
    expect(() =>
      declareOrderHandler([layerNamed('same'), layerNamed('same')]).build(),
    ).toThrow(ArvoEventHandlerValidationError);
  });

  it('names the identifier, at the second one', () => {
    const refusal = refusalFrom(() =>
      declareOrderHandler([
        layerNamed('same'),
        layerNamed('other'),
        layerNamed('same'),
      ]).build(),
    );
    const issue = refusal.issues.find(
      (candidateIssue) => candidateIssue.path === 'middleware[2].id',
    );
    expect(issue).toBeDefined();
    expect(issue?.toString()).toContain('same');
  });

  it('reports each repeat, not only the first', () => {
    const refusal = refusalFrom(() =>
      declareOrderHandler([
        layerNamed('a'),
        layerNamed('a'),
        layerNamed('b'),
        layerNamed('b'),
      ]).build(),
    );
    expect(refusal.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['middleware[1].id', 'middleware[3].id']),
    );
  });

  it('is reported alongside every other rule the declaration broke', () => {
    const refusal = refusalFrom(() =>
      declareOrderHandler([layerNamed('same'), layerNamed('same')], {
        maxDepth: -1,
      }).build(),
    );
    const paths = refusal.issues.map((issue) => issue.path);
    expect(paths).toContain('middleware[1].id');
    expect(paths.some((path) => path.startsWith('options'))).toBe(true);
  });

  it('is reported by tryBuild rather than thrown', () => {
    const built = declareOrderHandler([
      layerNamed('same'),
      layerNamed('same'),
    ]).tryBuild();
    expect(built.ok).toBe(false);
  });

  it('treats two identifiers differing only in case as two', () => {
    expect(
      declareOrderHandler([layerNamed('Same'), layerNamed('same')]).build()
        .middleware,
    ).toHaveLength(2);
  });

  it('treats the same layer named twice as a repeat of its identifier', () => {
    const sameLayer = layerNamed('once');
    expect(() => declareOrderHandler([sameLayer, sameLayer]).build()).toThrow(
      ArvoEventHandlerValidationError,
    );
  });

  it('does not check a way to make one, which is not called until an execution', () => {
    expect(
      declareOrderHandler([
        layerNamed('same'),
        () => layerNamed('same'),
      ]).build().middleware,
    ).toHaveLength(2);
  });
});

describe('a declaration naming something that is not a layer', () => {
  it.each([
    ['a layer with no identifier', {}],
    ['an identifier that is not a string', { id: 42 }],
    ['nothing at all', null],
    ['a number', 7],
  ])('refuses %s', (_label, notALayer) => {
    const refusal = refusalFrom(() =>
      declareOrderHandler([
        notALayer as unknown as ArvoEventHandlerMiddlewareEntry,
      ]).build(),
    );
    expect(refusal.issues.map((issue) => issue.path)).toContain(
      'middleware[0]',
    );
  });

  it('refuses a before part that is not something to call', () => {
    const refusal = refusalFrom(() =>
      declareOrderHandler([
        {
          id: 'wrong',
          before: 'soon',
        } as unknown as IArvoEventHandlerMiddleware,
      ]).build(),
    );
    expect(refusal.issues.map((issue) => issue.path)).toContain(
      'middleware[0].before',
    );
  });

  it('refuses an after part that is not something to call', () => {
    const refusal = refusalFrom(() =>
      declareOrderHandler([
        { id: 'wrong', after: 1 } as unknown as IArvoEventHandlerMiddleware,
      ]).build(),
    );
    expect(refusal.issues.map((issue) => issue.path)).toContain(
      'middleware[0].after',
    );
  });
});
