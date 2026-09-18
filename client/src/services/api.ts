import { Board, Template } from '../types';

const API_BASE_URL = '/api/boards';
const TEMPLATE_API_URL = '/api/templates';

export const boardApi = {
  async getBoards(userId: string): Promise<Board[]> {
    const response = await fetch(`${API_BASE_URL}?userId=${userId}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch boards');
    }
    return response.json();
  },

  async getBoard(boardId: string): Promise<Board | null> {
    const response = await fetch(`${API_BASE_URL}/${boardId}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch board');
    }
    return response.json();
  },

  async createBoard(data: { name: string; ownerId: string; width?: number; height?: number }): Promise<Board | null> {
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to create board');
    }
    return response.json();
  },

  async deleteBoard(boardId: string): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/${boardId}`, { method: 'DELETE' });
    return response.ok;
  },

  getMockBoards(): Board[] {
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 86400000 * 2).toISOString();
    const lastWeek = new Date(Date.now() - 86400000 * 7).toISOString();

    return [
      {
        _id: 'board-1',
        name: '产品需求评审',
        ownerId: 'user-1',
        collaborators: ['user-2', 'user-3'],
        layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
        width: 3000,
        height: 2000,
        backgroundColor: '#f5f5f5',
        createdAt: lastWeek,
        updatedAt: now,
      },
      {
        _id: 'board-2',
        name: '架构设计讨论',
        ownerId: 'user-1',
        collaborators: ['user-4'],
        layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
        width: 3000,
        height: 2000,
        backgroundColor: '#ffffff',
        createdAt: lastWeek,
        updatedAt: yesterday,
      },
      {
        _id: 'board-3',
        name: '用户旅程地图',
        ownerId: 'user-2',
        collaborators: ['user-1', 'user-5'],
        layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
        width: 3000,
        height: 2000,
        backgroundColor: '#f0f8ff',
        createdAt: lastWeek,
        updatedAt: twoDaysAgo,
      },
      {
        _id: 'board-4',
        name: '团队脑暴会',
        ownerId: 'user-3',
        collaborators: ['user-1'],
        layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
        width: 3000,
        height: 2000,
        backgroundColor: '#fff8e1',
        createdAt: lastWeek,
        updatedAt: lastWeek,
      },
    ];
  },

  createMockBoard(data: { name: string; ownerId: string }): Board {
    const now = new Date().toISOString();
    return {
      _id: `board-${Date.now()}`,
      name: data.name,
      ownerId: data.ownerId,
      collaborators: [],
      layers: [{ name: '图层 1', visible: true, locked: false, order: 0, elements: [] }],
      width: 3000,
      height: 2000,
      backgroundColor: '#ffffff',
      createdAt: now,
      updatedAt: now,
    };
  },
};

export const templateApi = {
  async getTemplates(): Promise<Template[]> {
    const response = await fetch(TEMPLATE_API_URL);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch templates');
    }
    return response.json();
  },

  async getTemplate(templateId: string): Promise<Template | null> {
    const response = await fetch(`${TEMPLATE_API_URL}/${templateId}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to fetch template');
    }
    return response.json();
  },

  async createBoardFromTemplate(
    templateId: string,
    data: { name: string; ownerId: string }
  ): Promise<Board | null> {
    const response = await fetch(`${TEMPLATE_API_URL}/${templateId}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to create board from template');
    }
    return response.json();
  },
};
