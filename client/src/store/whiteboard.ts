import { create } from 'zustand';
import { Board, BoardElement, CursorPosition, CanvasTransform, ToolType, Layer } from '../types';
import { socketService } from '../services/socket';

interface WhiteboardState {
  board: Board | null;
  boardId: string | null;
  activeTool: ToolType;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  activeLayerIndex: number;
  cursors: Map<string, CursorPosition>;
  canvasTransform: CanvasTransform;
  username: string;

  // Actions
  setBoard: (board: Board) => void;
  /** Load a fresh board together with its persisted per-user viewport, without emitting anything. */
  hydrateSession: (board: Board, transform: CanvasTransform, activeLayerIndex: number) => void;
  resetSession: () => void;
  setActiveTool: (tool: ToolType) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setActiveLayerIndex: (index: number) => void;
  addElement: (element: BoardElement) => void;
  updateElement: (elementId: string, updates: Partial<BoardElement>) => void;
  deleteElement: (elementId: string) => void;
  /** Apply an element received from a remote peer (local state only, no re-emit). */
  applyRemoteElement: (element: BoardElement, layerIndex: number) => void;
  applyRemoteElementUpdate: (elementId: string, updates: Partial<BoardElement>, layerIndex: number) => void;
  applyRemoteElementDelete: (elementId: string, layerIndex: number) => void;
  addLayer: (name: string) => void;
  toggleLayerVisibility: (index: number) => void;
  toggleLayerLock: (index: number) => void;
  /** Replace the whole layer tree (initial snapshot or remote layer edit). */
  setLayers: (layers: Layer[], options?: { broadcast: boolean }) => void;
  /** Local viewport change. Viewport is a per-user, per-board view and is never broadcast. */
  setCanvasTransform: (transform: CanvasTransform) => void;
  updateCursor: (cursor: CursorPosition) => void;
  removeCursor: (socketId: string) => void;
  setCursors: (cursors: CursorPosition[]) => void;
  clearCursors: () => void;
  setUsername: (name: string) => void;
}

const DEFAULT_TRANSFORM: CanvasTransform = { scale: 1, translateX: 0, translateY: 0 };

const clampLayerIndex = (board: Board | null, index: number): number => {
  if (!board || board.layers.length === 0) return 0;
  return Math.min(Math.max(index, 0), board.layers.length - 1);
};

const mutateLayer = (
  board: Board,
  layerIndex: number,
  mutator: (elements: BoardElement[]) => BoardElement[]
): Board | null => {
  if (layerIndex < 0 || layerIndex >= board.layers.length) return null;
  const layers = board.layers.slice();
  layers[layerIndex] = {
    ...layers[layerIndex],
    elements: mutator(layers[layerIndex].elements),
  };
  return { ...board, layers };
};

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  board: null,
  boardId: null,
  activeTool: 'pen',
  strokeColor: '#000000',
  fillColor: 'transparent',
  strokeWidth: 2,
  activeLayerIndex: 0,
  cursors: new Map(),
  canvasTransform: { ...DEFAULT_TRANSFORM },
  username: `User_${Math.random().toString(36).substr(2, 6)}`,

  setBoard: (board) => set({ board, boardId: board._id }),

  hydrateSession: (board, transform, activeLayerIndex) =>
    set({
      board,
      boardId: board._id,
      canvasTransform: transform,
      activeLayerIndex: clampLayerIndex(board, activeLayerIndex),
      cursors: new Map(),
    }),

  resetSession: () =>
    set({
      board: null,
      boardId: null,
      canvasTransform: { ...DEFAULT_TRANSFORM },
      activeLayerIndex: 0,
      cursors: new Map(),
    }),

  setActiveTool: (tool) => set({ activeTool: tool }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setActiveLayerIndex: (index) => set({ activeLayerIndex: clampLayerIndex(get().board, index) }),

  addElement: (element) => {
    const { board, activeLayerIndex } = get();
    if (!board) return;
    const next = mutateLayer(board, activeLayerIndex, (elements) => [...elements, element]);
    if (!next) return;
    set({ board: next });
    socketService.drawElement(element, activeLayerIndex);
  },

  updateElement: (elementId, updates) => {
    const { board, activeLayerIndex } = get();
    if (!board) return;
    const next = mutateLayer(board, activeLayerIndex, (elements) =>
      elements.map((el) => (el.id === elementId ? { ...el, ...updates } : el))
    );
    if (!next) return;
    set({ board: next });
    socketService.updateElement(elementId, updates, activeLayerIndex);
  },

  deleteElement: (elementId) => {
    const { board, activeLayerIndex } = get();
    if (!board) return;
    const next = mutateLayer(board, activeLayerIndex, (elements) =>
      elements.filter((el) => el.id !== elementId)
    );
    if (!next) return;
    set({ board: next });
    socketService.deleteElement(elementId, activeLayerIndex);
  },

  applyRemoteElement: (element, layerIndex) => {
    const { board } = get();
    if (!board) return;
    const next = mutateLayer(board, layerIndex, (elements) =>
      elements.some((el) => el.id === element.id) ? elements : [...elements, element]
    );
    if (next) set({ board: next });
  },

  applyRemoteElementUpdate: (elementId, updates, layerIndex) => {
    const { board } = get();
    if (!board) return;
    const next = mutateLayer(board, layerIndex, (elements) =>
      elements.map((el) => (el.id === elementId ? { ...el, ...updates } : el))
    );
    if (next) set({ board: next });
  },

  applyRemoteElementDelete: (elementId, layerIndex) => {
    const { board } = get();
    if (!board) return;
    const next = mutateLayer(board, layerIndex, (elements) =>
      elements.filter((el) => el.id !== elementId)
    );
    if (next) set({ board: next });
  },

  addLayer: (name) => {
    const { board } = get();
    if (!board) return;
    const newLayer: Layer = {
      name, visible: true, locked: false, order: board.layers.length, elements: [],
    };
    const layers = [...board.layers, newLayer];
    get().setLayers(layers, { broadcast: true });
    set({ activeLayerIndex: layers.length - 1 });
  },

  toggleLayerVisibility: (index) => {
    const { board } = get();
    if (!board) return;
    const layers = board.layers.slice();
    layers[index] = { ...layers[index], visible: !layers[index].visible };
    get().setLayers(layers, { broadcast: true });
  },

  toggleLayerLock: (index) => {
    const { board } = get();
    if (!board) return;
    const layers = board.layers.slice();
    layers[index] = { ...layers[index], locked: !layers[index].locked };
    get().setLayers(layers, { broadcast: true });
  },

  setLayers: (layers, options = { broadcast: true }) => {
    const { board, activeLayerIndex } = get();
    if (!board) return;
    set({
      board: { ...board, layers },
      activeLayerIndex: Math.min(activeLayerIndex, Math.max(layers.length - 1, 0)),
    });
    if (options.broadcast) socketService.updateLayers(layers);
  },

  // The viewport is a local, per-user view of the board: it must never be
  // broadcast, otherwise peers would fight over zoom/pan and continuous
  // wheel zoom would echo back and forth.
  setCanvasTransform: (transform) => set({ canvasTransform: transform }),

  updateCursor: (cursor) => {
    const cursors = new Map(get().cursors);
    cursors.set(cursor.socketId, cursor);
    set({ cursors });
  },

  removeCursor: (socketId) => {
    const cursors = new Map(get().cursors);
    cursors.delete(socketId);
    set({ cursors });
  },

  setCursors: (cursorsList) => {
    const cursors = new Map<string, CursorPosition>();
    cursorsList.forEach((c) => cursors.set(c.socketId, c));
    set({ cursors });
  },

  clearCursors: () => set({ cursors: new Map() }),

  setUsername: (name) => set({ username: name }),
}));
