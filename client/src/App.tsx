import React, { useState, useEffect, useRef } from 'react';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { CursorOverlay } from './components/CursorOverlay';
import { Dashboard } from './components/Dashboard';
import { useWhiteboardStore } from './store/whiteboard';
import { socketService } from './services/socket';
import { boardApi } from './services/api';
import { loadViewPrefs, saveViewPrefs, defaultTransform } from './services/viewPrefs';
import { Board, BoardElement, CursorPosition, Layer, CanvasTransform } from './types';

type ViewType = 'dashboard' | 'board';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const persistTimer = useRef<number | null>(null);
  // Latest per-board view state, captured live so exit cleanup can persist it
  // BEFORE resetSession() runs (cleanups fire in reverse effect order).
  const latestPrefsRef = useRef<{ boardId: string; transform: CanvasTransform; activeLayerIndex: number } | null>(null);

  // Persist the local viewport + active layer while drawing/zooming so the
  // exact zoom/pan relationship is restored when the board is reopened.
  useEffect(() => {
    if (currentView !== 'board' || !activeBoard) return;

    let last = 0;
    const unsubscribe = useWhiteboardStore.subscribe((state, prevState) => {
      if (
        state.canvasTransform === prevState.canvasTransform &&
        state.activeLayerIndex === prevState.activeLayerIndex
      ) {
        return;
      }
      const now = performance.now();
      if (now - last < 250) {
        // Coalesce bursts (continuous wheel zoom, dragging) into one write.
        if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
        persistTimer.current = window.setTimeout(doPersist, 300);
        return;
      }
      last = now;
      doPersist();
    });

    function doPersist() {
      const { canvasTransform, activeLayerIndex } = useWhiteboardStore.getState();
      latestPrefsRef.current = {
        boardId: activeBoard!._id,
        transform: canvasTransform,
        activeLayerIndex,
      };
      saveViewPrefs(activeBoard!._id, { transform: canvasTransform, activeLayerIndex });
    }

    return () => {
      unsubscribe();
      if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    };
  }, [currentView, activeBoard]);

  useEffect(() => {
    if (currentView !== 'board' || !activeBoard) return;

    let cancelled = false;
    setLoadingBoard(true);

    // Always refetch the board from the server on entry: dashboard list cards
    // may be stale and we must not reopen with an old snapshot or old view.
    const setupSession = async () => {
      let freshBoard: Board | null = activeBoard;
      try {
        const fetched = await boardApi.getBoard(activeBoard._id);
        if (fetched) freshBoard = fetched;
      } catch (error) {
        console.error('Failed to refresh board, using cached data:', error);
      }
      if (cancelled || !freshBoard) {
        setLoadingBoard(false);
        return;
      }

      // Restore this board's own zoom/pan (never another board's) before the
      // canvas first paints, so there is no flash at the identity position.
      const prefs = loadViewPrefs(freshBoard._id, freshBoard.layers.length);
      useWhiteboardStore.getState().hydrateSession(
        freshBoard,
        prefs?.transform ?? defaultTransform(),
        prefs?.activeLayerIndex ?? 0
      );

      socketService.connect();
      socketService.joinBoard(freshBoard._id, useWhiteboardStore.getState().username);

      socketService.onUserJoined((data) => {
        console.log(`${data.username} 加入了白板`);
      });
      socketService.onUserLeft((data) => {
        useWhiteboardStore.getState().removeCursor(data.socketId);
      });
      socketService.onActiveUsers((users) => {
        useWhiteboardStore.getState().setCursors(users);
      });
      socketService.onCursorUpdate((data: CursorPosition) => {
        useWhiteboardStore.getState().updateCursor(data);
      });
      // Snapshot of existing drawing data delivered by the server on join.
      socketService.onBoardSync((data: { layers: Layer[] }) => {
        if (cancelled) return;
        const { board: currentBoard } = useWhiteboardStore.getState();
        if (currentBoard && Array.isArray(data.layers) && data.layers.length > 0) {
          useWhiteboardStore.getState().setLayers(data.layers, { broadcast: false });
        }
      });
      socketService.onElementAdded((data: { element: BoardElement; layerIndex: number }) => {
        useWhiteboardStore.getState().applyRemoteElement(data.element, data.layerIndex);
      });
      socketService.onElementUpdated((data: { elementId: string; updates: Partial<BoardElement>; layerIndex: number }) => {
        useWhiteboardStore.getState().applyRemoteElementUpdate(data.elementId, data.updates, data.layerIndex);
      });
      socketService.onElementDeleted((data: { elementId: string; layerIndex: number }) => {
        useWhiteboardStore.getState().applyRemoteElementDelete(data.elementId, data.layerIndex);
      });
      socketService.onLayersUpdated((data: { layers: Layer[] }) => {
        useWhiteboardStore.getState().setLayers(data.layers, { broadcast: false });
      });

      setLoadingBoard(false);
    };

    setupSession();

    return () => {
      cancelled = true;
      socketService.disconnect();
      // Persist the final viewport before clearing session state.
      const latest = latestPrefsRef.current;
      if (latest && latest.boardId === activeBoard._id) {
        saveViewPrefs(latest.boardId, {
          transform: latest.transform,
          activeLayerIndex: latest.activeLayerIndex,
        });
      }
      latestPrefsRef.current = null;
      // Drop board-scoped state so switching between the two entries (or into
      // another board) can never leave stale cursors, content or an old
      // zoom/pan transform behind.
      useWhiteboardStore.getState().resetSession();
    };
  }, [currentView, activeBoard]);

  const handleBoardSelect = (boardItem: Board) => {
    setActiveBoard(boardItem);
    setCurrentView('board');
  };

  const handleBackToDashboard = () => {
    setCurrentView('dashboard');
    setActiveBoard(null);
  };

  if (currentView === 'dashboard') {
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
        flexShrink: 0,
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
          {activeBoard?.name}
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <Toolbar />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0 }}>
          {loadingBoard ? (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color: '#6b7280', fontSize: '14px', background: '#f5f5f5',
            }}>
              正在加载画板…
            </div>
          ) : (
            <>
              <WhiteboardCanvas />
              <CursorOverlay />
            </>
          )}
        </div>
        {!loadingBoard && <LayerPanel />}
      </div>
    </div>
  );
};

export default App;
