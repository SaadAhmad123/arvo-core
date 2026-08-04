/** Fixed protocol-level values — constants of the transformation itself, carried by no ArvoEvent field. */
export const SPEC_VERSION = '1.0';
export const ARVO_MEDIA_TYPE = 'application/vnd.arvo.event+json';
export const DATA_CONTENT_TYPE = `${ARVO_MEDIA_TYPE};version=1`;
export const DATA_SCHEMA = 'https://www.arvo.land/schemas/cloudevent-data/v1';

/** The `data` wrapper's exact, exhaustive key set — no more, no fewer. */
export const WRAPPER_KEYS = [
  'arvoeventdata',
  'arvoeventdataschema',
  'arvoeventbaggage',
] as const;

/** `arvodepth`'s canonical unsigned-decimal grammar: no sign, leading zero, decimal point, or exponent. */
export const DEPTH_GRAMMAR = /^(0|[1-9][0-9]*)$/;
