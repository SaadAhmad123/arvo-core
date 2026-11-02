import { describe, expect, it } from 'vitest';
import {
  buildCapacitySchema,
  checkCapacity,
} from '../../../src/ArvoOutboxDriver/helpers/check-capacity.js';

/** The paths of every issue an answer is refused with. */
const issuePathsFor = (answer: unknown) => {
  const capacityResult = checkCapacity(buildCapacitySchema(), answer);
  if (capacityResult.ok) throw new Error('the answer was not refused');
  return capacityResult.error.map((issue) => issue.path);
};

describe("checking a capacity answer's shape", () => {
  it.each([
    ['an outbox that limits nothing', { status: 'available', buffers: {} }],
    [
      'one buffer with no numbers',
      { status: 'tolerating', buffers: { events: { status: 'tolerating' } } },
    ],
    [
      'both buffers with every number',
      {
        status: 'exhausted',
        buffers: {
          events: { status: 'exhausted', held: 11, size: 8, limit: 10 },
          states: { status: 'available', held: 0, size: 5, limit: 6 },
        },
      },
    ],
  ])('accepts %s, as given', (_answerDescription, answer) => {
    expect(checkCapacity(buildCapacitySchema(), answer)).toEqual({
      ok: true,
      value: answer,
    });
  });

  it('hands back no field the answer did not give', () => {
    const capacityResult = checkCapacity(buildCapacitySchema(), {
      status: 'available',
      buffers: { states: { status: 'available', size: 4 } },
    });
    expect(capacityResult.ok && capacityResult.value.buffers).toStrictEqual({
      states: { status: 'available', size: 4 },
    });
  });

  it.each([
    ['none', null],
    ['a list', []],
    ['a string', 'available'],
  ])('refuses %s as a whole', (_answerDescription, answer) => {
    expect(issuePathsFor(answer)).toEqual(['capacity']);
  });

  it('refuses a status of no known kind overall', () => {
    expect(issuePathsFor({ status: 'full', buffers: {} })).toEqual([
      'capacity.status',
    ]);
  });

  it.each([
    ['missing', undefined],
    ['none', null],
    ['a list', []],
  ])('refuses buffers %s', (_buffersDescription, buffers) => {
    expect(issuePathsFor({ status: 'available', buffers })).toEqual([
      'capacity.buffers',
    ]);
  });

  it('refuses a buffer that is not an object', () => {
    expect(
      issuePathsFor({ status: 'available', buffers: { events: 'full' } }),
    ).toEqual(['capacity.buffers.events']);
  });

  it('refuses a buffer status of no known kind', () => {
    expect(
      issuePathsFor({
        status: 'available',
        buffers: { states: { status: 'full' } },
      }),
    ).toEqual(['capacity.buffers.states.status']);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['not a number', '3'],
    ['not finite', Number.POSITIVE_INFINITY],
  ])('refuses a number that is %s', (_numberDescription, held) => {
    expect(
      issuePathsFor({
        status: 'available',
        buffers: { events: { status: 'available', held } },
      }),
    ).toEqual(['capacity.buffers.events.held']);
  });

  it('reports every problem at once', () => {
    expect(
      issuePathsFor({
        status: 'full',
        buffers: {
          events: { status: 'available', held: -1, size: 'eight', limit: 0.5 },
          states: { status: 'gone' },
        },
      }),
    ).toEqual([
      'capacity.status',
      'capacity.buffers.events.held',
      'capacity.buffers.events.size',
      'capacity.buffers.events.limit',
      'capacity.buffers.states.status',
    ]);
  });
});
