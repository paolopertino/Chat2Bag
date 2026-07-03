"""App-side bridge: AppConfig.region_search → data_extraction_lib IndexSettings.

The library's index components take an explicit IndexSettings (mechanism, not policy);
this thin adapter drops the app-only fields (``enabled``, ``engine``) and forwards the
dense build and search parameters. It is the index analogue of embedding_settings_from_config.
"""

from data_extraction_lib.index import IndexSettings

from chat2bag.core.app_config import AppConfig


def index_settings_from_config(config: AppConfig) -> IndexSettings:
    """Map the webapp's region-search config onto the library's IndexSettings."""
    rc = config.region_search
    return IndexSettings(
        pq_m=rc.pq_m,
        pq_nbits=rc.pq_nbits,
        ivf_nlist=rc.ivf_nlist,
        ivf_nprobe=rc.ivf_nprobe,
        min_patches_for_pq=rc.min_patches_for_pq,
        train_sample_cap=rc.train_sample_cap,
        patch_fetch_limit=rc.patch_fetch_limit,
        top_k_patches=rc.top_k_patches,
        refine_enabled=rc.refine_enabled,
        refine_top_n=rc.refine_top_n,
        text_templates=rc.text_templates,
    )
