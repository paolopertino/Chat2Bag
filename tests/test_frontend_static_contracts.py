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


def test_omnibox_confirms_region_support_with_explicit_points():
    hook = (
        ROOT
        / "frontend"
        / "src"
        / "hooks"
        / "use-omnibox-search.ts"
    ).read_text(encoding="utf-8")
    component = (
        ROOT
        / "frontend"
        / "src"
        / "components"
        / "omnibox"
        / "omnibox.tsx"
    ).read_text(encoding="utf-8")

    assert "submitSupportRegion: (points: Point[]) => void;" in hook
    assert "function submitSupportRegion(nextPoints: Point[])" in hook
    assert "runRegion(url.topK, nextPoints)" in hook
    assert "region.runImage(support.file, support.objectUrl, regionPoints" in hook
    assert "region.runFrame(support.filePath, regionPoints" in hook
    assert "search.submitSupportRegion(points)" in component
    assert "search.setPoints(points);\n            setSupportDialogOpen(false);\n            if (points.length > 0) search.submit();" not in component


def test_search_input_allows_explicit_non_text_submit_enablement():
    source = (
        ROOT
        / "frontend"
        / "src"
        / "components"
        / "search"
        / "search-input.tsx"
    ).read_text(encoding="utf-8")

    assert "canSubmit?: boolean;" in source
    assert "const submitEnabled = canSubmit ?? Boolean(value.trim());" in source
    assert "disabled={disabled || !submitEnabled}" in source
