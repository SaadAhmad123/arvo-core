/**
 * A single, reversible transformation stage between two shapes.
 *
 * Both directions are mandatory — there is no way to construct a one-way
 * stage — so a chain of stages always has a reverse, even though nothing
 * here can guarantee that a consumer's own `convert`/`revert` pair is
 * itself lossless.
 */
export interface IConverter<I, O> {
  convert(data: I): Promise<O>;
  revert(data: O): Promise<I>;
}
