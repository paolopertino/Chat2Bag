import { useMemo, useState } from "react";

import type { ExtractionTopic } from "../../api/types";
import type { TopicSelectionState } from "../../lib/extraction-config-store";

interface TopicsEditorProps {
  state: TopicSelectionState;
  onChange: (next: TopicSelectionState) => void;
}

interface Group {
  key: string;
  topics: ExtractionTopic[];
}

function groupLabel(t: ExtractionTopic): string {
  return `${t.modality} · ${t.group}`;
}

export function TopicsEditor({ state, onChange }: TopicsEditorProps) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const includedSet = useMemo(() => new Set(state.included), [state.included]);

  const groups = useMemo<Group[]>(() => {
    const needle = filter.trim().toLowerCase();
    const byKey = new Map<string, ExtractionTopic[]>();
    for (const t of state.topics) {
      if (
        needle &&
        !t.name.toLowerCase().includes(needle) &&
        !t.topic_path.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const key = groupLabel(t);
      const list = byKey.get(key) ?? [];
      list.push(t);
      byKey.set(key, list);
    }
    return [...byKey.entries()].map(([key, topics]) => ({ key, topics }));
  }, [state.topics, filter]);

  const setIncluded = (nextIncluded: string[]) =>
    onChange({ ...state, included: nextIncluded });

  const toggleInclude = (name: string) => {
    if (includedSet.has(name)) {
      setIncluded(state.included.filter((n) => n !== name));
    } else {
      setIncluded([...state.included, name]);
    }
  };

  const setGroupIncluded = (groupTopics: ExtractionTopic[], include: boolean) => {
    const names = groupTopics.map((t) => t.name);
    if (include) {
      const merged = new Set([...state.included, ...names]);
      setIncluded([...merged]);
    } else {
      const remove = new Set(names);
      setIncluded(state.included.filter((n) => !remove.has(n)));
    }
  };

  const setLeader = (name: string) => {
    if (!includedSet.has(name)) return;
    onChange({ ...state, leader: name });
  };

  const setPath = (name: string, topic_path: string) => {
    onChange({
      ...state,
      topics: state.topics.map((t) => (t.name === name ? { ...t, topic_path } : t)),
    });
  };

  return (
    <div className="text-xs">
      <div className="mb-3 flex items-center gap-3">
        <input
          className="flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1"
          placeholder="filter topics…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="whitespace-nowrap opacity-60">
          {state.included.length} / {state.topics.length} included
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.key} className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide opacity-55">
            <span>{group.key}</span>
            <span className="flex gap-2">
              <button type="button" className="hover:opacity-100" onClick={() => setGroupIncluded(group.topics, true)}>
                all
              </button>
              <span>/</span>
              <button type="button" className="hover:opacity-100" onClick={() => setGroupIncluded(group.topics, false)}>
                none
              </button>
            </span>
          </div>

          {group.topics.map((t) => {
            const included = includedSet.has(t.name);
            const isLeader = state.leader === t.name;
            const isOpen = expanded === t.name;
            return (
              <div
                key={t.name}
                className={
                  "mb-1.5 rounded-md border " +
                  (isOpen ? "border-sky-400/60 bg-sky-400/5" : "border-[var(--line)]")
                }
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={() => toggleInclude(t.name)}
                    aria-label={`Include ${t.name}`}
                  />
                  <span className={"font-semibold " + (included ? "" : "opacity-50")}>{t.name}</span>
                  <span className="rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[9px] opacity-70">
                    {t.file_extension}
                  </span>
                  <button
                    type="button"
                    className={"ml-auto text-sm " + (isLeader ? "text-amber-400" : "opacity-35 hover:opacity-70")}
                    title={included ? "Set as sync leader" : "Include the topic to make it the sync leader"}
                    onClick={() => setLeader(t.name)}
                  >
                    {isLeader ? "★" : "☆"}
                  </button>
                  <button
                    type="button"
                    className="text-[10px] opacity-50 hover:opacity-100"
                    onClick={() => setExpanded(isOpen ? null : t.name)}
                    aria-label={isOpen ? "Collapse" : "Expand"}
                  >
                    {isOpen ? "▾" : "▸"}
                  </button>
                </div>

                {isOpen ? (
                  <div className="border-t border-dashed border-[var(--line)] px-3 py-2 pl-8">
                    <label className="block">
                      <span className="text-[10px] opacity-60">topic_path</span>
                      <input
                        className="mt-1 w-full rounded border border-[var(--line)] bg-transparent px-2 py-1 font-mono text-[11px]"
                        value={t.topic_path}
                        onChange={(e) => setPath(t.name, e.target.value)}
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 opacity-75">
                      <span><span className="opacity-55">modality</span> {t.modality}</span>
                      <span><span className="opacity-55">group</span> {t.group}</span>
                      <span><span className="opacity-55">extension</span> {t.file_extension}</span>
                    </div>
                    {Array.isArray(t.field_names) && t.field_names.length > 0 ? (
                      <div className="mt-2">
                        <div className="text-[10px] opacity-60">field_names</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.field_names.map((f) => (
                            <span key={f} className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[9px]">
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {isLeader ? (
                      <p className="mt-2 text-[10px] text-amber-400">
                        This is the sync leader. Excluding it requires choosing another leader before extracting.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}

      {groups.length === 0 ? (
        <p className="py-4 text-center opacity-50">No topics match "{filter}".</p>
      ) : null}
    </div>
  );
}
