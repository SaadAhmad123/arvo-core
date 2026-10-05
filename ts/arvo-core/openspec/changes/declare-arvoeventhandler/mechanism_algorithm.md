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
            commit(record, events)          # together, or neither
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
                commit(fault.abandonmentState, [fault.abandonmentEvent])
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

```
commit(record, events):

    atomically:
        if record.casVersion == 0:
            create the record, failing if one already exists
        else:
            write the record, failing unless the stored revision is
                record.casVersion - 1
        hold the events alongside it

    # after the write succeeded, and what is published is what was held —
    # never something produced a second time
    publish(events)
```

Where the write is refused, the events of this delivery are not published.
What is published instead is whatever the winning writer committed for
this triggering event, read back rather than produced again — which is why
nothing here requires a handler to be deterministic.

`publish` is the only at-least-once edge. `commit` is atomic; publishing
after it is not. So an event can arrive twice, and a receiver discarding a
repeat is what makes that safe rather than wrong.

## Answering from outside

There is no resume. The answer is ordinary work, and `run` is the same
function it was the first time — which is only true because the state
resolver is injected, so nothing had to be kept alive in between.

```
answer(domainedEvent, decision, deps):

    trace = activeSpanContext()                  # the answerer's own, if any
    if trace is null:
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

The trace continues either way: the answerer's own span context where it
has one, and otherwise the trace of the request that left the lattice — so
a review answered hours later still hangs off the run that asked for it.

## What each mechanism supplies

| the algorithm's | a mechanism's |
|---|---|
| `work` | a task queue, a channel, an array |
| the loop itself | a workflow, a process, a function |
| `execute`'s retries | the framework's retry policy, declared to agree with the fault |
| `commit`'s atomicity | a transaction, or a single durable decision |
| `publish` | starting the next delivery |
| `deps.state` | a read keyed on the identifier the handler supplied |

Everything else is the same.
