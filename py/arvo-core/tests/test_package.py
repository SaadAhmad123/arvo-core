import arvo_core


def test_package_is_importable() -> None:
    assert isinstance(arvo_core.__version__, str)
