import { CanvasTransform } from '../types';

export interface BoardViewPrefs {
  transform: CanvasTransform;
  activeLayerIndex: number;
}

const storageKey = (boardId: string) => `whiteboard:view:${boardId}`;

const DEFAULT_TRANSFORM: CanvasTransform = { scale: 1, translateX: 0, translateY: 0 };

/**
 * Read the persisted viewport (zoom/pan) and UI state for a board.
 * Returns null for new boards or corrupted/invalid entries so the caller
 * can fall back to the default view instead of jumping to a bogus location.
 */
export function loadViewPrefs(boardId: string, layerCount?: number): BoardViewPrefs | null {
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BoardViewPrefs>;
    const t = parsed.transform;
    if (!t || typeof t.scale !== 'number' || !Number.isFinite(t.scale) || t.scale <= 0) {
      return null;
    }

    let activeLayerIndex = typeof parsed.activeLayerIndex === 'number' ? parsed.activeLayerIndex : 0;
    if (layerCount !== undefined) {
      activeLayerIndex = Math.min(Math.max(activeLayerIndex, 0), Math.max(layerCount - 1, 0));
    }

    return {
      transform: {
        scale: t.scale,
        translateX: Number.isFinite(t.translateX) ? t.translateX : 0,
        translateY: Number.isFinite(t.translateY) ? t.translateY : 0,
      },
      activeLayerIndex,
    };
  } catch {
    return null;
  }
}

export function saveViewPrefs(boardId: string, prefs: BoardViewPrefs): void {
  try {
    localStorage.setItem(storageKey(boardId), JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable (private mode / quota) — view persistence is best-effort.
  }
}

export function defaultTransform(): CanvasTransform {
  return { ...DEFAULT_TRANSFORM };
}
