import { create } from 'zustand';
import { Board, BoardElement, CursorPosition, CanvasTransform, ToolType, Layer } from '../types';
import { socketService } from '../services/socket';
import { loadViewport } from '../services/viewport';

interface WhiteboardState {
  board: Board | null;
  activeTool: ToolType;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  activeLayerIndex: number;
  cursors: Map<string, CursorPosition>;
  canvasTransform: CanvasTransform;
  username: string;

  // Actions
  openBoard: (board: Board) => void;
  closeBoard: () => void;
  setBoard: (board: Board) => void;
  setActiveTool: (tool: ToolType) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setActiveLayerIndex: (index: number) => void;
  addElement: (element: BoardElement) => void;
  updateElement: (elementId: string, updates: Partial<BoardElement>) => void;
  deleteElement: (elementId: string) => void;
  mergeRemoteElement: (element: BoardElement, layerIndex: number) => void;
  applyRemoteElementUpdate: (elementId: string, updates: Partial<BoardElement>) => void;
  removeRemoteElement: (elementId: string, layerIndex?: number) => void;
  addLayer: (name: string) => void;
  toggleLayerVisibility: (index: number) => void;
  toggleLayerLock: (index: number) => void;
  replaceLayers: (layers: Layer[]) => void;
  setCanvasTransform: (transform: CanvasTransform) => void;
  updateCursor: (cursor: CursorPosition) => void;
  removeCursor: (socketId: string) => void;
  setCursors: (cursors: CursorPosition[]) => void;
  setUsername: (name: string) => void;
}

const DEFAULT_TRANSFORM: CanvasTransform = { scale: 1, translateX: 0, translateY: 0 };

const clampLayerIndex = (board: Board, index: number): number =>
  Math.min(Math.max(index, 0), Math.max(board.layers.length - 1, 0));

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  board: null,
  activeTool: 'pen',
  strokeColor: '#000000',
  fillColor: 'transparent',
  strokeWidth: 2,
  activeLayerIndex: 0,
  cursors: new Map(),
  canvasTransform: DEFAULT_TRANSFORM,
  username: `User_${Math.random().toString(36).substr(2, 6)}`,

  // Open a board: board data and its persisted viewport are set in the same
  // state update, so the very first paint uses the correct zoom/pan — no
  // identity flash and no leftover transform from a previously open board.
  openBoard: (board) => set({
    board,
    activeLayerIndex: clampLayerIndex(board, 0),
    canvasTransform: loadViewport(board._id),
    cursors: new Map(),
  }),

  closeBoard: () => set({ board: null, cursors: new Map(), activeLayerIndex: 0 }),

  setBoard: (board) => set({
    board,
    activeLayerIndex: clampLayerIndex(board, get().activeLayerIndex),
  }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setActiveLayerIndex: (index) => {
    const { board } = get();
    if (!board) return;
    set({ activeLayerIndex: clampLayerIndex(board, index) });
  },

  addElement: (element) => {
    const { board, activeLayerIndex } = get();
    if (!board) return;
    const layers = [...board.layers];
    layers[activeLayerIndex] = {
      ...layers[activeLayerIndex],
      elements: [...layers[activeLayerIndex].elements, element]
    };
    set({ board: { ...board, layers } });
    socketService.drawElement(element, activeLayerIndex);
  },

  updateElement: (elementId, updates) => {
    const { board } = get();
    if (!board) return;
    let targetLayerIndex = -1;
    const layers = board.layers.map((layer, index) => {
      const exists = layer.elements.some((el) => el.id === elementId);
      if (!exists) return layer;
      targetLayerIndex = index;
      return {
        ...layer,
        elements: layer.elements.map((el) => (el.id === elementId ? { ...el, ...updates } : el)),
      };
    });
    if (targetLayerIndex === -1) return;
    set({ board: { ...board, layers } });
    socketService.updateElement(elementId, updates, targetLayerIndex);
  },

  deleteElement: (elementId) => {
    const { board } = get();
    if (!board) return;
    let targetLayerIndex = -1;
    const layers = board.layers.map((layer, index) => {
      const exists = layer.elements.some((el) => el.id === elementId);
      if (!exists) return layer;
      targetLayerIndex = index;
      return { ...layer, elements: layer.elements.filter((el) => el.id !== elementId) };
    });
    if (targetLayerIndex === -1) return;
    set({ board: { ...board, layers } });
    socketService.deleteElement(elementId, targetLayerIndex);
  },

  mergeRemoteElement: (element, layerIndex) => {
    const { board } = get();
    if (!board || !board.layers[layerIndex]) return;
    // Ignore echoes of elements we already hold (e.g. server reload race).
    if (board.layers.some((layer) => layer.elements.some((el) => el.id === element.id))) return;
    const layers = [...board.layers];
    layers[layerIndex] = {
      ...layers[layerIndex],
      elements: [...layers[layerIndex].elements, element],
    };
    set({ board: { ...board, layers } });
  },

  applyRemoteElementUpdate: (elementId, updates) => {
    const { board } = get();
    if (!board) return;
    const layers = board.layers.map((layer) => ({
      ...layer,
      elements: layer.elements.map((el) => (el.id === elementId ? { ...el, ...updates } : el)),
    }));
    set({ board: { ...board, layers } });
  },

  removeRemoteElement: (elementId, layerIndex) => {
    const { board } = get();
    if (!board) return;
    const layers = board.layers.map((layer, index) => {
      if (layerIndex !== undefined && index !== layerIndex) return layer;
      return { ...layer, elements: layer.elements.filter((el) => el.id !== elementId) };
    });
    set({ board: { ...board, layers } });
  },

  addLayer: (name) => {
    const { board } = get();
    if (!board) return;
    const newLayer: Layer = { name, visible: true, locked: false, order: board.layers.length, elements: [] };
    const layers = [...board.layers, newLayer];
    set({ board: { ...board, layers }, activeLayerIndex: layers.length - 1 });
    socketService.updateLayers(layers);
  },

  toggleLayerVisibility: (index) => {
    const { board } = get();
    if (!board) return;
    const layers = [...board.layers];
    layers[index] = { ...layers[index], visible: !layers[index].visible };
    set({ board: { ...board, layers } });
    socketService.updateLayers(layers);
  },

  toggleLayerLock: (index) => {
    const { board } = get();
    if (!board) return;
    const layers = [...board.layers];
    layers[index] = { ...layers[index], locked: !layers[index].locked };
    set({ board: { ...board, layers } });
    socketService.updateLayers(layers);
  },

  replaceLayers: (layers) => {
    const { board } = get();
    if (!board) return;
    set({
      board: { ...board, layers },
      activeLayerIndex: clampLayerIndex({ ...board, layers }, get().activeLayerIndex),
    });
  },

  // Local viewport only — never broadcast. Zoom/pan is per-user state;
  // syncing it makes collaborators fight over the same view and feeds back
  // into remote-cursor misalignment.
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
    const cursors = new Map();
    cursorsList.forEach(c => cursors.set(c.socketId, c));
    set({ cursors });
  },

  setUsername: (name) => set({ username: name }),
}));
