// 一時検証スクリプト: ソルバの解析解一致と壊死前縁を確認する
import { runValidation, runMonotonicValidation, runBoundaryValidation } from "../src/solver/validate";
import { PRESETS } from "../src/solver/presets";
import { necrosisFront, lCrit } from "../src/solver/analytic";
import { mToUm } from "../src/solver/units";

for (const r of runValidation()) {
  console.log(
    `${r.label}: relL2=${(r.relL2 * 100).toFixed(4)}% maxRel=${(r.maxRel * 100).toFixed(4)}% iters=${r.iterations} pass=${r.pass}`,
  );
}
for (const r of runMonotonicValidation()) {
  console.log(
    `[mono] ${r.label}: overshoot=${(r.maxRelOvershoot * 100).toFixed(3)}% dip=${(r.maxRelDip * 100).toFixed(3)}% pass=${r.pass}`,
  );
}
for (const r of runBoundaryValidation()) {
  console.log(`[bc] ${r.label}: ${r.detail} pass=${r.pass}`);
}
for (const s of ["O2", "Glucose"] as const) {
  const p = PRESETS[s];
  const rp = necrosisFront(p);
  console.log(
    `${s}: a=${mToUm(p.a)}µm b=${mToUm(p.a + p.L)}µm  r_p=${rp ? mToUm(rp).toFixed(1) + "µm" : "none"}  L_crit=${mToUm(lCrit(p)).toFixed(1)}µm`,
  );
}
