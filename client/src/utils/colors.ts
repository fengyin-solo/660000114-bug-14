/**
 * Stable color assignment per remote user id. Used both for remote cursors on
 * the canvas and presence entries in the sidebar so the two always agree.
 */
const PALETTE = [
  '#EF4444', '#F97316', '#F59E0B', '#22C55E', '#14B8A6',
  '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#0EA5E9',
];

export function colorForUser(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
