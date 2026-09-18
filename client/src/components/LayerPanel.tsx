import React from 'react';
import { useWhiteboardStore } from '../store/whiteboard';
import { colorForUser } from '../utils/colors';

export const LayerPanel: React.FC = () => {
  const {
    board, activeLayerIndex,
    setActiveLayerIndex, toggleLayerVisibility, toggleLayerLock, addLayer,
    cursors, username,
  } = useWhiteboardStore();

  if (!board) return null;

  // Same presence source the canvas cursor overlay renders from, so the
  // sidebar collaborator list and on-canvas cursors can never disagree.
  const remoteUsers = Array.from(cursors.values());

  return (
    <div style={{
      width: '220px', background: '#fff', borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)', padding: '12px',
      display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '14px' }}>图层</h3>
        <button onClick={() => addLayer(`图层 ${board.layers.length + 1}`)}
          style={{ border: 'none', background: '#4472C4', color: '#fff', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>
          + 新建
        </button>
      </div>
      {board.layers.map((layer, index) => (
        <div key={index}
          onClick={() => setActiveLayerIndex(index)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px', borderRadius: '4px', cursor: 'pointer',
            background: index === activeLayerIndex ? '#e3f2fd' : '#f5f5f5'
          }}>
          <button onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(index); }}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px' }}>
            {layer.visible ? '👁' : '🚫'}
          </button>
          <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.name}</span>
          <button onClick={(e) => { e.stopPropagation(); toggleLayerLock(index); }}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px' }}>
            {layer.locked ? '🔒' : '🔓'}
          </button>
          <span style={{ fontSize: '11px', color: '#888' }}>{layer.elements.length}</span>
        </div>
      ))}

      <div style={{ width: '100%', height: '1px', background: '#e5e7eb', margin: '4px 0' }} />

      <h3 style={{ margin: 0, fontSize: '14px' }}>
        协作成员 ({remoteUsers.length + 1})
      </h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px' }}>
        <span style={{
          width: '24px', height: '24px', borderRadius: '50%',
          background: colorForUser(username), color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 600, flexShrink: 0,
        }}>
          {username.charAt(0).toUpperCase()}
        </span>
        <span style={{ fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {username}（我）
        </span>
      </div>
      {remoteUsers.map((user) => (
        <div key={user.socketId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px' }}>
          <span style={{
            width: '24px', height: '24px', borderRadius: '50%',
            background: colorForUser(user.socketId), color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '11px', fontWeight: 600, flexShrink: 0,
          }}>
            {user.username.charAt(0).toUpperCase()}
          </span>
          <span style={{ fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.username}
          </span>
        </div>
      ))}
    </div>
  );
};
