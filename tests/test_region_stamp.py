def test_metadata_schema_version_is_4():
    from src.core.schema_versions import METADATA_SCHEMA_VERSION
    assert METADATA_SCHEMA_VERSION == 4
