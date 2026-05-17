import { LoaderCircle } from "lucide-react";

import { BagList } from "../components/bags/bag-list";
import { BagScanner } from "../components/bags/bag-scanner";
import { ExtractDatasetDialog } from "../components/extraction/extract-dataset-dialog";
import { JobsPanel } from "../components/extraction/jobs-panel";
import { useSidebar } from "../components/layout/sidebar-slot";
import { Sidebar } from "../components/layout/sidebar";
import { ResultsGrid } from "../components/search/results-grid";
import { SequenceViewer } from "../components/search/sequence-viewer";
import { SearchBar } from "../components/search/search-bar";
import { useBags } from "../context/bags-context";
import { useExtractionJobs } from "../hooks/use-extraction-jobs";
import { useExtractionLauncher } from "../hooks/use-extraction-launcher";
import { useSearch } from "../hooks/use-search";
import { useSequenceViewer } from "../hooks/use-sequence-viewer";

export function WorkspacePage() {
  const {
    rootDir,
    setRootDir,
    bags,
    selectedBagPaths,
    isScanning,
    isPolling,
    onScan,
    onIndex,
    toggleBagSelection,
    toggleAllBags,
  } = useBags();

  const {
    query,
    setQuery,
    topK,
    setTopK,
    results,
    isSearching,
    runSearch,
    runImageSearch,
    runSimilarSearch,
  } = useSearch();

  const {
    activeFrame,
    canLoadMoreLeft,
    canLoadMoreRight,
    chatDuration,
    chatQuery,
    chatResponse,
    closeViewer,
    frames,
    isExtendingLeft,
    isExtendingRight,
    isChatting,
    isFrameInVlmWindow,
    isLoadingFrames,
    isOpen,
    loadMoreLeft,
    loadMoreRight,
    openViewer,
    runChat,
    selectNextFrame,
    selectPreviousFrame,
    selectedFrameIndex,
    selectedResult,
    selectedTimestampNs,
    setChatDuration,
    setChatQuery,
    setSelectedTimestampNs,
    vlmWindowEndNs,
    vlmWindowStartNs,
  } = useSequenceViewer();

  const {
    jobs,
    schema,
    extractionEnabled,
    isPolling: isExtractionPolling,
    refresh: refreshJobs,
    cancelJob,
    fetchLogs,
  } = useExtractionJobs();

  const {
    isOpen: isExtractOpen,
    isSubmitting,
    bagPath: extractBagPath,
    windowS,
    outputFolder,
    userConfig,
    open: openExtract,
    close: closeExtract,
    submit: submitExtract,
    setBagPath: setExtractBagPath,
    setWindowS,
    setOutputFolder,
    setFieldValue,
  } = useExtractionLauncher(schema, refreshJobs);

  const handleExtractDataset = () => {
    if (!selectedResult || selectedTimestampNs === null) return;
    openExtract({
      bagPath: selectedResult.bag_path,
      centerNs: selectedTimestampNs,
      defaultWindowS: chatDuration,
    });
  };

  useSidebar(
    () => (
      <Sidebar
        extractionEnabled={extractionEnabled}
        scanner={
          <BagScanner
            rootDir={rootDir}
            onRootDirChange={setRootDir}
            onScan={onScan}
            isScanning={isScanning}
          />
        }
        bags={
          <BagList
            bags={bags}
            selectedBagPaths={selectedBagPaths}
            onToggleBag={toggleBagSelection}
            onToggleAllBags={toggleAllBags}
            onIndex={onIndex}
          />
        }
        footer={
          isPolling || isExtractionPolling ? (
            <p className="flex items-center gap-2 text-xs text-[var(--ink-soft)]">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {isPolling ? "Polling indexing status..." : "Polling extraction jobs..."}
            </p>
          ) : null
        }
        jobs={<JobsPanel jobs={jobs} onCancel={cancelJob} onFetchLogs={fetchLogs} />}
      />
    ),
    [
      extractionEnabled,
      rootDir,
      setRootDir,
      onScan,
      isScanning,
      bags,
      selectedBagPaths,
      toggleBagSelection,
      toggleAllBags,
      onIndex,
      isPolling,
      isExtractionPolling,
      jobs,
      cancelJob,
      fetchLogs,
    ],
  );

  return (
    <div className="space-y-6">
      <SearchBar
        query={query}
        onQueryChange={setQuery}
        topK={topK}
        onTopKChange={setTopK}
        onSearch={() => runSearch(selectedBagPaths)}
        onImageUpload={(file) => {
          void runImageSearch(file, selectedBagPaths);
        }}
        isSearching={isSearching}
        selectedBagCount={selectedBagPaths.length}
      />
      <ResultsGrid
        results={results}
        isSearching={isSearching}
        onResultClick={openViewer}
        onSimilarSearch={(result) => {
          void runSimilarSearch(result, selectedBagPaths);
        }}
      />
      <SequenceViewer
        activeFrame={activeFrame}
        canLoadMoreLeft={canLoadMoreLeft}
        canLoadMoreRight={canLoadMoreRight}
        chatDuration={chatDuration}
        chatQuery={chatQuery}
        chatResponse={chatResponse}
        extractionEnabled={extractionEnabled}
        frames={frames}
        isExtendingLeft={isExtendingLeft}
        isExtendingRight={isExtendingRight}
        isChatting={isChatting}
        isFrameInVlmWindow={isFrameInVlmWindow}
        isLoadingFrames={isLoadingFrames}
        isOpen={isOpen}
        onChat={runChat}
        onChatDurationChange={setChatDuration}
        onChatQueryChange={setChatQuery}
        onClose={closeViewer}
        onExtractDataset={handleExtractDataset}
        onLoadMoreLeft={loadMoreLeft}
        onLoadMoreRight={loadMoreRight}
        onSelectNextFrame={selectNextFrame}
        onSelectPreviousFrame={selectPreviousFrame}
        onSelectTimestamp={setSelectedTimestampNs}
        result={selectedResult}
        selectedFrameIndex={selectedFrameIndex}
        selectedTimestampNs={selectedTimestampNs}
        vlmWindowEndNs={vlmWindowEndNs}
        vlmWindowStartNs={vlmWindowStartNs}
      />
      {extractionEnabled ? (
        <ExtractDatasetDialog
          isOpen={isExtractOpen}
          isSubmitting={isSubmitting}
          schema={schema}
          bagName={selectedResult?.source_bag ?? ""}
          bagPath={extractBagPath}
          centerTimestampMs={
            selectedTimestampNs !== null
              ? Math.floor(selectedTimestampNs / 1_000_000)
              : 0
          }
          windowS={windowS}
          outputFolder={outputFolder}
          userConfig={userConfig}
          onClose={closeExtract}
          onSubmit={() => void submitExtract()}
          onBagPathChange={setExtractBagPath}
          onWindowChange={setWindowS}
          onOutputFolderChange={setOutputFolder}
          onFieldChange={setFieldValue}
        />
      ) : null}
    </div>
  );
}
