import { describe, expect, expectTypeOf, it } from 'vitest';
import type { IArvoEventHandlerMiddleware } from '../../../../src/ArvoEventHandler/types/middleware.js';
import type { ArvoComposedMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/index.js';
import * as packageSurface from '../../../../src/index.js';
import { composeLayers } from './fixture.js';

/** The composite at the type level, run so it compiles where the suite does. */

describe('the composite as a layer', () => {
  it('satisfies the layer interface, under its fixed identifier', () => {
    expectTypeOf<ArvoComposedMiddleware>().toExtend<
      IArvoEventHandlerMiddleware<'arvo.composed'>
    >();
    expect(composeLayers([]).id).toBe('arvo.composed');
  });

  it('is not part of the package surface', () => {
    const exportedNames = Object.keys(packageSurface);
    for (const internalName of [
      'ArvoComposedMiddleware',
      'tryCreateArvoComposedMiddleware',
      'tryResolveMiddleware',
      'ArvoComposedMiddlewareValidationError',
      'ArvoComposedMiddlewareResolutionError',
    ]) {
      expect(exportedNames).not.toContain(internalName);
    }
  });
});
