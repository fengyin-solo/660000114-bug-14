import React, { useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useWhiteboardStore } from '../store/whiteboard';
import { socketService } from '../services/socket';
import { BoardElement } from '../types';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
// Cap the backing-store resolution so very dense displays don't waste memory,
// while still rendering crisp strokes on common HiDPI/retina screens.
const MAX_DPR = 2.5;

export const WhiteboardCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const currentPathRef = useRef<number[]>([]);
  const startPosRef = useRef({ x: 0, y: 0 });

  // Panning state (middle mouse button, space+drag, or drag with the select tool)
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, translateX: 0, translateY: 0 });
  const spaceDownRef = useRef(false);

  const board = useWhiteboardStore((s) => s.board);
  const activeTool = useWhiteboardStore((s) => s.activeTool);
  const addElement = useWhiteboardStore((s) => s.addElement);
  const canvasTransform = useWhiteboardStore((s) => s.canvasTransform);

  /** Convert client coordinates to board coordinates using the live rect + transform. */
  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { canvasTransform: t } = useWhiteboardStore.getState();
    return {
      x: (clientX - rect.left - t.translateX) / t.scale,
      y: (clientY - rect.top - t.translateY) / t.scale,
    };
  }, []);

  /**
   * Resize the backing store to CSS size * devicePixelRatio (if needed) and
   * paint every visible layer. All pixel math happens in CSS-pixel space via
   * setTransform(dpr,...), so strokes stay sharp at any zoom on HiDPI screens
   * and never get stretched after a window resize.
   */
  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Guard against collapsed/zero-sized containers (minimized window, flex
    // layout not resolved yet, extremely small split panes).
    const cssWidth = canvas.offsetWidth;
    const cssHeight = canvas.offsetHeight;
    if (cssWidth === 0 || cssHeight === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const targetWidth = Math.round(cssWidth * dpr);
    const targetHeight = Math.round(cssHeight * dpr);
    // Only rewrite the backing store when the size actually changed — resizing
    // it implicitly clears the canvas and would otherwise cause flicker.
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const t = useWhiteboardStore.getState().canvasTransform;
    const currentBoard = useWhiteboardStore.getState().board;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.save();
    ctx.translate(t.translateX, t.translateY);
    ctx.scale(t.scale, t.scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (currentBoard) {
      currentBoard.layers.forEach((layer) => {
        if (!layer.visible) return;
        layer.elements.forEach((el) => {
          ctx.save();
          ctx.globalAlpha = el.opacity ?? 1;
          ctx.strokeStyle = el.stroke || '#000';
          ctx.fillStyle = el.fill || 'transparent';
          ctx.lineWidth = el.strokeWidth || 2;

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
        });
      });
    }
    ctx.restore();
  }, []);

  // Watch the element's box (window resize, split-screen, entering the page,
  // sidebar collapse) and devicePixelRatio changes (moving across monitors).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let frame = 0;
    const scheduleDraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(drawScene);
    };

    scheduleDraw();

    const resizeObserver = new ResizeObserver(scheduleDraw);
    resizeObserver.observe(canvas);
    window.addEventListener('resize', scheduleDraw);
    const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mql.addEventListener?.('change', scheduleDraw);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleDraw);
      mql.removeEventListener?.('change', scheduleDraw);
    };
  }, [drawScene]);

  // Repaint when content or the viewport changes.
  useEffect(() => {
    drawScene();
  }, [board, canvasTransform, drawScene]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { activeTool: tool } = useWhiteboardStore.getState();
    const isPanGesture =
      e.button === 1 || spaceDownRef.current || (e.button === 0 && tool === 'select');
    if (isPanGesture) {
      // Suppress middle-click auto-scroll / text selection while panning.
      e.preventDefault();
      isPanningRef.current = true;
      const { canvasTransform: t } = useWhiteboardStore.getState();
      panStartRef.current = {
        x: e.clientX, y: e.clientY, translateX: t.translateX, translateY: t.translateY,
      };
      return;
    }
    if (e.button !== 0) return;

    const point = getCanvasPoint(e.clientX, e.clientY);
    isDrawingRef.current = true;
    startPosRef.current = point;
    currentPathRef.current = [point.x, point.y];
  }, [getCanvasPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e.clientX, e.clientY);
    socketService.moveCursor(point.x, point.y);

    if (isPanningRef.current) {
      useWhiteboardStore.getState().setCanvasTransform({
        ...useWhiteboardStore.getState().canvasTransform,
        translateX: panStartRef.current.translateX + (e.clientX - panStartRef.current.x),
        translateY: panStartRef.current.translateY + (e.clientY - panStartRef.current.y),
      });
      return;
    }

    if (!isDrawingRef.current) return;
    currentPathRef.current.push(point.x, point.y);
  }, [getCanvasPoint]);

  const finishInteraction = useCallback((e?: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const point = e
      ? getCanvasPoint(e.clientX, e.clientY)
      : { x: startPosRef.current.x, y: startPosRef.current.y };

    const state = useWhiteboardStore.getState();
    const tool = state.activeTool;
    let element: BoardElement | null = null;

    switch (tool) {
      case 'pen':
        if (currentPathRef.current.length >= 4) {
          element = {
            id: uuidv4(), type: 'path', x: 0, y: 0,
            points: [...currentPathRef.current],
            stroke: state.strokeColor, strokeWidth: state.strokeWidth, fill: 'transparent'
          };
        }
        break;
      case 'rect':
        element = {
          id: uuidv4(), type: 'rect',
          x: Math.min(startPosRef.current.x, point.x),
          y: Math.min(startPosRef.current.y, point.y),
          width: Math.abs(point.x - startPosRef.current.x),
          height: Math.abs(point.y - startPosRef.current.y),
          fill: state.fillColor, stroke: state.strokeColor, strokeWidth: state.strokeWidth
        };
        break;
      case 'circle': {
        const cx = (startPosRef.current.x + point.x) / 2;
        const cy = (startPosRef.current.y + point.y) / 2;
        const rx = Math.abs(point.x - startPosRef.current.x) / 2;
        const ry = Math.abs(point.y - startPosRef.current.y) / 2;
        element = {
          id: uuidv4(), type: 'circle', x: cx, y: cy,
          width: rx * 2, height: ry * 2,
          fill: state.fillColor, stroke: state.strokeColor, strokeWidth: state.strokeWidth
        };
        break;
      }
      case 'line':
        element = {
          id: uuidv4(), type: 'line',
          x: startPosRef.current.x, y: startPosRef.current.y,
          points: [startPosRef.current.x, startPosRef.current.y, point.x, point.y],
          stroke: state.strokeColor, strokeWidth: state.strokeWidth, fill: 'transparent'
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
          text: '文本', stroke: state.strokeColor, fill: state.strokeColor, strokeWidth: 1
        };
        break;
    }

    if (element) {
      addElement(element);
    }
    currentPathRef.current = [];
  }, [addElement, getCanvasPoint]);

  // Cursor-anchored wheel zoom: the board point under the pointer stays fixed,
  // so content never jumps during continuous zoom (trackpad or mouse wheel).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const { canvasTransform: t } = useWhiteboardStore.getState();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(Math.max(t.scale * factor, MIN_SCALE), MAX_SCALE);
      if (newScale === t.scale) return;

      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      // Keep the world point under the cursor stationary:
      // (cursor - newTranslate) / newScale === (cursor - oldTranslate) / oldScale
      useWhiteboardStore.getState().setCanvasTransform({
        scale: newScale,
        translateX: cursorX - ((cursorX - t.translateX) / t.scale) * newScale,
        translateY: cursorY - ((cursorY - t.translateY) / t.scale) * newScale,
      });
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Space-bar panning modifier.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceDownRef.current) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        spaceDownRef.current = true;
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Finish an in-progress drag even if the button is released off-canvas.
  useEffect(() => {
    const handleUp = () => finishInteraction();
    window.addEventListener('mouseup', handleUp);
    return () => window.removeEventListener('mouseup', handleUp);
  }, [finishInteraction]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        cursor: spaceDownRef.current || isPanningRef.current
          ? 'grabbing'
          : activeTool === 'select'
            ? 'grab'
            : 'crosshair',
        backgroundColor: board?.backgroundColor || '#f5f5f5'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={finishInteraction}
      onContextMenu={(e) => e.preventDefault()}
      onMouseLeave={() => {
        isDrawingRef.current = false;
        isPanningRef.current = false;
      }}
    />
  );
};
