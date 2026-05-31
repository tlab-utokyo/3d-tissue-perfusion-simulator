/**
 * useSimulation — Solver と UI 状態（field, t, playing）を仲介する React hook
 *
 * - params 変更で Solver を再構築し過渡をリスタート（spec「即再計算」）
 * - 定常解 steadyField を併せて計算（プロファイルの破線オーバーレイ・残差表示用）
 * - 再生中は requestAnimationFrame で CN を進め、field を state へ反映
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Params } from "../solver/presets";
import { Solver, solveSteadyProfile } from "../solver/pde";
import { makeGrid, N_DEFAULT, type Grid } from "../solver/grid";

const FRAME_DT_FRAC = 0.01; // 1フレームで進める Δt = この割合 × τ(=L²/D)（立ち上がりを細かく解像）
const MAX_SNAPSHOTS = 6;
const MAX_FRAMES = 2000; // 時間履歴の上限（過渡は自動停止で十分手前に収束する）

export interface Snapshot {
  t: number;
  field: Float64Array;
}

/** 時間履歴の 1 フレーム（C(r, t) を 2 次元 [time][radius] として保持するための行） */
export type Frame = Snapshot;

export interface Simulation {
  params: Params;
  grid: Grid;
  field: Float64Array; // 現在の濃度場 [mol/m^3]
  steadyField: Float64Array; // 定常解（数値・現在の反応律） [mol/m^3]
  t: number; // 経過時間 [s]（Infinity = 定常ソルブ後）
  playing: boolean;
  atSteady: boolean;
  residual: number; // 直近ステップの相対変化 max|ΔC|/max(C,ε) ∈ [0,1]
  snapshots: Snapshot[];
  frames: Frame[]; // 時間履歴 [time]{t, field[radius]}（時間-濃度グラフ用）
  setParams: (next: Params) => void;
  play: () => void;
  pause: () => void;
  stepOnce: () => void;
  reset: () => void;
  solveSteady: () => void;
}

export function useSimulation(initial: Params): Simulation {
  const [params, setParamsState] = useState<Params>(initial);
  const [field, setField] = useState<Float64Array>(() => new Float64Array(N_DEFAULT));
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [residual, setResidual] = useState(1);

  const solverRef = useRef<Solver | null>(null);
  const rafRef = useRef<number | null>(null);

  // grid と steadyField は params から導出
  const grid = useMemo(() => makeGrid(params.a, params.L, N_DEFAULT), [params]);
  // 定常解（数値）。表示用に負値は 0 にクランプ（壊死コア = 0）。
  const steadyField = useMemo(() => {
    const f = solveSteadyProfile(params, N_DEFAULT).field.slice();
    for (let i = 0; i < f.length; i++) if (f[i] < 0) f[i] = 0;
    return f;
  }, [params]);

  // params 変更 → Solver 再構築 & 過渡リスタート
  useEffect(() => {
    const solver = new Solver(params, N_DEFAULT, { clampReaction: true });
    solverRef.current = solver;
    setField(solver.displayField());
    setT(0);
    setResidual(1);
    setSnapshots([]);
    setFrames([{ t: 0, field: solver.displayField() }]); // t=0 の初期フレーム
  }, [params]);

  const captureSnapshot = useCallback((solver: Solver) => {
    setSnapshots((prev) => {
      const next = [...prev, { t: solver.t, field: solver.displayField() }];
      return next.length > MAX_SNAPSHOTS ? next.slice(next.length - MAX_SNAPSHOTS) : next;
    });
  }, []);

  const recordFrame = useCallback((solver: Solver) => {
    setFrames((prev) =>
      prev.length >= MAX_FRAMES ? prev : [...prev, { t: solver.t, field: solver.displayField() }],
    );
  }, []);

  // 再生ループ
  useEffect(() => {
    if (!playing) return;
    const solver = solverRef.current;
    if (!solver) return;
    const frameDt = FRAME_DT_FRAC * solver.diffusionTime();
    let snapAccum = 0;

    const tick = () => {
      solver.step(frameDt);
      snapAccum += frameDt;
      // τ ごとにスナップショット
      if (snapAccum >= solver.diffusionTime() * 0.5) {
        captureSnapshot(solver);
        snapAccum = 0;
      }
      setField(solver.displayField());
      setT(solver.t);
      setResidual(solver.lastResidual);
      recordFrame(solver);
      // ステップ間変化が十分小さければ定常とみなし自動停止
      if (solver.lastResidual < 1e-4) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, captureSnapshot, recordFrame]);

  const setParams = useCallback((next: Params) => {
    setPlaying(false);
    setParamsState(next);
  }, []);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);

  const stepOnce = useCallback(() => {
    const solver = solverRef.current;
    if (!solver) return;
    setPlaying(false);
    solver.step(FRAME_DT_FRAC * solver.diffusionTime());
    setField(solver.displayField());
    setT(solver.t);
    setResidual(solver.lastResidual);
    recordFrame(solver);
  }, [recordFrame]);

  const reset = useCallback(() => {
    const solver = solverRef.current;
    if (!solver) return;
    setPlaying(false);
    solver.reset();
    setField(solver.displayField());
    setT(0);
    setResidual(1);
    setSnapshots([]);
    setFrames([{ t: 0, field: solver.displayField() }]);
  }, []);

  const solveSteady = useCallback(() => {
    const solver = solverRef.current;
    if (!solver) return;
    setPlaying(false);
    solver.steadySolve();
    setField(solver.displayField());
    setT(Infinity);
    setResidual(0);
    setSnapshots([]);
  }, []);

  const atSteady = !Number.isFinite(t) || residual < 1e-3;

  return {
    params,
    grid,
    field,
    steadyField,
    t,
    playing,
    atSteady,
    residual,
    snapshots,
    frames,
    setParams,
    play,
    pause,
    stepOnce,
    reset,
    solveSteady,
  };
}
