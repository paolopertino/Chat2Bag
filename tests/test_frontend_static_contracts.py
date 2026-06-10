from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def test_sample_lightbox_heatmap_fetch_effect_does_not_self_cancel():
    source = (
        ROOT
        / "frontend"
        / "src"
        / "components"
        / "search"
        / "sample-result-lightbox.tsx"
    ).read_text(encoding="utf-8")
    start = source.index('if (!showHeatmaps || !fetchHeatmap')
    effect_tail = source[start:source.index("  useEffect(() => {\n    const onKey", start)]
    match = re.search(r"\}, \[([^\]]*)\]\);", effect_tail)

    assert match is not None
    dependencies = {part.strip() for part in match.group(1).split(",")}
    assert "heatmaps" not in dependencies
    assert "heatmapLoading" not in dependencies
