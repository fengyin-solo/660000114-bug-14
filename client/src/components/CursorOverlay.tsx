import React from 'react';
import { useWhiteboardStore } from '../store/whiteboard';
import { colorForUser } from '../utils/colors';

export const CursorOverlay: React.FC = () => {
  const cursors = useWhiteboardStore((s) => s.cursors);
  const canvasTransform = useWhiteboardStore((s) => s.canvasTransform);
  const cursorList = Array.from(cursors.values());

  return (
    <>
      {cursorList.map((cursor) => {
        // Same world -> screen projection the canvas draws with, so remote
        // cursors line up with sticky notes, text and shapes at every zoom.
        const color = colorForUser(cursor.socketId);
        return (
          <div
            key={cursor.socketId}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              pointerEvents: 'none',
              zIndex: 1000,
              willChange: 'transform',
              transform: `translate(${cursor.x * canvasTransform.scale + canvasTransform.translateX}px, ${cursor.y * canvasTransform.scale + canvasTransform.translateY}px)`,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M0 0L12 8L6 8L4 14L0 0Z" fill={color} stroke="#fff" strokeWidth="1" />
            </svg>
            <span
              style={{
                position: 'absolute',
                left: '10px',
                top: '10px',
                fontSize: '11px',
                background: color,
                color: '#fff',
                padding: '1px 6px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
              }}
            >
              {cursor.username}
            </span>
          </div>
        );
      })}
    </>
  );
};
