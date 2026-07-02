import type { ExtractionConfigSchema, ExtractionTopic } from "../api/types";

const STORAGE_KEY = "chat2bag.extraction.config.v1";

export interface StoredTopicOverride {
  included: boolean;
  topic_path?: string;
}

export interface StoredConfig {
  version: 1;
  scalars: Record<string, unknown>;
  topics: Record<string, StoredTopicOverride>;
  leader: string | null;
}

// Editor-facing state: the full server topic list (with topic_path overrides
// applied, in server order), the set of included topic names, and the single
// sync-leader name. `assembleTopics` turns this back into the array to submit.
export interface TopicSelectionState {
  topics: ExtractionTopic[];
  included: string[];
  leader: string | null;
}

export interface HydratedConfig {
  scalars: Record<string, unknown>;
  topicState: TopicSelectionState;
}

export interface TopicValidation {
  ok: boolean;
  error?: string;
}

function isTopic(value: unknown): value is ExtractionTopic {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { topic_path?: unknown }).topic_path === "string"
  );
}

export function serverTopics(schema: ExtractionConfigSchema): ExtractionTopic[] {
  const raw = (schema.defaults as Record<string, unknown>).topics;
  return Array.isArray(raw) ? raw.filter(isTopic) : [];
}

function serverLeader(topics: ExtractionTopic[]): string | null {
  const leader = topics.find((t) => t.is_sync_leader);
  return leader ? leader.name : null;
}

export function loadStore(): StoredConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConfig;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStore(config: StoredConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore quota / private-mode write failures — persistence is best-effort.
  }
}

export function clearStore(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

// Merge a persisted config over the current server schema. Scalars fall back to
// server defaults when absent. Topics reconcile by name: persisted include/path
// choices apply to topics that still exist, new server topics default to
// included, removed topics drop. The returned leader is always an included
// topic when any topic is included.
export function hydrate(
  schema: ExtractionConfigSchema,
  stored: StoredConfig | null,
): HydratedConfig {
  const defaults = schema.defaults as Record<string, unknown>;

  const scalars: Record<string, unknown> = {};
  for (const field of schema.editable_fields) {
    if (field === "topics") continue;
    const storedVal = stored?.scalars?.[field];
    scalars[field] = storedVal !== undefined ? storedVal : defaults[field];
  }

  const base = serverTopics(schema);
  const overrides = stored?.topics ?? {};
  const included: string[] = [];
  const topics = base.map((t) => {
    const override = overrides[t.name];
    const topic_path =
      override?.topic_path !== undefined ? override.topic_path : t.topic_path;
    const isIncluded = override ? override.included : true;
    if (isIncluded) included.push(t.name);
    return { ...t, topic_path };
  });

  let leader: string | null = null;
  if (stored?.leader && included.includes(stored.leader)) {
    leader = stored.leader;
  } else {
    const serverDefault = serverLeader(base);
    leader =
      serverDefault && included.includes(serverDefault)
        ? serverDefault
        : included[0] ?? null;
  }

  return { scalars, topicState: { topics, included, leader } };
}

// Build the topics array to submit: included topics only, with the single
// leader flagged.
export function assembleTopics(state: TopicSelectionState): ExtractionTopic[] {
  const includedSet = new Set(state.included);
  return state.topics
    .filter((t) => includedSet.has(t.name))
    .map((t) => ({ ...t, is_sync_leader: t.name === state.leader }));
}

export function toStored(
  scalars: Record<string, unknown>,
  state: TopicSelectionState,
): StoredConfig {
  const includedSet = new Set(state.included);
  const topics: Record<string, StoredTopicOverride> = {};
  for (const t of state.topics) {
    topics[t.name] = {
      included: includedSet.has(t.name),
      topic_path: t.topic_path,
    };
  }
  return { version: 1, scalars, topics, leader: state.leader };
}

export function validateTopics(state: TopicSelectionState): TopicValidation {
  const includedSet = new Set(state.included);
  if (includedSet.size === 0) {
    return { ok: false, error: "Select at least one topic to extract." };
  }
  if (!state.leader || !includedSet.has(state.leader)) {
    return {
      ok: false,
      error: "The sync leader must be one of the included topics.",
    };
  }
  for (const t of state.topics) {
    if (includedSet.has(t.name) && !String(t.topic_path).trim()) {
      return { ok: false, error: `Topic "${t.name}" has an empty topic path.` };
    }
  }
  return { ok: true };
}
