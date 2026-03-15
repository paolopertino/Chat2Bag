import { LoaderCircle } from "lucide-react";

import { BagList } from "./components/bags/bag-list";
import { BagScanner } from "./components/bags/bag-scanner";
import { MainLayout } from "./components/layout/main-layout";
import { Sidebar } from "./components/layout/sidebar";
import { ResultsGrid } from "./components/search/results-grid";
import { SearchBar } from "./components/search/search-bar";
import { useBags } from "./hooks/use-bags";
import { useSearch } from "./hooks/use-search";

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
  } = useBags();

  const { query, setQuery, topK, setTopK, results, isSearching, runSearch } = useSearch();

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
          isSearching={isSearching}
          selectedBagCount={selectedBagPaths.length}
        />
      }
    >
      <ResultsGrid results={results} isSearching={isSearching} />
    </MainLayout>
  );
}

export default App;
