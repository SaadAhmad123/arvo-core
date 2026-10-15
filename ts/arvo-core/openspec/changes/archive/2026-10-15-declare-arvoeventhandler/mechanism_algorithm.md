# The mechanism algorithm

What a mechanism running Arvo handlers actually does, at the level that is
the same in every mechanism. Temporal, DBOS, a plain in-process loop and a
tape recorder differ in how they hold the work queue and the record store,
and in nothing else below.

This is the canonical statement. Where an implementation in this change
disagrees with it, the implementation is wrong.

## What the loop is not allowed to do

ADR-006 gives classification and identity to the handler, in as many
words: *a mechanism that classifies, derives, or filters on the handler's
behalf has taken a decision this ADR gives the handler, and is
non-conformant even where it happens to be right.*

So the loop never asks:

- whether an event opens an execution or answers one
- which execution an event concerns
- what an execution's identifier is
- what a record should say next

It reads `source` on the way in, and `domain` and `to` on each emission.
That is the whole of what it reads.

The execution identifier is never derived by a mechanism. The handler
supplies it when it calls the state resolver, which is the only place a
mechanism needs one.

## Obligations on anything sending in from outside

An initEvent, and the answer to a domained event, both come from outside
the lattice. Both are the sender's to address correctly.

1. **`source` MUST NOT be any handler's contract type.** Otherwise an
   event addressed back to it is indistinguishable from work addressed to
   that handler.

2. **`source` IS the address this run answers to.** A party answering a
   domained event speaks for the run's caller, so it sends with the same
   `source` the initEvent used. A handler addresses its completion to the
   source fixed when its execution was opened, and whoever resumes cannot
   change that. `run` states this upfront.

3. **A root event MUST carry `to`, and it MUST be its own `type`**
   (`docs/adr/006-arvoeventhandler-protocol.md`, *A root event must carry
   `to`*).

`to` is the only thing that names where an event goes. It is matched
against a handler's own contract type and nothing else about either.

## The loop

```
run(event, deps):
    #   event   the event entering the lattice: an initEvent, or an answer
    #           to something that left it. The same call either way.
    #   deps    what a handler is given, the state resolver included.
    #           Injected, so the loop remembers nothing between turns.

    answersTo = event.source        # where this run answers, off the event

    work      = queue([event])      # the only thing that drives the loop
    domained  = []                  # events that left the lattice
    responses = []                  # the run's answer to its caller

    while work is not empty:

        delivered = work.take()

        for emitted in execute(lattice[delivered.to], delivered, deps):

            if emitted.domain is not null:
                domained.append(emitted)                  # left the lattice

            else if emitted.to == answersTo:
                responses.append(emitted)                 # the run's answer

            else if lattice[emitted.to] is not null:
                work.put(emitted)                         # ordinary work

            else:
                throw UnroutableEmission(
                    emitted.id, emitted.type, emitted.to,
                    "addressed to neither a handler in this lattice nor the "
                    "caller this run answers to")

    # the work queue has drained; exactly one of these holds
    if responses is not empty: return ANSWERED(responses)
    if domained  is not empty: return WAITING_ON_OUTSIDE(domained)
    return NOTHING
```

Only `work` is a queue. `domained` and `responses` are accumulators — a
list, a set, whatever the implementation finds convenient. Neither ever
causes another turn of the loop.

The order of the four branches is load-bearing. A domained event addressed
back to the caller is domained, not a response.

The fourth branch throws rather than collecting. A handler emitting to an
address that exists nowhere is a declaration error, and the gate cannot
catch it — both values of `to` are structurally valid. Collecting it
quietly would let a run report `ANSWERED` while having dropped work, and
the two outcomes look identical from outside. The error is raised where
the emission is sorted, so it names the handler that emitted it and the
`to` it chose.

## One delivery

```
execute(handler, event, deps):

    attempt = 0

    loop:
        outcome = handler.execute(event, deps.state, attempt, deps)

        case PRODUCED(record, events):
            # stored as one revision, { state, events }, or not at all
            written = commit(record.executionId, event.id, record, events)
            if written is REFUSED:
                # someone else wrote this revision; what the world is told
                # is what they committed for this same event
                return committedFor(record.executionId, event.id)
            return events

        case DISCARDED:
            return []                       # already processed; nothing to do

        case FAULT(fault):

            if fault.retry is not null:
                wait(fault.retry.delay)
                attempt = attempt + 1
                continue                    # same event, next attempt

            # nothing will fix it. Act on exactly what the fault carries
            # and add nothing of your own.

            if fault.abandonmentState is not null:
                commit(fault.abandonmentState.executionId, event.id,
                       fault.abandonmentState, [fault.abandonmentEvent])
                return [fault.abandonmentEvent]

            if fault.abandonmentEvent is not null:
                return [fault.abandonmentEvent]   # no record to keep it with

            return []                       # already answered; nobody to tell
```

Every retry is a fresh delivery of the same event with the attempt
incremented, and the attempt is the only thing that carries forward. The
record is re-read and the dependencies re-resolved on each one.

A fault carries both halves of an abandonment, the event alone, or
neither. Each is acted on as it stands, and nothing of the mechanism's own
is added (`docs/adr/008-arvoeventhandler-faults-and-abandonment.md`).

`record_unexpected` is the case a mechanism is most likely to get wrong.
An opening event for an execution that already exists is a redelivery, not
a failure; treating it as one publishes a handler error for work that
succeeded.

## Commit

A revision is not a record. It is `{ state, events }` — the record the
handler wrote and every event it produced, stored as one thing. That is
what makes publishing recoverable: whatever happens after the write, the
events are still there to be sent, exactly as they were committed.

```
commit(executionId, triggeringEventId, record, events):

    atomically:
        if record.casVersion == 0:
            create revision 0, failing if the execution already has one
        else:
            append the revision, failing unless the stored one is
                record.casVersion - 1

        the revision is { state:    record,
                          events:   events,
                          publishedAt: none,
                          triggeredBy: triggeringEventId }

    # a separate step, after the write succeeded
    publish(executionId, record.casVersion)


publish(executionId, casVersion):
    revision = read(executionId, casVersion)
    for event in revision.events:
        send(event)                 # the bytes that were committed
    mark revision published
```

`publish` reads the events back out rather than taking them from the
caller, so the same function recovers a revision whose events never went
anywhere. Nothing asks an executor to produce them a second time, which
is why no handler here has to be deterministic.

```
recover():
    for revision in revisions where publishedAt is none, oldest first:
        publish(revision.executionId, revision.casVersion)
```

Two readers need a revision's events after the fact, and both read the
same stored thing:

- **the recovery pass above**, for a revision committed by something that
  stopped existing before it published
- **a repeat delivery**, which finds the work already done and must hand
  back what was committed for its triggering event rather than nothing —
  `triggeredBy` is what makes that a keyed read

Where a write is refused, this delivery's events are not published at all.
What is published is whatever the winning writer committed for the same
triggering event.

`publish` is the only at-least-once edge. The write is atomic; sending
after it is not, and a send that half-succeeded is retried from the
store. So an event can arrive twice, and a receiver discarding a repeat
is what makes that safe rather than wrong.

## Answering from outside

There is no resume. The answer is ordinary work, and `run` is the same
function it was the first time — which is only true because the state
resolver is injected, so nothing had to be kept alive in between.

```
answer(domainedEvent, decision, deps, span):
    #   span   the answerer's own span, or null where it has none.
    #          Passed in rather than read from an ambient context: the
    #          party answering may be a request handler, a batch job or a
    #          desk a person works at, and only it knows which trace this
    #          answer belongs to.

    if span is not null:
        trace = traceContextFromSpan(span)
    else:
        # the trace of the request that left the lattice, so an answer
        # still hangs off the run that asked for it
        trace = { traceparent: domainedEvent.traceparent,
                  tracestate:  domainedEvent.tracestate }

    reply = build(decision,
                  to          = domainedEvent.source,  # the handler that asked
                  source      = the run's own answer address,
                  initid      = domainedEvent.id,      # what it answers
                  parentid    = domainedEvent.id,
                  traceparent = trace.traceparent,
                  tracestate  = trace.tracestate)

    return run(reply, deps)
```

Either way the trace continues, so a review answered hours later is still
one trace with the run that asked for it.

## What each mechanism supplies

| the algorithm's | a mechanism's |
|---|---|
| `work` | a task queue, a channel, an array |
| the loop itself | a workflow, a process, a function |
| `execute`'s retries | the framework's retry policy, declared to agree with the fault |
| a revision, `{ state, events }` | a row and its outbox rows, a workflow's state |
| `commit`'s atomicity | a transaction, or a single durable decision |
| `publish` | starting the next delivery |
| `recover` | a sweep over unpublished revisions |
| `deps.state` | a read keyed on the identifier the handler supplied |

Everything else is the same.
