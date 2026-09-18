import { CanvasTransform } from '../types';

/**
 * Per-board viewport (zoom/pan) persistence.
 *
 * The transform is a local per-user view concern, so it is kept in
 * localStorage keyed by board id instead of being broadcast. Restoring it
 * synchronously when a board opens guarantees content shows at the exact same
 * scale/pan as last time, with no initial jump to identity or to another
 * board's leftover view.
 */
const STORAGE_PREFIX = 'whiteboard:viewport:';
const DEFAULT_TRANSFORM: CanvasTransform = { scale: 1, translateX: 0, translateY: 0 };

export const loadViewport = (boardId: string): CanvasTransform => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + boardId);
    if (!raw) return { ...DEFAULT_TRANSFORM };
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.scale === 'number' && Number.isFinite(parsed.scale) && parsed.scale > 0 &&
      typeof parsed.translateX === 'number' && Number.isFinite(parsed.translateX) &&
      typeof parsed.translateY === 'number' && Number.isFinite(parsed.translateY)
    ) {
      return {
        scale: parsed.scale,
        translateX: parsed.translateX,
        translateY: parsed.translateY,
      };
    }
  } catch {
    // Corrupt entry: fall back to default.
  }
  return { ...DEFAULT_TRANSFORM };
};

export const saveViewport = (boardId: string, transform: CanvasTransform): void => {
  try {
    localStorage.setItem(STORAGE_PREFIX + boardId, JSON.stringify(transform));
  } catch {
    // Storage full or unavailable — view persistence is best effort.
  }
};
