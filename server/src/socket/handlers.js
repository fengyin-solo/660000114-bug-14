const { Board } = require('../storage');

// boardId -> Set of socket ids currently in the room
const activeUsers = new Map();
// socketId -> { x, y, username, boardId }
const cursorPositions = new Map();
// boardId -> { layers } authoritative in-memory drawing state for the room
const roomStates = new Map();
// boardId -> Promise that resolves once room state has been seeded from storage
const roomInit = new Map();
// boardId -> debounce timer for persisting layer changes
const persistTimers = new Map();

const PERSIST_DELAY_MS = 800;

/**
 * Load a room's drawing state from persistent storage on first use.
 * Concurrent joins share the same seeding promise so nobody ever joins a
 * half-initialized room.
 */
function ensureRoomState(boardId) {
  if (roomStates.has(boardId)) {
    return Promise.resolve(roomStates.get(boardId));
  }
  if (roomInit.has(boardId)) {
    return roomInit.get(boardId);
  }

  const init = Board.findById(boardId)
    .then((stored) => {
      let layers;
      if (stored && Array.isArray(stored.layers) && stored.layers.length > 0) {
        // Deep clone so in-memory mutations and the cached storage object
        // never share references.
        layers = JSON.parse(JSON.stringify(stored.layers));
      } else {
        layers = [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }];
      }
      const state = { layers };
      roomStates.set(boardId, state);
      roomInit.delete(boardId);
      return state;
    })
    .catch((err) => {
      console.error(`[Socket] Failed to seed room ${boardId}:`, err);
      roomInit.delete(boardId);
      const state = {
        layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
      };
      roomStates.set(boardId, state);
      return state;
    });

  roomInit.set(boardId, init);
  return init;
}

/** Debounced write of a room's layers back to persistent storage. */
function schedulePersist(boardId) {
  const existing = persistTimers.get(boardId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    persistTimers.delete(boardId);
    const state = roomStates.get(boardId);
    if (!state) return;
    Board.findByIdAndUpdate(boardId, { layers: state.layers }, { new: false })
      .then(() => {
        console.log(`[Socket] Persisted layers for board ${boardId}`);
      })
      .catch((err) => {
        console.error(`[Socket] Failed to persist board ${boardId}:`, err);
      });
  }, PERSIST_DELAY_MS);
  persistTimers.set(boardId, timer);
}

const validLayerIndex = (state, layerIndex) =>
  Number.isInteger(layerIndex) && layerIndex >= 0 && layerIndex < state.layers.length;

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-board', async ({ boardId, username }) => {
      socket.join(`board:${boardId}`);

      if (!activeUsers.has(boardId)) {
        activeUsers.set(boardId, new Set());
      }
      activeUsers.get(boardId).add(socket.id);

      cursorPositions.set(socket.id, { x: 0, y: 0, username, boardId });

      // Make sure persisted drawing data is loaded before snapshotting.
      const state = await ensureRoomState(boardId);

      // Notify others in the room
      socket.to(`board:${boardId}`).emit('user-joined', { socketId: socket.id, username });

      // Send the current active users to the joiner
      const users = [];
      for (const [sid, data] of cursorPositions) {
        if (data.boardId === boardId && sid !== socket.id) {
          users.push({ socketId: sid, username: data.username, x: data.x, y: data.y });
        }
      }
      socket.emit('active-users', users);

      // Send the full drawing snapshot (sticky notes, text, shapes, paths,
      // layers) so late joiners and reopened boards see existing content.
      socket.emit('board-sync', { layers: state.layers });
    });

    socket.on('cursor-move', ({ boardId, x, y }) => {
      const pos = cursorPositions.get(socket.id);
      if (pos && typeof x === 'number' && typeof y === 'number') {
        pos.x = x;
        pos.y = y;
        socket.to(`board:${boardId}`).emit('cursor-update', {
          socketId: socket.id,
          username: pos.username,
          x, y
        });
      }
    });

    socket.on('draw-element', ({ boardId, element, layerIndex }) => {
      const state = roomStates.get(boardId);
      if (!state || !element || !validLayerIndex(state, layerIndex)) return;
      const layer = state.layers[layerIndex];
      if (!layer.elements.some((el) => el.id === element.id)) {
        layer.elements.push(element);
        schedulePersist(boardId);
      }
      socket.to(`board:${boardId}`).emit('element-added', { element, layerIndex });
    });

    socket.on('update-element', ({ boardId, elementId, updates, layerIndex }) => {
      const state = roomStates.get(boardId);
      if (!state || !validLayerIndex(state, layerIndex)) return;
      const layer = state.layers[layerIndex];
      const el = layer.elements.find((item) => item.id === elementId);
      if (el) {
        Object.assign(el, updates);
        schedulePersist(boardId);
      }
      socket.to(`board:${boardId}`).emit('element-updated', { elementId, updates, layerIndex });
    });

    socket.on('delete-element', ({ boardId, elementId, layerIndex }) => {
      const state = roomStates.get(boardId);
      if (!state || !validLayerIndex(state, layerIndex)) return;
      const layer = state.layers[layerIndex];
      const before = layer.elements.length;
      layer.elements = layer.elements.filter((el) => el.id !== elementId);
      if (layer.elements.length !== before) schedulePersist(boardId);
      socket.to(`board:${boardId}`).emit('element-deleted', { elementId, layerIndex });
    });

    socket.on('layer-update', ({ boardId, layers }) => {
      const state = roomStates.get(boardId);
      if (!state || !Array.isArray(layers)) return;
      // Store an independent copy of the layer tree.
      state.layers = JSON.parse(JSON.stringify(layers));
      schedulePersist(boardId);
      socket.to(`board:${boardId}`).emit('layers-updated', { layers: state.layers });
    });

    socket.on('disconnect', () => {
      const pos = cursorPositions.get(socket.id);
      if (pos) {
        const { boardId, username } = pos;
        const users = activeUsers.get(boardId);
        if (users) {
          users.delete(socket.id);
          if (users.size === 0) {
            activeUsers.delete(boardId);
            // Flush any pending writes before the room goes idle; keep the
            // cached state so a quick rejoin is instant.
            const timer = persistTimers.get(boardId);
            if (timer) {
              clearTimeout(timer);
              persistTimers.delete(boardId);
              const state = roomStates.get(boardId);
              if (state) {
                Board.findByIdAndUpdate(boardId, { layers: state.layers }, { new: false })
                  .catch((err) => console.error(`[Socket] Failed to persist board ${boardId}:`, err));
              }
            }
          }
        }
        cursorPositions.delete(socket.id);
        socket.to(`board:${boardId}`).emit('user-left', { socketId: socket.id, username });
      }
      console.log(`User disconnected: ${socket.id}`);
    });
  });
}

module.exports = { setupSocketHandlers };
