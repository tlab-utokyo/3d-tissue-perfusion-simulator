/**
 * grid.ts — 径方向メッシュ
 *
 * r_i = a + i·Δr, i = 0..N-1,  Δr = L/(N-1).
 * r=a (i=0) がルーメン壁、r=b=a+L (i=N-1) が組織外面。
 */

export const N_DEFAULT = 200;

export interface Grid {
  N: number;
  a: number; // 内半径 [m]
  b: number; // 外半径 [m]
  dr: number; // 格子間隔 [m]
  r: Float64Array; // 格子点座標 [m], length N
}

export function makeGrid(a: number, L: number, N: number = N_DEFAULT): Grid {
  const b = a + L;
  const dr = L / (N - 1);
  const r = new Float64Array(N);
  for (let i = 0; i < N; i++) r[i] = a + i * dr;
  return { N, a, b, dr, r };
}

/**
 * 半径 r [m] における濃度を、隣接2メッシュ点の線形補間で評価する。
 * r がメッシュ点間でも滑らかな値を返す（時間-濃度抽出・カーソル表示用）。
 */
export function interpAtRadius(grid: Grid, field: Float64Array, r: number): number {
  const pos = (r - grid.a) / grid.dr;
  const i = Math.max(0, Math.min(grid.N - 2, Math.floor(pos)));
  const f = Math.max(0, Math.min(1, pos - i));
  return field[i] * (1 - f) + field[i + 1] * f;
}
