import { createDefaultSources, normalizeSources } from "../domain/source.js";

const STORAGE_KEYS = Object.freeze({
  SETTINGS: "live-multiviewer.settings.v1",
  EVENTS: "live-multiviewer.events.v2",
});

const MAX_EVENT_COUNT = 100;

export class BrowserStateRepository {
  constructor(storage) {
    this.storage = storage;
  }

  loadSettings() {
    const storedSettings = this.readJson(STORAGE_KEYS.SETTINGS, null);
    if (!storedSettings) return createDefaultSettings();

    return {
      sources: normalizeSources(storedSettings.sources),
      layoutLocked: storedSettings.layoutLocked ?? storedSettings.locked !== false,
    };
  }

  saveSettings(settings) {
    this.storage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        sources: normalizeSources(settings.sources),
        layoutLocked: settings.layoutLocked !== false,
      }),
    );
  }

  loadEvents() {
    const storedEvents = this.readJson(STORAGE_KEYS.EVENTS, []);
    return Array.isArray(storedEvents) ? storedEvents.slice(0, MAX_EVENT_COUNT) : [];
  }

  saveEvents(events) {
    this.storage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(events.slice(0, MAX_EVENT_COUNT)));
  }

  readJson(key, fallback) {
    try {
      const serializedValue = this.storage.getItem(key);
      return serializedValue === null ? fallback : JSON.parse(serializedValue);
    } catch {
      return fallback;
    }
  }
}

function createDefaultSettings() {
  return {
    sources: createDefaultSources(),
    layoutLocked: true,
  };
}
