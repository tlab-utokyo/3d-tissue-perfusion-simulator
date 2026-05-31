/**
 * Footer — ただし書き（パラメータは確定値でない旨）＋ 参考文献リスト。
 * 細胞種ツールチップの [n] からこの各項目（id=ref{n}）へジャンプできる。
 */
import styles from "./Footer.module.css";

interface Ref {
  n: number;
  text: string;
  doi?: string;
  url?: string;
  note?: string;
}

const REFS: Ref[] = [
  {
    n: 1,
    text: "Wagner BA, Venkataraman S, Buettner GR. The rate of oxygen utilization by cells. Free Radic Biol Med. 2011;51(3):700–712.",
    doi: "10.1016/j.freeradbiomed.2011.05.024",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3147247/",
    note: "全体レンジ・人体平均 2.5 amol/cell/s の基準",
  },
  {
    n: 2,
    text: "Streeter I, Cheema U. Oxygen consumption rate of cells in 3D culture. Analyst. 2011;136(19):4013–4019.",
    doi: "10.1039/c1an15249a",
    note: "皮膚線維芽細胞 1.19×10⁻¹⁷ mol/cell/s（実測）",
  },
  {
    n: 3,
    text: "Magliaro C, Mattei G, Iacoangeli F, et al. Oxygen Consumption Characteristics in 3D Constructs Depend on Cell Density. Front Bioeng Biotechnol. 2019;7:251.",
    doi: "10.3389/fbioe.2019.00251",
    note: "細胞密度依存性",
  },
  {
    n: 4,
    text: "Place TL, Domann FE, Case AJ. Limitations of Oxygen Delivery to Cells in Culture: An Underappreciated Problem in Basic and Translational Research. Free Radic Biol Med. 2017;113:311–322.",
    doi: "10.1016/j.freeradbiomed.2017.10.003",
    note: "初代肝細胞 200–400 amol/cell/s",
  },
  {
    n: 5,
    text: "Botte E, Cui Y, Magliaro C, Tenje M, Koren K, Rinaldo A, Stocker R, Behrendt L, Ahluwalia A. Size-related variability of oxygen consumption rates in individual human hepatic cells. Lab Chip. 2024;24(17):4128–4137.",
    doi: "10.1039/d4lc00204k",
    note: "単一肝細胞 1.1×10⁻¹⁷ vs 培養 5.5×10⁻¹⁷ mol/cell/s",
  },
];

export function Footer() {
  return (
    <footer className={styles.footer}>
      <p className={styles.disclaimer}>
        本シミュレータのパラメータ（特に酸素消費速度 <b>OCR / q_max</b>、半飽和濃度{" "}
        <b>K_m</b>）は下記文献に基づく<b>代表値</b>です。OCR は測定法・培養日数・酸素分圧・
        細胞密度・初代/株化の別により<b>2桁以上変動</b>します（報告レンジ{" "}
        <b>&lt;1〜&gt;400 amol/cell/s</b>、人体平均 ≈2.5 amol/cell/s）。確定値ではなく
        <b>設計の出発点</b>としてご利用ください。自分の系の実測値があればそれで上書きしてください。
        教育目的のツールです。
      </p>

      <div className={styles.refsTitle}>参考文献</div>
      <ol className={styles.refs}>
        {REFS.map((r) => (
          <li key={r.n} id={`ref${r.n}`}>
            {r.text}
            {r.doi && (
              <>
                {" "}
                <a
                  href={`https://doi.org/${r.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  doi:{r.doi}
                </a>
              </>
            )}
            {r.url && (
              <>
                {" ・ "}
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  全文
                </a>
              </>
            )}
            {r.note && <span> — {r.note}</span>}
          </li>
        ))}
      </ol>
      <p className={styles.range}>
        単位換算: 1 amol/cell/s = 10⁻¹⁸ mol/cell/s。q_max スライダーは 1〜400 amol/cell/s
        相当（10⁻¹⁸〜4×10⁻¹⁶）をカバー。
      </p>
    </footer>
  );
}
