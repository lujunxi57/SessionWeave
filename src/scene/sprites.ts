/** Character frames from Pixel Agents, snapshot 3537e140. MIT / THIRD_PARTY_NOTICES.md.
 * Frame layout adapted from its office/sprites/spriteData.ts: 7 frames per direction,
 * down/up/right rows; left is mirrored right; walk order is 0,1,2,1.
 */
import type { EmployeeAction } from './sceneState';
export type Direction = 'down' | 'up' | 'left' | 'right';
export const SPRITE_W = 16, SPRITE_H = 32, SCALE = 2;
const sheets = new Map<number, Promise<HTMLImageElement>>();
const frameCache = new Map<string, HTMLCanvasElement>();

function loadSheet(palette: number): Promise<HTMLImageElement> {
  let pending = sheets.get(palette);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { sheets.delete(palette); reject(new Error('像素角色加载失败')); };
      image.src = `/pixel/characters/char_${palette}.png`;
    });
    sheets.set(palette, pending);
  }
  return pending;
}

export async function loadFrames(palette: number): Promise<void> {
  const image = await loadSheet(palette);
  for (const [direction, row] of [['down', 0], ['up', 1], ['right', 2], ['left', 2]] as const) {
    for (let frame = 0; frame < 7; frame++) {
      const key = `${palette}:${direction}:${frame}`;
      if (frameCache.has(key)) continue;
      const canvas = document.createElement('canvas'); canvas.width = SPRITE_W; canvas.height = SPRITE_H;
      const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
      if (direction === 'left') { ctx.translate(SPRITE_W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(image, frame * SPRITE_W, row * SPRITE_H, SPRITE_W, SPRITE_H, 0, 0, SPRITE_W, SPRITE_H);
      frameCache.set(key, canvas);
    }
  }
}
export function spriteFrame(palette: number, action: EmployeeAction, walking: boolean, direction: Direction, time: number): HTMLCanvasElement | undefined {
  const frame = walking ? [0, 1, 2, 1][Math.floor(time * 8) % 4]
    : action === 'working' ? 3 + Math.floor(time * 3) % 2
    : action === 'listening' ? 5 + Math.floor(time * 2) % 2 : 1;
  return frameCache.get(`${palette}:${direction}:${frame}`);
}
