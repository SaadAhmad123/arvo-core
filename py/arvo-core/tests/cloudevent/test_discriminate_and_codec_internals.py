import pytest
from cloudevents.v1.pydantic.v2.event import CloudEvent

from arvo_core.cloudevent.codecs import decode_execution_units, parse_data_content_type
from arvo_core.cloudevent.constants import DATACONTENTTYPE, DATASCHEMA
from arvo_core.cloudevent.discriminate import extract_arvo_fields


def _valid_kwargs() -> dict:
    return {
        "id": "1",
        "source": "s",
        "type": "t",
        "subject": "subj",
        "time": "2026-01-01T00:00:00.000Z",
        "specversion": "1.0",
        "datacontenttype": DATACONTENTTYPE,
        "dataschema": DATASCHEMA,
        "data": {
            "arvoeventdata": {},
            "arvoeventdataschema": "#/x",
            "arvoeventbaggage": {},
        },
        "arvoexecutionid": "subj",
        "arvodepth": "0",
    }


def test_extract_succeeds_on_a_fully_valid_event() -> None:
    fields = extract_arvo_fields(CloudEvent(**_valid_kwargs()))
    assert fields["subject"] == "subj"
    assert fields["depth"] == 0


def test_wrong_specversion_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["specversion"] = "0.3"
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="specversion"):
        extract_arvo_fields(ce)


def test_datacontenttype_with_wrong_version_parameter_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["datacontenttype"] = "application/vnd.arvo.event+json;version=2"
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="version=1"):
        extract_arvo_fields(ce)


def test_dataschema_mismatch_with_correct_media_type_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["dataschema"] = "https://example.com/other"
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="dataschema"):
        extract_arvo_fields(ce)


def test_missing_subject_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["subject"] = None
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="subject"):
        extract_arvo_fields(ce)


def test_missing_time_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["time"] = None
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="time is required"):
        extract_arvo_fields(ce)


def test_non_object_arvoeventdata_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["data"] = {**kwargs["data"], "arvoeventdata": "not-an-object"}
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="arvoeventdata"):
        extract_arvo_fields(ce)


def test_empty_arvoeventdataschema_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["data"] = {**kwargs["data"], "arvoeventdataschema": ""}
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="arvoeventdataschema"):
        extract_arvo_fields(ce)


def test_non_object_arvoeventbaggage_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["data"] = {**kwargs["data"], "arvoeventbaggage": "not-an-object"}
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="arvoeventbaggage"):
        extract_arvo_fields(ce)


def test_non_string_arvoexecutionid_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["arvoexecutionid"] = 5
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="arvoexecutionid"):
        extract_arvo_fields(ce)


def test_non_string_arvodepth_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["arvodepth"] = 0
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="arvodepth"):
        extract_arvo_fields(ce)


def test_non_string_optional_extension_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["arvocategory"] = 5
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="arvocategory"):
        extract_arvo_fields(ce)


def test_non_string_arvoexecutionunits_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["arvoexecutionunits"] = 5
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="arvoexecutionunits"):
        extract_arvo_fields(ce)


def test_non_canonical_arvoexecutionunits_string_is_rejected() -> None:
    kwargs = _valid_kwargs()
    kwargs["arvoexecutionunits"] = "1.50"
    ce = CloudEvent(**kwargs)
    with pytest.raises(ValueError, match="arvoexecutionunits"):
        extract_arvo_fields(ce)


def test_decode_execution_units_rejects_a_non_numeric_string() -> None:
    assert decode_execution_units("not-a-number") is None


def test_decode_execution_units_rejects_a_non_finite_value() -> None:
    assert decode_execution_units("inf") is None
    assert decode_execution_units("nan") is None


def test_parse_data_content_type_rejects_an_empty_media_type() -> None:
    assert parse_data_content_type(";version=1") is None


def test_parse_data_content_type_ignores_a_parameter_without_equals() -> None:
    parsed = parse_data_content_type("application/json;bogus;version=1")
    assert parsed is not None
    assert parsed.params == {"version": "1"}


def test_parse_data_content_type_returns_none_for_none_and_empty() -> None:
    assert parse_data_content_type(None) is None
    assert parse_data_content_type("") is None
