from src.core.schema_versions import METADATA_SCHEMA_VERSION


def test_schema_version_is_v5_for_map_search():
    assert METADATA_SCHEMA_VERSION == 5
