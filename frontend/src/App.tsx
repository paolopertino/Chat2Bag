import { LoaderCircle } from "lucide-react";

import { BagList } from "./components/bags/bag-list";
import { BagScanner } from "./components/bags/bag-scanner";
import { MainLayout } from "./components/layout/main-layout";
import { Sidebar } from "./components/layout/sidebar";
import { ResultsGrid } from "./components/search/results-grid";
import { SequenceViewer } from "./components/search/sequence-viewer";
import { SearchBar } from "./components/search/search-bar";
import { useBags } from "./hooks/use-bags";
import { useSearch } from "./hooks/use-search";
import { useSequenceViewer } from "./hooks/use-sequence-viewer";

function App() {
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

  return (
    <MainLayout
      sidebar={
        <Sidebar
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
            isPolling ? (
              <p className="flex items-center gap-2 text-xs text-[var(--ink-soft)]">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Polling indexing status...
              </p>
            ) : null
          }
        />
      }
      header={
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
      }
    >
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
    </MainLayout>
  );
}

export default App;
