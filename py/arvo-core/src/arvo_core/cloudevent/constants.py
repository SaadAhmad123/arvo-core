"""Fixed protocol-level values and field-name mappings for CloudEvent transformation."""

from __future__ import annotations

SPECVERSION = "1.0"
DATACONTENTTYPE = "application/vnd.arvo.event+json;version=1"
ARVO_MEDIA_TYPE = "application/vnd.arvo.event+json"
DATASCHEMA = "https://www.arvo.land/schemas/cloudevent-data/v1"

DATA_WRAPPER_KEYS = frozenset(
    {"arvoeventdata", "arvoeventdataschema", "arvoeventbaggage"}
)

# ArvoEvent field name -> CloudEvent extension attribute name, for fields
# with no CloudEvents-native home. Omitted from a CloudEvent entirely when
# the ArvoEvent field is `None`.
NULLABLE_EXTENSIONS: dict[str, str] = {
    "parentid": "arvoparentid",
    "initid": "arvoinitid",
    "category": "arvocategory",
    "to": "arvoto",
    "domain": "arvodomain",
}

# Always present -- `executionid` and `depth` have no default that means
# "absent" the way the fields above do.
EXECUTIONID_EXTENSION = "arvoexecutionid"
DEPTH_EXTENSION = "arvodepth"
EXECUTIONUNITS_EXTENSION = "arvoexecutionunits"

# Reused from the CloudEvents Distributed Tracing Extension, unprefixed.
TRACING_EXTENSIONS = ("traceparent", "tracestate")
