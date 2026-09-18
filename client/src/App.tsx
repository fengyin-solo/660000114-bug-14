import React, { useState, useEffect } from 'react';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { CursorOverlay } from './components/CursorOverlay';
import { Dashboard } from './components/Dashboard';
import { useWhiteboardStore } from './store/whiteboard';
import { socketService } from './services/socket';
import { boardApi } from './services/api';
import { saveViewport } from './services/viewport';
import { Board, BoardElement, CursorPosition, Layer, ViewType } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  const username = useWhiteboardStore((s) => s.username);

  useEffect(() => {
    if (currentView !== 'board' || !activeBoard) return;

    // Register synchronously with the dashboard snapshot plus its persisted
    // viewport. openBoard applies board + saved scale/pan in one state
    // update, so the first paint never flashes identity or a previous
    // board's view ("jump to old position").
    const boardId = activeBoard._id;
    useWhiteboardStore.getState().openBoard(activeBoard);

    socketService.connect();
    socketService.joinBoard(boardId, username);

    socketService.onUserJoined((data) => {
      console.log(`${data.username} 加入了白板`);
    });
    socketService.onUserLeft((data) => {
      useWhiteboardStore.getState().removeCursor(data.socketId);
    });
    socketService.onActiveUsers((users: CursorPosition[]) => {
      useWhiteboardStore.getState().setCursors(users);
    });
    socketService.onCursorUpdate((data: CursorPosition) => {
      useWhiteboardStore.getState().updateCursor(data);
    });
    socketService.onElementAdded((data: { element: BoardElement; layerIndex: number }) => {
      useWhiteboardStore.getState().mergeRemoteElement(data.element, data.layerIndex);
    });
    socketService.onElementUpdated((data: { elementId: string; updates: Partial<BoardElement> }) => {
      useWhiteboardStore.getState().applyRemoteElementUpdate(data.elementId, data.updates);
    });
    socketService.onElementDeleted((data: { elementId: string }) => {
      useWhiteboardStore.getState().removeRemoteElement(data.elementId);
    });
    socketService.onLayersUpdated((data: { layers: Layer[] }) => {
      useWhiteboardStore.getState().replaceLayers(data.layers);
    });

    // Pull the authoritative latest board (elements persisted by other
    // sessions), but keep the locally restored viewport so opening from the
    // workbench shows content at the same zoom/pan relationship. Local
    // elements missing from the snapshot (optimistic draws that the server
    // had not debounce-saved yet) are unioned in instead of discarded.
    let cancelled = false;
    boardApi.getBoard(boardId).then((latest) => {
      if (cancelled) return;
      const state = useWhiteboardStore.getState();
      if (state.board?._id !== boardId || !latest) return;

      const localLayers = state.board.layers;
      const mergedLayers = latest.layers.map((remoteLayer, i) => {
        const localLayer = localLayers[i];
        if (!localLayer) return remoteLayer;
        const remoteIds = new Set(remoteLayer.elements.map((el) => el.id));
        const localOnly = localLayer.elements.filter((el) => !remoteIds.has(el.id));
        return localOnly.length
          ? { ...remoteLayer, elements: [...remoteLayer.elements, ...localOnly] }
          : remoteLayer;
      });
      state.setBoard({ ...latest, layers: mergedLayers });
    }).catch((err) => {
      console.error('Failed to refresh board data:', err);
    });

    return () => {
      cancelled = true;
      // Persist final viewport before tearing the session down.
      const state = useWhiteboardStore.getState();
      if (state.board) saveViewport(boardId, state.canvasTransform);
      socketService.leaveBoard(boardId);
      socketService.disconnect();
      useWhiteboardStore.getState().closeBoard();
    };
  }, [currentView, activeBoard, username]);

  const handleBoardSelect = (boardItem: Board) => {
    setActiveBoard(boardItem);
    setCurrentView('board');
  };

  const handleBackToDashboard = () => {
    setCurrentView('dashboard');
    setActiveBoard(null);
  };

  if (currentView === 'dashboard' || !activeBoard) {
    return <Dashboard onBoardSelect={handleBoardSelect} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div style={{
        height: '48px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: '12px',
      }}>
        <button
          onClick={handleBackToDashboard}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#374151',
            background: '#f3f4f6',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#e5e7eb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#f3f4f6';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          返回工作台
        </button>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#1a1a1a',
        }}>
          {activeBoard.name}
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Toolbar />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <WhiteboardCanvas />
          <CursorOverlay />
        </div>
        <LayerPanel />
      </div>
    </div>
  );
};

export default App;
