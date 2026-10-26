import type { IArvoOutbox } from '../../../src/ArvoOutbox/interface.js';
import type { ArvoOutboxCommittedEventRecord } from '../../../src/ArvoOutbox/types/event-record.js';
import { ArvoMemoryOutbox } from '../../../src/outbox/inmemory/index.js';
import type { JSONObject } from '../../../src/types.js';

/**
 * Outboxes that each break one rule, keyed by the name of the conformance
 * case guarding it. Each wraps a working `ArvoMemoryOutbox` and changes only
 * what breaks that rule, so a case that passes its broken outbox guards
 * nothing.
 */

/** A working outbox with some of its operations replaced. */
const breakOutbox =
  (
    replaceOperations: (
      workingOutbox: ArvoMemoryOutbox,
    ) => Partial<IArvoOutbox>,
  ) =>
  (): IArvoOutbox => {
    // unopened, as createOutbox hands it over: the kit opens it through the broken outbox
    const workingOutbox = new ArvoMemoryOutbox();
    return {
      readLatestState: (executionId) =>
        workingOutbox.readLatestState(executionId),
      commitStateAndEvents: (param) =>
        workingOutbox.commitStateAndEvents(param),
      commitEvents: (param) => workingOutbox.commitEvents(param),
      readCommittedEvents: (filter) =>
        workingOutbox.readCommittedEvents(filter),
      listUnseenEvents: (param) => workingOutbox.listUnseenEvents(param),
      markEventsSeen: (eventIds) => workingOutbox.markEventsSeen(eventIds),
      open: () => workingOutbox.open(),
      close: () => workingOutbox.close(),
      ...replaceOperations(workingOutbox),
    };
  };

/** Reads committed events, then changes each one. */
const rewriteCommittedEvents =
  (
    rewrite: (
      committedEvent: ArvoOutboxCommittedEventRecord,
      position: number,
    ) => ArvoOutboxCommittedEventRecord,
  ) =>
  (workingOutbox: ArvoMemoryOutbox): Partial<IArvoOutbox> => ({
    readCommittedEvents: async (filter) =>
      (await workingOutbox.readCommittedEvents(filter)).map(rewrite),
  });

/** An outbox remembering the latest revision it committed for each execution. */
const trackLatestRevisions = (
  workingOutbox: ArvoMemoryOutbox,
  answerRefusal: (param: {
    casVersion: number;
    latestRevision: number | undefined;
  }) => boolean,
): Partial<IArvoOutbox> => {
  const latestRevisionByExecution = new Map<string, number>();
  return {
    commitStateAndEvents: async (param) => {
      const outcome = await workingOutbox.commitStateAndEvents(param);
      if (outcome.committed) {
        latestRevisionByExecution.set(param.executionId, param.casVersion);
        return outcome;
      }
      const latestRevision = latestRevisionByExecution.get(param.executionId);
      return answerRefusal({ casVersion: param.casVersion, latestRevision })
        ? outcome
        : { committed: true };
    },
  };
};

/** An outbox that throws for event identifiers it has committed before. */
const throwOnRepeatedEventIds = (
  workingOutbox: ArvoMemoryOutbox,
  operation: 'commitStateAndEvents' | 'commitEvents',
): Partial<IArvoOutbox> => {
  const committedEventIds = new Set<string>();
  const refuseRepeats = (eventIds: readonly string[]) => {
    for (const eventId of eventIds) {
      if (committedEventIds.has(eventId)) {
        throw new Error(`event ${eventId} is already committed`);
      }
    }
    for (const eventId of eventIds) committedEventIds.add(eventId);
  };
  return operation === 'commitStateAndEvents'
    ? {
        commitStateAndEvents: (param) => {
          refuseRepeats(param.events.map((event) => event.id));
          return workingOutbox.commitStateAndEvents(param);
        },
      }
    : {
        commitEvents: (param) => {
          refuseRepeats(param.events.map((event) => event.id));
          return workingOutbox.commitEvents(param);
        },
      };
};

/** A JSON value with every object field holding `null` dropped. */
const withoutNullFields = (state: JSONObject): JSONObject =>
  JSON.parse(
    JSON.stringify(state, (_key, fieldValue) =>
      fieldValue === null ? undefined : fieldValue,
    ),
  );

export const brokenOutboxByCaseName: Record<string, () => IArvoOutbox> = {
  'returns no state for an execution never committed': breakOutbox(
    (workingOutbox) => ({
      readLatestState: async (executionId) =>
        (await workingOutbox.readLatestState(executionId)) ?? {},
    }),
  ),

  'returns a state as soon as it is committed, not one read earlier':
    breakOutbox((workingOutbox) => {
      const stateByExecution = new Map<string, JSONObject | null>();
      return {
        readLatestState: async (executionId) => {
          if (!stateByExecution.has(executionId)) {
            stateByExecution.set(
              executionId,
              await workingOutbox.readLatestState(executionId),
            );
          }
          return stateByExecution.get(executionId) ?? null;
        },
      };
    }),

  'returns the state at the highest revision': breakOutbox((workingOutbox) => {
    const firstStateByExecution = new Map<string, JSONObject>();
    return {
      commitStateAndEvents: async (param) => {
        const outcome = await workingOutbox.commitStateAndEvents(param);
        if (
          outcome.committed &&
          !firstStateByExecution.has(param.executionId)
        ) {
          firstStateByExecution.set(param.executionId, param.state);
        }
        return outcome;
      },
      readLatestState: async (executionId) =>
        firstStateByExecution.get(executionId) ??
        workingOutbox.readLatestState(executionId),
    };
  }),

  'returns a state with nested values exactly as committed': breakOutbox(
    (workingOutbox) => ({
      readLatestState: async (executionId) => {
        const state = await workingOutbox.readLatestState(executionId);
        return state && withoutNullFields(state);
      },
    }),
  ),

  'stores a state it could not interpret as given': breakOutbox(
    (workingOutbox) => ({
      commitStateAndEvents: (param) => {
        if (typeof param.state.lifecycle !== 'string') {
          throw new Error('the state is not an execution record');
        }
        return workingOutbox.commitStateAndEvents(param);
      },
    }),
  ),

  'keys a state by the commit, not by what the state names': breakOutbox(
    (workingOutbox) => ({
      commitStateAndEvents: (param) =>
        workingOutbox.commitStateAndEvents({
          ...param,
          executionId:
            typeof param.state.executionId === 'string'
              ? param.state.executionId
              : param.executionId,
        }),
    }),
  ),

  'stores a committed state and every event committed with it': breakOutbox(
    (workingOutbox) => ({
      commitStateAndEvents: (param) =>
        workingOutbox.commitStateAndEvents({
          ...param,
          events: param.events.slice(0, 1),
        }),
    }),
  ),

  'stores neither the state nor any event of a refused commit': breakOutbox(
    (workingOutbox) => ({
      commitStateAndEvents: async (param) => {
        const outcome = await workingOutbox.commitStateAndEvents(param);
        if (!outcome.committed) {
          await workingOutbox.commitEvents({ events: param.events });
        }
        return outcome;
      },
    }),
  ),

  'commits the first state of an execution': breakOutbox((workingOutbox) => ({
    commitStateAndEvents: async (param) =>
      param.casVersion === 0
        ? { committed: false, refusal: 'state_exists' }
        : workingOutbox.commitStateAndEvents(param),
  })),

  'refuses a second first state as state_exists': breakOutbox(
    (workingOutbox) => ({
      commitStateAndEvents: async (param) => {
        const outcome = await workingOutbox.commitStateAndEvents(param);
        return outcome.committed
          ? outcome
          : { committed: false, refusal: 'revision_stale' };
      },
    }),
  ),

  'commits the revision that follows the stored one': breakOutbox(
    (workingOutbox) => ({
      commitStateAndEvents: async (param) =>
        param.casVersion === 0
          ? workingOutbox.commitStateAndEvents(param)
          : { committed: false, refusal: 'revision_stale' },
    }),
  ),

  'refuses the stored revision itself as revision_stale': breakOutbox(
    (workingOutbox) =>
      trackLatestRevisions(
        workingOutbox,
        ({ casVersion, latestRevision }) => casVersion !== latestRevision,
      ),
  ),

  'refuses a revision that skips ahead as revision_stale': breakOutbox(
    (workingOutbox) =>
      trackLatestRevisions(
        workingOutbox,
        ({ casVersion, latestRevision }) =>
          latestRevision === undefined || casVersion <= latestRevision + 1,
      ),
  ),

  'refuses a later revision with nothing stored as revision_stale': breakOutbox(
    (workingOutbox) =>
      trackLatestRevisions(
        workingOutbox,
        ({ latestRevision }) => latestRevision !== undefined,
      ),
  ),

  'answers the commit that lost a race as refused, without throwing':
    breakOutbox((workingOutbox) => ({
      commitStateAndEvents: async (param) => {
        const outcome = await workingOutbox.commitStateAndEvents(param);
        if (!outcome.committed) throw new Error(outcome.refusal);
        return outcome;
      },
    })),

  'stores events committed with no state, each with no revision': breakOutbox(
    (workingOutbox) => ({
      commitEvents: (param) =>
        workingOutbox.commitEvents({
          events: param.events.map((event) => ({ ...event, casVersion: 0 })),
        }),
    }),
  ),

  'leaves the stored state alone when events commit with no state': breakOutbox(
    (workingOutbox) => ({
      commitEvents: async (param) => {
        await workingOutbox.commitEvents(param);
        for (const event of param.events) {
          await workingOutbox.commitStateAndEvents({
            executionId: event.executionId,
            casVersion: 1,
            subject: event.subject,
            source: event.source,
            version: '1.0.0',
            lifecycle: 'waiting',
            state: {},
            events: [],
          });
        }
      },
    }),
  ),

  'skips an event already committed when committing a state': breakOutbox(
    (workingOutbox) =>
      throwOnRepeatedEventIds(workingOutbox, 'commitStateAndEvents'),
  ),

  'skips an event already committed when committing events alone': breakOutbox(
    (workingOutbox) => throwOnRepeatedEventIds(workingOutbox, 'commitEvents'),
  ),

  'stores one of two events sharing an identifier in one commit': breakOutbox(
    (workingOutbox) => ({
      commitStateAndEvents: (param) => {
        const eventIds = param.events.map((event) => event.id);
        if (new Set(eventIds).size !== eventIds.length) {
          throw new Error('one commit carries an event identifier twice');
        }
        return workingOutbox.commitStateAndEvents(param);
      },
    }),
  ),

  'returns a payload as exactly the string committed': breakOutbox(
    (workingOutbox) => ({
      commitEvents: (param) =>
        workingOutbox.commitEvents({
          events: param.events.map((event) => ({
            ...event,
            payload: JSON.stringify(JSON.parse(event.payload)),
          })),
        }),
    }),
  ),

  'stores a payload it could not parse as given': breakOutbox(
    (workingOutbox) => ({
      commitEvents: (param) => {
        for (const event of param.events) JSON.parse(event.payload);
        return workingOutbox.commitEvents(param);
      },
    }),
  ),

  'stamps every committed event with an instant and stores it unseen':
    breakOutbox(
      rewriteCommittedEvents((committedEvent) => ({
        ...committedEvent,
        committedAt: new Date(committedEvent.committedAt).toString(),
      })),
    ),

  'stamps every event of one commit with the same instant': breakOutbox(
    rewriteCommittedEvents((committedEvent, position) => ({
      ...committedEvent,
      committedAt: new Date(
        Date.parse(committedEvent.committedAt) + position,
      ).toISOString(),
    })),
  ),

  "reads exactly one delivery's events, as committed": breakOutbox(
    rewriteCommittedEvents((committedEvent) => ({
      ...committedEvent,
      source: 'com_rewritten_source',
    })),
  ),

  'reads every event of one execution, across its deliveries': breakOutbox(
    (workingOutbox) => ({
      readCommittedEvents: async (filter) =>
        (await workingOutbox.readCommittedEvents(filter)).slice(0, 1),
    }),
  ),

  'reads only the events matching both a delivery and an execution':
    breakOutbox((workingOutbox) => ({
      readCommittedEvents: (filter) =>
        workingOutbox.readCommittedEvents(
          'triggeringEventId' in filter
            ? { triggeringEventId: filter.triggeringEventId }
            : filter,
        ),
    })),

  'reads events already seen, marked as seen': breakOutbox(
    rewriteCommittedEvents((committedEvent) => ({
      ...committedEvent,
      seen: false,
    })),
  ),

  'reads nothing for a delivery that committed nothing': breakOutbox(
    (workingOutbox) => ({
      readCommittedEvents: async (filter) => {
        const committedEvents = await workingOutbox.readCommittedEvents(filter);
        return committedEvents.length > 0
          ? committedEvents
          : workingOutbox.listUnseenEvents({ atMost: 1000, olderThanMs: 0 });
      },
    }),
  ),

  'lists unseen events in the order their commits landed': breakOutbox(
    (workingOutbox) => ({
      listUnseenEvents: async (param) =>
        [...(await workingOutbox.listUnseenEvents(param))].reverse(),
    }),
  ),

  'lists no more unseen events than asked for, the oldest': breakOutbox(
    (workingOutbox) => ({
      listUnseenEvents: (param) =>
        workingOutbox.listUnseenEvents({ ...param, atMost: 1000 }),
    }),
  ),

  'lists no unseen event that landed more recently than asked': breakOutbox(
    (workingOutbox) => ({
      listUnseenEvents: (param) =>
        workingOutbox.listUnseenEvents({ ...param, olderThanMs: 0 }),
    }),
  ),

  'lists every unseen event that landed at least as long ago as asked':
    breakOutbox((workingOutbox) => ({
      listUnseenEvents: (param) =>
        workingOutbox.listUnseenEvents({
          ...param,
          olderThanMs: param.olderThanMs + 60_000,
        }),
    })),

  'lists unseen events when asked to lease them, as it would unasked':
    breakOutbox((workingOutbox) => ({
      listUnseenEvents: (param) =>
        param.leaseMs === undefined
          ? workingOutbox.listUnseenEvents(param)
          : [],
    })),

  'opens again without failing, and still works': breakOutbox(() => {
    let openCount = 0;
    return {
      open: () => {
        openCount += 1;
        if (openCount > 1) throw new Error('the outbox is already open');
      },
    };
  }),

  'closes again without failing': breakOutbox((workingOutbox) => {
    let closeCount = 0;
    return {
      close: () => {
        closeCount += 1;
        if (closeCount > 1) throw new Error('the outbox is already closed');
        workingOutbox.close();
      },
    };
  }),

  'throws on every operation once closed': breakOutbox(() => ({
    close: () => undefined,
  })),

  'lists no event once it is marked seen': breakOutbox(() => ({
    markEventsSeen: async () => {},
  })),

  'marks an event seen and changes nothing else about it': breakOutbox(
    (workingOutbox) => {
      const markedEventIds = new Set<string>();
      return {
        markEventsSeen: (eventIds) => {
          for (const eventId of eventIds) markedEventIds.add(eventId);
          return workingOutbox.markEventsSeen(eventIds);
        },
        ...rewriteCommittedEvents((committedEvent) =>
          markedEventIds.has(committedEvent.id)
            ? { ...committedEvent, payload: `${committedEvent.payload} ` }
            : committedEvent,
        )(workingOutbox),
      };
    },
  ),

  'marks an event already seen again without change or failure': breakOutbox(
    (workingOutbox) => {
      const markedEventIds = new Set<string>();
      return {
        markEventsSeen: (eventIds) => {
          for (const eventId of eventIds) {
            if (markedEventIds.has(eventId)) {
              throw new Error(`event ${eventId} is already seen`);
            }
            markedEventIds.add(eventId);
          }
          return workingOutbox.markEventsSeen(eventIds);
        },
      };
    },
  ),

  'ignores an identifier no committed event carries': breakOutbox(
    (workingOutbox) => ({
      markEventsSeen: async (eventIds) => {
        for (const eventId of eventIds) {
          const [listedEvent] = (
            await workingOutbox.listUnseenEvents({
              atMost: 1000,
              olderThanMs: 0,
            })
          ).filter((unseenEvent) => unseenEvent.id === eventId);
          if (listedEvent === undefined) {
            throw new Error(`no committed event carries ${eventId}`);
          }
        }
        await workingOutbox.markEventsSeen(eventIds);
      },
    }),
  ),
};
