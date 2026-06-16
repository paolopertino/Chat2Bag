from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def test_heatmap_fetch_effect_does_not_self_cancel():
    # The lazy heatmap-fetch effect (extracted into the use-heatmaps hook) must
    # not list the accumulated state in its dependency array, or it would re-run
    # on every fetch and cancel itself; results are tracked via a ref instead.
    source = (
        ROOT
        / "frontend"
        / "src"
        / "hooks"
        / "use-heatmaps.ts"
    ).read_text(encoding="utf-8")
    start = source.index("if (!enabled || !fetchHeatmap")
    match = re.search(r"\}, \[([^\]]*)\]\);", source[start:])

    assert match is not None
    dependencies = {part.strip() for part in match.group(1).split(",")}
    assert "heatmaps" not in dependencies
    assert "heatmapLoading" not in dependencies
    assert "heatmapsRef" in source


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

    # Region support is confirmed with the points passed explicitly into
    # submitSupportRegion (plus the optionally switched camera frame), rather
    # than reading stale `search.points` state.
    assert "submitSupportRegion: (points: Point[], chosenFilePath?: string) => void;" in hook
    assert "function submitSupportRegion(nextPoints: Point[], chosenFilePath?: string)" in hook
    assert "runRegionWith(effective, url.topK, nextPoints)" in hook
    assert "region.runImage(src.file, src.objectUrl, regionPoints" in hook
    assert "region.runFrame(src.filePath, regionPoints" in hook
    assert "search.submitSupportRegion(points, chosenFilePath)" in component


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


def test_draft_state_tracks_source_transitions_without_value_key_staleness():
    helper = ROOT / "frontend" / "src" / "hooks" / "use-source-draft.ts"
    assert helper.exists()
    helper_source = helper.read_text(encoding="utf-8")

    assert "sourceRevision: draft.sourceRevision + 1" in helper_source
    assert "if (sourceChanged) {" in helper_source
    assert "setDraftState(nextDraft);" in helper_source
    assert "useRef" not in helper_source

    for relative in [
        "frontend/src/hooks/use-omnibox-search.ts",
    ]:
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "useSourceDraft" in source
        assert ".sourceQ ===" not in source
        assert ".sourceKey ===" not in source


def test_omnibox_support_chip_is_extracted():
    support_chip = ROOT / "frontend" / "src" / "components" / "omnibox" / "support-chip.tsx"
    omnibox = (
        ROOT
        / "frontend"
        / "src"
        / "components"
        / "omnibox"
        / "omnibox.tsx"
    ).read_text(encoding="utf-8")

    assert support_chip.exists()
    support_source = support_chip.read_text(encoding="utf-8")
    assert "export function SupportChip" in support_source
    assert 'from "./support-chip"' in omnibox
