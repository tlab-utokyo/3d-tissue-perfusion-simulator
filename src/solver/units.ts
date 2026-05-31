/**
 * units.ts — SI 単位への明示的変換
 *
 * 内部計算はすべて SI 統一: 長さ [m], 時間 [s], 濃度 [mol/m^3].
 * UI 入力は µm / mM / cells/mL を使うため、ここで一元的に変換する。
 *
 * 換算の根拠:
 *   1 µm            = 1e-6 m
 *   1 mM = 1 mmol/L = 1e-3 mol / 1e-3 m^3 = 1 mol/m^3   （係数 1。明示のため関数化）
 *   1 cells/mL      = 1 cells / 1e-6 m^3 = 1e6 cells/m^3
 *   q_max [mol/cell/s] は単位変換不要（per cell のまま使う）
 *
 * 体積消費率 R0 [mol/(m^3·s)] = ρ_cell [cells/m^3] · q_max [mol/cell/s]
 */

/** µm → m */
export const umToM = (um: number): number => um * 1e-6;

/** m → µm */
export const mToUm = (m: number): number => m * 1e6;

/** mM (= mmol/L) → mol/m^3  （数値的には等しいが意図を明示） */
export const mMToSI = (mM: number): number => mM * 1.0;

/** mol/m^3 → mM */
export const siToMM = (c: number): number => c * 1.0;

/** cells/mL → cells/m^3 */
export const cellsPerMlToSI = (cellsPerMl: number): number => cellsPerMl * 1e6;

/** cells/m^3 → cells/mL */
export const siToCellsPerMl = (cellsPerM3: number): number => cellsPerM3 * 1e-6;

/**
 * 溶存酸素の分圧換算（Henry 則, 37℃水溶液近似）。
 * O2 溶解度 ≈ 1.3 µM/mmHg = 1.3e-3 mM/mmHg。
 *   例: 0.026 mM ↔ 20 mmHg, 0.003 mM ↔ 2.3 mmHg, 空気飽和 0.21 mM ↔ ~160 mmHg。
 */
export const O2_MM_PER_MMHG = 1.3e-3;
/** mol/m^3(=mM) → mmHg（O2） */
export const siToMmHg = (c: number): number => c / O2_MM_PER_MMHG;
/** mmHg → mol/m^3(=mM)（O2） */
export const mmHgToSI = (p: number): number => p * O2_MM_PER_MMHG;

/** 濃度表示単位 */
export type ConcUnit = "mM" | "mmHg";
/** SI濃度 [mol/m^3] を表示単位の数値へ（mmHg は O2 用） */
export const concToDisplay = (cSI: number, unit: ConcUnit): number =>
  unit === "mmHg" ? siToMmHg(cSI) : siToMM(cSI);
