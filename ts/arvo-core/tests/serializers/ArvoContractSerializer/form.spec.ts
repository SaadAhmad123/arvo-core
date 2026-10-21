import { describe, expect, it } from 'vitest';
import { validateCanonicalForm } from '../../../src/serializers/ArvoContractSerializer/form.js';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const objectSchema = (overrides: Record<string, unknown> = {}) => ({
  $schema: DIALECT,
  type: 'object',
  properties: { a: { type: 'string' } },
  ...overrides,
});

const form = (overrides: Record<string, unknown> = {}) => ({
  uri: '#/com/order/create',
  type: 'com_order_create',
  description: null,
  domain: null,
  metadata: {},
  versions: {
    '1.0.0': { input: objectSchema(), outputs: {} },
  },
  ...overrides,
});

const paths = (candidate: unknown): string[] =>
  validateCanonicalForm(candidate).map((issue) => issue.path);

describe('a well-formed canonical form', () => {
  it('reports nothing', () => {
    expect(validateCanonicalForm(form())).toEqual([]);
  });

  it('reports nothing for a version declaring outputs', () => {
    expect(
      validateCanonicalForm(
        form({
          versions: {
            '1.0.0': {
              input: objectSchema(),
              outputs: { com_order_created: objectSchema() },
            },
          },
        }),
      ),
    ).toEqual([]);
  });

  it('does not insist on an optional field being present', () => {
    // Writing a form must materialize these; reading one that omitted them
    // should not reject a contract whose identity is intact.
    const { description, domain, metadata, ...withoutOptionals } = form();
    void [description, domain, metadata];
    expect(validateCanonicalForm(withoutOptionals)).toEqual([]);
  });
});

describe('the container', () => {
  it('rejects something that is not an object at all', () => {
    expect(paths('not a form')).toEqual(['form']);
    expect(paths([])).toEqual(['form']);
    expect(paths(null)).toEqual(['form']);
  });

  it('rejects a missing type', () => {
    const { type, ...withoutType } = form();
    void type;
    expect(paths(withoutType)).toContain('type');
  });

  it('rejects a non-string type', () => {
    expect(paths(form({ type: 42 }))).toContain('type');
  });

  it('rejects a missing versions', () => {
    const { versions, ...withoutVersions } = form();
    void versions;
    expect(paths(withoutVersions)).toContain('versions');
  });

  it('rejects a versions declaring nothing', () => {
    expect(paths(form({ versions: {} }))).toContain('versions');
  });

  it('names what is missing rather than failing generically', () => {
    const issues = validateCanonicalForm(form({ versions: {} }));
    expect(issues[0]?.message).toContain('at least one version');
  });
});

describe('a schema position', () => {
  const formWithInput = (input: unknown) =>
    form({ versions: { '1.0.0': { input, outputs: {} } } });

  it('rejects one describing an object without the literal keyword', () => {
    // Legal JSON Schema, and rejected on purpose: once converted there is no
    // way to tell it apart from one that carried the keyword.
    const composed = {
      $schema: DIALECT,
      allOf: [{ properties: { a: { type: 'string' } } }],
    };
    expect(paths(formWithInput(composed))).toContain('versions["1.0.0"].input');
  });

  it('names the keyword it wanted', () => {
    const issues = validateCanonicalForm(
      formWithInput({ $schema: DIALECT, type: 'string' }),
    );
    expect(issues[0]?.message).toContain('"type": "object"');
  });

  it('rejects one describing a non-object', () => {
    expect(paths(formWithInput({ $schema: DIALECT, type: 'array' }))).toContain(
      'versions["1.0.0"].input',
    );
  });

  it('rejects one that is not a schema object', () => {
    expect(paths(formWithInput('a string'))).toContain(
      'versions["1.0.0"].input',
    );
  });

  it('rejects a missing dialect declaration', () => {
    const issues = validateCanonicalForm(
      formWithInput({ type: 'object', properties: {} }),
    );
    expect(issues.map((issue) => issue.message).join(' ')).toContain('$schema');
  });

  it('rejects the wrong dialect', () => {
    const issues = validateCanonicalForm(
      formWithInput({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      }),
    );
    expect(issues.map((issue) => issue.message).join(' ')).toContain('$schema');
  });

  it('checks every emit, not only input', () => {
    expect(
      paths(
        form({
          versions: {
            '1.0.0': {
              input: objectSchema(),
              outputs: { com_a_done: { $schema: DIALECT, type: 'string' } },
            },
          },
        }),
      ),
    ).toContain('versions["1.0.0"].outputs["com_a_done"]');
  });

  it('checks every version, not only the first', () => {
    const issuePaths = paths(
      form({
        versions: {
          '1.0.0': { input: objectSchema(), outputs: {} },
          '1.1.0': { input: { $schema: DIALECT, type: 'string' }, outputs: {} },
        },
      }),
    );
    expect(issuePaths).toContain('versions["1.1.0"].input');
  });

  it('rejects a version that is not an object', () => {
    expect(paths(form({ versions: { '1.0.0': 'nope' } }))).toContain(
      'versions["1.0.0"]',
    );
  });

  it('rejects a non-object outputs', () => {
    expect(
      paths(
        form({ versions: { '1.0.0': { input: objectSchema(), outputs: 3 } } }),
      ),
    ).toContain('versions["1.0.0"].outputs');
  });
});

describe('what it leaves to the contract', () => {
  it('says nothing about identifier grammar', () => {
    // `Bad_Key` breaks the contract's own rules, and the contract reports it.
    // Reporting it here too would say the same thing twice in different words.
    const issues = validateCanonicalForm(
      form({
        type: 'Com_Order_Create',
        versions: {
          '1.0.0': {
            input: objectSchema(),
            outputs: { Bad_Key: objectSchema() },
          },
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  it('says nothing about version-key grammar', () => {
    expect(
      validateCanonicalForm(
        form({
          versions: { '01.0.0': { input: objectSchema(), outputs: {} } },
        }),
      ),
    ).toEqual([]);
  });
});
