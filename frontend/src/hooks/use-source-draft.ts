import { useCallback, useMemo, useState } from "react";

interface SourceDraft<T> {
  sourceIdentity: unknown;
  sourceRevision: number;
  value: T;
}

export function useSourceDraft<T>(
  source: T,
  sourceIdentity: unknown = source,
): [T, (value: T) => void] {
  const [draft, setDraftState] = useState<SourceDraft<T>>(() => ({
    sourceIdentity,
    sourceRevision: 0,
    value: source,
  }));

  const sourceChanged = !Object.is(draft.sourceIdentity, sourceIdentity);
  const nextDraft = useMemo(
    () =>
      sourceChanged
        ? {
            sourceIdentity,
            sourceRevision: draft.sourceRevision + 1,
            value: source,
          }
        : draft,
    [draft, source, sourceChanged, sourceIdentity],
  );

  const setDraft = useCallback(
    (next: T) => setDraftState({ ...nextDraft, value: next }),
    [nextDraft],
  );

  if (sourceChanged) {
    setDraftState(nextDraft);
  }

  return [nextDraft.value, setDraft];
}
