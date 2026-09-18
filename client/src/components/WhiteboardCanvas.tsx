import React, { useRef, useEffect, useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useWhiteboardStore } from '../store/whiteboard';
import { socketService } from '../services/socket';
import { saveViewport } from '../services/viewport';
import { BoardElement } from '../types';

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

export const WhiteboardCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const spacePressedRef = useRef(false);
  const currentPathRef = useRef<number[]>([]);
  const startPosRef = useRef({ x: 0, y: 0 });
  const previewElementRef = useRef<BoardElement | null>(null);
  const panStartRef = useRef({ clientX: 0, clientY: 0, translateX: 0, translateY: 0 });

  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const activeTool = useWhiteboardStore((s) => s.activeTool);
  const strokeColor = useWhiteboardStore((s) => s.strokeColor);
  const fillColor = useWhiteboardStore((s) => s.fillColor);
  const strokeWidth = useWhiteboardStore((s) => s.strokeWidth);
  const board = useWhiteboardStore((s) => s.board);

  // Convert a client event into shared board coordinates. getBoundingClientRect
  // is read at event time, so it is always consistent with the CSS box the
  // browser currently lays out — never with a stale canvas size.
  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { canvasTransform } = useWhiteboardStore.getState();
    return {
      x: (clientX - rect.left - canvasTransform.translateX) / canvasTransform.scale,
      y: (clientY - rect.top - canvasTransform.translateY) / canvasTransform.scale
    };
  }, []);

  // ---- Imperative rendering -------------------------------------------------

  const renderRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const state = useWhiteboardStore.getState();
      const currentBoard = state.board;
      const transform = state.canvasTransform;

      // Keep the backing store matched to BOTH the current CSS size and the
      // device pixel ratio. Without this, a resized / split-screen window
      // keeps drawing into the old bitmap (browser stretches it → blurry,
      // and hit-testing drifts), and hi-DPI screens upscale a 1x bitmap
      // (hand-drawn strokes look fuzzy).
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth === 0 || cssHeight === 0) return; // hidden / zero-size layout
      const dpr = window.devicePixelRatio || 1;
      const backingWidth = Math.round(cssWidth * dpr);
      const backingHeight = Math.round(cssHeight * dpr);
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }

      // All drawing below is expressed in CSS pixels.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.save();
      ctx.translate(transform.translateX, transform.translateY);
      ctx.scale(transform.scale, transform.scale);

      const drawElement = (el: BoardElement) => {
        ctx.save();
        ctx.globalAlpha = el.opacity ?? 1;
        ctx.strokeStyle = el.stroke || '#000';
        ctx.fillStyle = el.fill || 'transparent';
        ctx.lineWidth = el.strokeWidth || 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        switch (el.type) {
          case 'path':
            if (el.points && el.points.length >= 4) {
              ctx.beginPath();
              ctx.moveTo(el.points[0], el.points[1]);
              for (let i = 2; i < el.points.length; i += 2) {
                ctx.lineTo(el.points[i], el.points[i + 1]);
              }
              ctx.stroke();
            }
            break;
          case 'rect':
            ctx.beginPath();
            ctx.rect(el.x, el.y, el.width || 0, el.height || 0);
            if (el.fill && el.fill !== 'transparent') ctx.fill();
            ctx.stroke();
            break;
          case 'circle':
            ctx.beginPath();
            ctx.ellipse(el.x, el.y, (el.width || 0) / 2, (el.height || 0) / 2, 0, 0, Math.PI * 2);
            if (el.fill && el.fill !== 'transparent') ctx.fill();
            ctx.stroke();
            break;
          case 'line':
            if (el.points && el.points.length >= 4) {
              ctx.beginPath();
              ctx.moveTo(el.points[0], el.points[1]);
              ctx.lineTo(el.points[2], el.points[3]);
              ctx.stroke();
            }
            break;
          case 'sticky-note':
            ctx.fillStyle = el.fill || '#FFF59D';
            ctx.fillRect(el.x, el.y, el.width || 160, el.height || 120);
            ctx.strokeStyle = el.stroke || '#F9A825';
            ctx.strokeRect(el.x, el.y, el.width || 160, el.height || 120);
            if (el.text) {
              ctx.fillStyle = '#333';
              ctx.font = '14px sans-serif';
              ctx.fillText(el.text, el.x + 10, el.y + 30);
            }
            break;
          case 'text':
            if (el.text) {
              ctx.fillStyle = el.fill || '#000';
              ctx.font = '16px sans-serif';
              ctx.fillText(el.text, el.x, el.y);
            }
            break;
        }
        ctx.restore();
      };

      if (currentBoard) {
        currentBoard.layers.forEach((layer) => {
          if (!layer.visible) return;
          layer.elements.forEach(drawElement);
        });
      }

      // Live preview of the element currently being drawn.
      if (previewElementRef.current) drawElement(previewElementRef.current);

      ctx.restore();
    };

    renderRef.current = render;
    render();

    // Window resize, split-screen, sidebar collapse, DevTools docking, …
    // anything that changes the CSS box lands here and triggers a redraw
    // against the new drawing area.
    const resizeObserver = new ResizeObserver(() => render());
    resizeObserver.observe(canvas);

    // DPR can change without a CSS-size change (window dragged between
    // monitors with different density).
    const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const handleDprChange = () => render();
    dprQuery.addEventListener('change', handleDprChange);

    // Redraw whenever board data or the local viewport changes. Reading
    // through getState() above guarantees the freshest data, and rendering
    // never depends on React effect timing.
    const unsubscribe = useWhiteboardStore.subscribe((state, prevState) => {
      if (state.board !== prevState.board || state.canvasTransform !== prevState.canvasTransform) {
        render();
      }
    });

    return () => {
      resizeObserver.disconnect();
      dprQuery.removeEventListener('change', handleDprChange);
      unsubscribe();
      renderRef.current = () => {};
    };
  }, []);

  // ---- Viewport persistence (per board, local only) -------------------------

  const boardId = board?._id;
  const canvasTransform = useWhiteboardStore((s) => s.canvasTransform);

  // Debounced write while zooming/panning continuously.
  useEffect(() => {
    if (!boardId) return;
    const timer = setTimeout(() => {
      saveViewport(boardId, useWhiteboardStore.getState().canvasTransform);
    }, 300);
    return () => clearTimeout(timer);
  }, [boardId, canvasTransform]);

  // Flush the final viewport when leaving the board view, so reopening from
  // the workbench restores the exact zoom/pan even if it happened within the
  // debounce window.
  useEffect(() => () => {
    const state = useWhiteboardStore.getState();
    if (state.board) saveViewport(state.board._id, state.canvasTransform);
  }, []);

  // ---- Pan (space-drag / middle mouse) --------------------------------------

  const startPanning = useCallback((clientX: number, clientY: number) => {
    const { canvasTransform: t } = useWhiteboardStore.getState();
    isPanningRef.current = true;
    panStartRef.current = { clientX, clientY, translateX: t.translateX, translateY: t.translateY };
    setIsPanning(true);
  }, []);

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (isPanningRef.current) {
        const { canvasTransform, setCanvasTransform } = useWhiteboardStore.getState();
        setCanvasTransform({
          ...canvasTransform,
          translateX: panStartRef.current.translateX + (e.clientX - panStartRef.current.clientX),
          translateY: panStartRef.current.translateY + (e.clientY - panStartRef.current.clientY),
        });
      }
    };
    const stopPanning = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        setIsPanning(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spacePressedRef.current) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        spacePressedRef.current = true;
        setIsSpaceDown(true);
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressedRef.current = false;
        setIsSpaceDown(false);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', stopPanning);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', stopPanning);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // ---- Wheel zoom, anchored at the cursor -----------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = useWhiteboardStore.getState();
      const { canvasTransform: t, setCanvasTransform } = state;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(Math.max(t.scale * factor, MIN_SCALE), MAX_SCALE);
      // Keep the board point under the cursor stationary while zooming,
      // including during rapid / continuous wheel events.
      const boardX = (px - t.translateX) / t.scale;
      const boardY = (py - t.translateY) / t.scale;
      setCanvasTransform({
        scale: newScale,
        translateX: px - boardX * newScale,
        translateY: py - boardY * newScale,
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // ---- Drawing interaction --------------------------------------------------

  const buildPreviewElement = useCallback((point: { x: number; y: number }): BoardElement | null => {
    const start = startPosRef.current;
    switch (activeTool) {
      case 'pen':
        return {
          id: 'preview', type: 'path', x: 0, y: 0,
          points: [...currentPathRef.current],
          stroke: strokeColor, strokeWidth, fill: 'transparent'
        };
      case 'rect':
        return {
          id: 'preview', type: 'rect',
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          width: Math.abs(point.x - start.x),
          height: Math.abs(point.y - start.y),
          fill: fillColor, stroke: strokeColor, strokeWidth
        };
      case 'circle':
        return {
          id: 'preview', type: 'circle',
          x: (start.x + point.x) / 2,
          y: (start.y + point.y) / 2,
          width: Math.abs(point.x - start.x),
          height: Math.abs(point.y - start.y),
          fill: fillColor, stroke: strokeColor, strokeWidth
        };
      case 'line':
        return {
          id: 'preview', type: 'line',
          x: start.x, y: start.y,
          points: [start.x, start.y, point.x, point.y],
          stroke: strokeColor, strokeWidth, fill: 'transparent'
        };
      default:
        return null;
    }
  }, [activeTool, strokeColor, fillColor, strokeWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Middle button, or left button while space is held / select tool active:
    // pan the canvas instead of drawing.
    const panGesture =
      e.button === 1 ||
      (e.button === 0 && (spacePressedRef.current || activeTool === 'select'));
    if (panGesture) {
      e.preventDefault();
      startPanning(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;

    const point = getCanvasPoint(e.clientX, e.clientY);
    isDrawingRef.current = true;
    startPosRef.current = point;
    currentPathRef.current = [point.x, point.y];
    previewElementRef.current = buildPreviewElement(point);
    renderRef.current();
  }, [activeTool, getCanvasPoint, startPanning, buildPreviewElement]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e.clientX, e.clientY);
    socketService.moveCursor(point.x, point.y);

    if (!isDrawingRef.current) return;

    if (activeTool === 'pen') {
      currentPathRef.current.push(point.x, point.y);
    }
    previewElementRef.current = buildPreviewElement(point);
    renderRef.current();
  }, [activeTool, getCanvasPoint, buildPreviewElement]);

  const finishDrawing = useCallback((clientX: number, clientY: number) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    previewElementRef.current = null;
    const point = getCanvasPoint(clientX, clientY);
    let element: BoardElement | null = null;

    switch (activeTool) {
      case 'pen':
        element = {
          id: uuidv4(), type: 'path', x: 0, y: 0,
          points: [...currentPathRef.current],
          stroke: strokeColor, strokeWidth, fill: 'transparent'
        };
        break;
      case 'rect': {
        const width = Math.abs(point.x - startPosRef.current.x);
        const height = Math.abs(point.y - startPosRef.current.y);
        if (width === 0 || height === 0) break;
        element = {
          id: uuidv4(), type: 'rect',
          x: Math.min(startPosRef.current.x, point.x),
          y: Math.min(startPosRef.current.y, point.y),
          width, height,
          fill: fillColor, stroke: strokeColor, strokeWidth
        };
        break;
      }
      case 'circle': {
        const dx = Math.abs(point.x - startPosRef.current.x);
        const dy = Math.abs(point.y - startPosRef.current.y);
        if (dx === 0 || dy === 0) break;
        const cx = (startPosRef.current.x + point.x) / 2;
        const cy = (startPosRef.current.y + point.y) / 2;
        element = {
          id: uuidv4(), type: 'circle', x: cx, y: cy,
          width: dx, height: dy,
          fill: fillColor, stroke: strokeColor, strokeWidth
        };
        break;
      }
      case 'line':
        if (point.x === startPosRef.current.x && point.y === startPosRef.current.y) break;
        element = {
          id: uuidv4(), type: 'line',
          x: startPosRef.current.x, y: startPosRef.current.y,
          points: [startPosRef.current.x, startPosRef.current.y, point.x, point.y],
          stroke: strokeColor, strokeWidth, fill: 'transparent'
        };
        break;
      case 'sticky-note':
        element = {
          id: uuidv4(), type: 'sticky-note',
          x: point.x, y: point.y, width: 160, height: 120,
          fill: '#FFF59D', stroke: '#F9A825', strokeWidth: 1, text: '便签内容'
        };
        break;
      case 'text':
        element = {
          id: uuidv4(), type: 'text', x: point.x, y: point.y,
          text: '文本', stroke: strokeColor, fill: strokeColor, strokeWidth: 1
        };
        break;
    }

    if (element) {
      useWhiteboardStore.getState().addElement(element);
    } else {
      renderRef.current();
    }
    currentPathRef.current = [];
  }, [activeTool, strokeColor, fillColor, strokeWidth, getCanvasPoint]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) return; // window listener ends panning
    finishDrawing(e.clientX, e.clientY);
  }, [finishDrawing]);

  const cursor = isPanning ? 'grabbing' : isSpaceDown ? 'grab' : activeTool === 'select' ? 'default' : 'crosshair';

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        cursor,
        backgroundColor: board?.backgroundColor || '#f5f5f5'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        isDrawingRef.current = false;
        if (previewElementRef.current) {
          previewElementRef.current = null;
          currentPathRef.current = [];
          renderRef.current();
        }
      }}
    />
  );
};
