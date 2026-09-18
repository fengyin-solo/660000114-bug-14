import { io, Socket } from 'socket.io-client';
import { CursorPosition, BoardElement, Layer } from '../types';

const SERVER_URL = '/';

class SocketService {
  private socket: Socket | null = null;
  private boardId: string | null = null;

  connect(): Socket {
    if (!this.socket) {
      this.socket = io(SERVER_URL, {
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 2000,
        timeout: 10000,
      });
    }
    this.socket.connect();
    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.boardId = null;
  }

  joinBoard(boardId: string, username: string): void {
    this.boardId = boardId;
    this.socket?.emit('join-board', { boardId, username });
  }

  leaveBoard(boardId: string): void {
    this.socket?.emit('leave-board', { boardId });
  }

  moveCursor(x: number, y: number): void {
    if (this.boardId) {
      this.socket?.emit('cursor-move', { boardId: this.boardId, x, y });
    }
  }

  drawElement(element: BoardElement, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('draw-element', { boardId: this.boardId, element, layerIndex });
    }
  }

  updateElement(elementId: string, updates: Partial<BoardElement>, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('update-element', { boardId: this.boardId, elementId, updates, layerIndex });
    }
  }

  deleteElement(elementId: string, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('delete-element', { boardId: this.boardId, elementId, layerIndex });
    }
  }

  addStickyNote(note: BoardElement, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('add-sticky-note', { boardId: this.boardId, note, layerIndex });
    }
  }

  addShape(shape: BoardElement, layerIndex: number): void {
    if (this.boardId) {
      this.socket?.emit('add-shape', { boardId: this.boardId, shape, layerIndex });
    }
  }

  updateLayers(layers: Layer[]): void {
    if (this.boardId) {
      this.socket?.emit('layer-update', { boardId: this.boardId, layers });
    }
  }

  onUserJoined(callback: (data: { socketId: string; username: string }) => void): void {
    this.socket?.on('user-joined', callback);
  }

  onUserLeft(callback: (data: { socketId: string; username?: string }) => void): void {
    this.socket?.on('user-left', callback);
  }

  onActiveUsers(callback: (users: CursorPosition[]) => void): void {
    this.socket?.on('active-users', callback);
  }

  onCursorUpdate(callback: (data: CursorPosition) => void): void {
    this.socket?.on('cursor-update', callback);
  }

  onElementAdded(callback: (data: { element: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('element-added', callback);
  }

  onElementUpdated(callback: (data: { elementId: string; updates: Partial<BoardElement>; layerIndex?: number }) => void): void {
    this.socket?.on('element-updated', callback);
  }

  onElementDeleted(callback: (data: { elementId: string; layerIndex?: number }) => void): void {
    this.socket?.on('element-deleted', callback);
  }

  onStickyNoteAdded(callback: (data: { note: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('sticky-note-added', callback);
  }

  onShapeAdded(callback: (data: { shape: BoardElement; layerIndex: number }) => void): void {
    this.socket?.on('shape-added', callback);
  }

  onLayersUpdated(callback: (data: { layers: Layer[] }) => void): void {
    this.socket?.on('layers-updated', callback);
  }

  off(event: string, callback?: (...args: unknown[]) => void): void {
    this.socket?.off(event, callback);
  }

  getSocket(): Socket | null {
    return this.socket;
  }
}

export const socketService = new SocketService();
