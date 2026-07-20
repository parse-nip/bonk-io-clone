import type { MapDef } from "../types";
import { BUILTIN_MAPS, registerCustomMaps } from "../game/maps";

const STORAGE_KEY = "bonk-clone-custom-maps";
const DRAFT_KEY = "bonk-clone-editor-draft";

export function loadCustomMaps(): MapDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MapDef[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m && typeof m.id === "string" && Array.isArray(m.shapes));
  } catch {
    return [];
  }
}

export function saveCustomMaps(maps: MapDef[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  registerCustomMaps(maps);
}

export function upsertCustomMap(map: MapDef): MapDef[] {
  const maps = loadCustomMaps();
  const idx = maps.findIndex((m) => m.id === map.id);
  if (idx >= 0) maps[idx] = map;
  else maps.push(map);
  saveCustomMaps(maps);
  return maps;
}

export function deleteCustomMap(id: string): MapDef[] {
  const maps = loadCustomMaps().filter((m) => m.id !== id);
  saveCustomMaps(maps);
  return maps;
}

export function listEditableMaps(): { builtin: MapDef[]; custom: MapDef[] } {
  return { builtin: BUILTIN_MAPS, custom: loadCustomMaps() };
}

export function saveDraftJson(json: string): void {
  localStorage.setItem(DRAFT_KEY, json);
}

export function loadDraftJson(): string | null {
  return localStorage.getItem(DRAFT_KEY);
}

export function clearDraftJson(): void {
  localStorage.removeItem(DRAFT_KEY);
}

/** Call once at app boot so getMap/MAPS include saved customs. */
export function hydrateCustomMaps(): void {
  registerCustomMaps(loadCustomMaps());
}
