import type { IArvoEventHandlerMiddleware } from '../../../../src/ArvoEventHandler/types/middleware.js';
import { ArvoComposedMiddleware } from '../../../../src/ArvoEventHandler/version/composed-middleware/index.js';

/** A mark as the composite leaves it: the stage, and its attributes. */
export type RecordedMark = [stage: string, attributes: Record<string, unknown>];

/**
 * The only part of an execution context the composite reads, recording
 * every mark made on it. Layers receive this same object.
 */
export const createMarkingContext = () => {
  const recordedMarks: RecordedMark[] = [];
  const markingContext = {
    telemetry: {
      addEvent: (eventName: string, attributes?: Record<string, unknown>) => {
        recordedMarks.push([
          eventName.replace(/^stage\./, ''),
          { ...(attributes ?? {}) },
        ]);
      },
    },
  };
  return { markingContext, recordedMarks };
};

/** A composite over supplied layers only, with a clock not yet fired. */
export const composeLayers = (
  layers: readonly IArvoEventHandlerMiddleware[],
  abortController = new AbortController(),
) =>
  new ArvoComposedMiddleware({
    supplied: layers,
    declared: [],
    abortSignal: abortController.signal,
  });

/** A composite over entries already made, whatever they turned out to be. */
export const composeEntries = (entries: {
  supplied: readonly unknown[];
  declared: readonly unknown[];
}) =>
  new ArvoComposedMiddleware({
    supplied: entries.supplied as never,
    declared: entries.declared as never,
    abortSignal: new AbortController().signal,
  });

/** The stages marked, in order, each with the layer it names. */
export const stagesWithLayer = (recordedMarks: RecordedMark[]) =>
  recordedMarks.map(([stage, attributes]) => [
    stage,
    attributes['middleware.id'],
  ]);
