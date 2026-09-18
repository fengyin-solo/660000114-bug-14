const { Board } = require('../storage');

const activeUsers = new Map(); // boardId -> Set of socket ids
const cursorPositions = new Map(); // socketId -> { x, y, username, boardId }

// Latest layer state per board, cached so rapid collaborative edits do not
// overwrite each other when saves are debounced.
const boardLayerCache = new Map(); // boardId -> layers
const saveTimers = new Map(); // boardId -> Timeout
const SAVE_DEBOUNCE_MS = 500;

async function getBoardLayers(boardId) {
  if (boardLayerCache.has(boardId)) {
    return boardLayerCache.get(boardId);
  }
  const board = await Board.findById(boardId);
  if (!board || !Array.isArray(board.layers)) return null;
  boardLayerCache.set(boardId, board.layers);
  return board.layers;
}

function scheduleSave(boardId) {
  const existing = saveTimers.get(boardId);
  if (existing) clearTimeout(existing);
  saveTimers.set(boardId, setTimeout(async () => {
    saveTimers.delete(boardId);
    const layers = boardLayerCache.get(boardId);
    if (!layers) return;
    try {
      await Board.findByIdAndUpdate(boardId, { layers });
    } catch (err) {
      console.error(`[Socket] Failed to persist board ${boardId}, retrying:`, err);
      scheduleSave(boardId);
    }
  }, SAVE_DEBOUNCE_MS));
}

function findElement(layers, elementId) {
  for (const layer of layers) {
    const index = layer.elements.findIndex((el) => el.id === elementId);
    if (index !== -1) return { layer, index };
  }
  return null;
}

function removeUserFromBoard(socket, boardId) {
  const users = activeUsers.get(boardId);
  if (users) {
    users.delete(socket.id);
    if (users.size === 0) {
      activeUsers.delete(boardId);
      // Nobody is editing anymore: drop the cache after the last pending save.
      setTimeout(() => {
        if (!activeUsers.has(boardId)) boardLayerCache.delete(boardId);
      }, SAVE_DEBOUNCE_MS + 100);
    }
  }
  const pos = cursorPositions.get(socket.id);
  cursorPositions.delete(socket.id);
  socket.to(`board:${boardId}`).emit('user-left', {
    socketId: socket.id,
    username: pos ? pos.username : undefined,
  });
}

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-board', ({ boardId, username }) => {
      socket.join(`board:${boardId}`);

      if (!activeUsers.has(boardId)) {
        activeUsers.set(boardId, new Set());
      }
      activeUsers.get(boardId).add(socket.id);

      cursorPositions.set(socket.id, { x: 0, y: 0, username, boardId });

      // Notify others in the room
      socket.to(`board:${boardId}`).emit('user-joined', { socketId: socket.id, username });

      // Send current active users to the joiner
      const users = [];
      for (const [sid, data] of cursorPositions) {
        if (data.boardId === boardId && sid !== socket.id) {
          users.push({ socketId: sid, username: data.username, x: data.x, y: data.y });
        }
      }
      socket.emit('active-users', users);
    });

    socket.on('leave-board', ({ boardId }) => {
      if (!boardId) return;
      socket.leave(`board:${boardId}`);
      removeUserFromBoard(socket, boardId);
    });

    socket.on('cursor-move', ({ boardId, x, y }) => {
      const pos = cursorPositions.get(socket.id);
      if (pos) {
        pos.x = x;
        pos.y = y;
        socket.to(`board:${boardId}`).emit('cursor-update', {
          socketId: socket.id,
          username: pos.username,
          x, y
        });
      }
    });

    socket.on('draw-element', async ({ boardId, element, layerIndex }) => {
      const layers = await getBoardLayers(boardId);
      if (layers && layers[layerIndex]) {
        layers[layerIndex].elements.push(element);
        scheduleSave(boardId);
      }
      socket.to(`board:${boardId}`).emit('element-added', { element, layerIndex });
    });

    socket.on('update-element', async ({ boardId, elementId, updates }) => {
      const layers = await getBoardLayers(boardId);
      const found = layers ? findElement(layers, elementId) : null;
      if (found) {
        found.layer.elements[found.index] = {
          ...found.layer.elements[found.index],
          ...updates,
        };
        scheduleSave(boardId);
      }
      socket.to(`board:${boardId}`).emit('element-updated', { elementId, updates });
    });

    socket.on('delete-element', async ({ boardId, elementId, layerIndex }) => {
      const layers = await getBoardLayers(boardId);
      if (layers) {
        const targetLayer = layers[layerIndex];
        if (targetLayer) {
          targetLayer.elements = targetLayer.elements.filter((el) => el.id !== elementId);
        } else {
          layers.forEach((layer) => {
            layer.elements = layer.elements.filter((el) => el.id !== elementId);
          });
        }
        scheduleSave(boardId);
      }
      socket.to(`board:${boardId}`).emit('element-deleted', { elementId, layerIndex });
    });

    socket.on('add-sticky-note', async ({ boardId, note, layerIndex }) => {
      const layers = await getBoardLayers(boardId);
      if (layers && layers[layerIndex]) {
        layers[layerIndex].elements.push(note);
        scheduleSave(boardId);
      }
      socket.to(`board:${boardId}`).emit('sticky-note-added', { note, layerIndex });
    });

    socket.on('add-shape', async ({ boardId, shape, layerIndex }) => {
      const layers = await getBoardLayers(boardId);
      if (layers && layers[layerIndex]) {
        layers[layerIndex].elements.push(shape);
        scheduleSave(boardId);
      }
      socket.to(`board:${boardId}`).emit('shape-added', { shape, layerIndex });
    });

    socket.on('layer-update', ({ boardId, layers }) => {
      if (Array.isArray(layers)) {
        boardLayerCache.set(boardId, layers);
        scheduleSave(boardId);
      }
      socket.to(`board:${boardId}`).emit('layers-updated', { layers });
    });

    // Note: canvas zoom/pan (viewport transform) is intentionally NOT synced.
    // It is per-user local state; remote cursors already arrive in the shared
    // board coordinate space and are mapped through each local viewport.

    socket.on('disconnect', () => {
      const pos = cursorPositions.get(socket.id);
      if (pos) {
        removeUserFromBoard(socket, pos.boardId);
      }
      console.log(`User disconnected: ${socket.id}`);
    });
  });
}

module.exports = { setupSocketHandlers };
