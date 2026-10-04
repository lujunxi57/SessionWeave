/** Adapted from Pixel Agents engine/matrixEffect.ts at 3537e140. MIT.
 * Retains its staggered column sweep and deterministic flicker, adapted to a
 * cached Canvas sprite and the Sage Paper Light palette. See THIRD_PARTY_NOTICES.md.
 */
import { SCALE, SPRITE_H, SPRITE_W } from './sprites';
export const SPAWN_DURATION = .75;
export function drawSpawn(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, elapsed: number, seeds: number[]): void {
  const progress = Math.min(1, elapsed / SPAWN_DURATION), trail = 7;
  for (let col = 0; col < SPRITE_W; col++) {
    const stagger = seeds[col] * .22;
    const head = Math.max(0, Math.min(1, (progress - stagger) / (1 - stagger))) * (SPRITE_H + trail);
    for (let row = 0; row < SPRITE_H; row++) {
      const distance = head - row;
      if (distance < 0) continue;
      const x = col * SCALE, y = row * SCALE;
      ctx.drawImage(sprite, col, row, 1, 1, x, y, SCALE, SCALE);
      const flicker = ((col * 7 + row * 13 + Math.floor(elapsed * 15) * 31) & 255) < 180;
      if (distance < 1) ctx.fillStyle = '#d5f3d9';
      else if (distance < trail && flicker) ctx.fillStyle = `rgba(32,107,92,${(1 - distance / trail) * .8})`;
      else continue;
      ctx.fillRect(x, y, SCALE, SCALE);
    }
  }
}
