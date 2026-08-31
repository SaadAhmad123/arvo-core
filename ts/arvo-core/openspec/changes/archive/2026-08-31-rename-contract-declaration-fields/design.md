## Context

See `proposal.md` — Why, and Governance for why ADR-005 is amended rather than superseded. This document records only what the rename touches and what it deliberately does not, since the behaviour is unchanged: every rule keeps its meaning and only its words move.

The one fact that shapes the work: `accepts` and `emits` live in three distinct roles, and only the first is free.

| Role | Where | Renamable? |
|---|---|---|
| Canonical JSON keys | the serializer's written and read form | Model-level. ADR-005 fixes them |
| Issue-path segments and message labels | validator, form check, payload check | Observable — a caller compares them |
| TypeScript identifiers and mapped-type keys | the contract and factory surfaces | API shape, free |

## Goals / Non-Goals

**Goals**

- One vocabulary from the ADR through the canonical JSON to every language surface.
- No behavioural change whatsoever: the suite's assertions move, its expectations do not.
- Nothing in any document naming a field that no longer exists.

**Non-Goals**

- Anything in `proposal.md` — Out of Scope.
- Improving anything while passing through. A rename that also fixes things cannot be reviewed as a rename.

## Decisions

### The scope value is `'output'`, singular, where the field is `outputs`

The field holds a map, so it is plural. The `scope` on an assertion result names **the one event in hand**, so it is singular. That is the only place a name diverges from the field it refers to, and the divergence is the point: `asserted.scope === 'output'` reads as a statement about this event, which is what it is.

*Alternative rejected:* spelling the scope `'outputs'` for exact symmetry. It would read as though a single event were several.

### The handler error keeps its model vocabulary and loses only its accessor

`version.handlerError` becomes `version.error`. Everything that names the *concept* stays: `HandlerErrorContract`, `handlerErrorType`, `HANDLER_ERROR_SCHEMA`, `HandlerErrorPayload`, `HandlerErrorType`.

ADR-005 still calls the thing a handler error, still fixes its type as `handler_{type}_error`, and still fixes its payload keys. Renaming the TypeScript names for it would leave `contractErrorType()` returning a string beginning `handler_`, which is worse than a slightly long name.

### English survives where "accepts" is a verb

The words are also ordinary English, and a mechanical rename does not know the difference. Three prose uses in ADR-005, a handful in the specs, and about fourteen test titles say that something *accepts* a value — those stay. A grep that returns zero would mean the sweep had damaged the prose.

### Two mechanical traps, recorded because both bit

**Quoted-literal replacement catches indexed access types.** `C['emits']` is a type expression, not a string, so a pass rewriting `'emits'` turns it into `C['output']` — plausible-looking and wrong, since the field is plural. Fixed by renaming indexed accesses before bare literals.

**The same pass catches prose.** Fourteen test titles read "input a null stack" until restored. Neither trap fails a test — the first fails the compiler, the second fails nothing at all, which is why it is worth writing down.

## Risks / Trade-offs

**A stored canonical form written before this change no longer reads** → None exists outside this repository's tests, and nothing is published. The serializer's round-trip tests cover the new keys in both directions.

**ADR-005 now contradicts its own line 23** → Accepted deliberately; argued in `proposal.md` — Governance. Git retains the sequence.

**The rename is invisible in every record** → That is the intent. The cost is that a reader cannot discover the old vocabulary from the documents; the mitigation is that they never need to, since nothing published uses it.

## Migration Plan

None. Nothing published, and no stored contract document exists outside this repository.
