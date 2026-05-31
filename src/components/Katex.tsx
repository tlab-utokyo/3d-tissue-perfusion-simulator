/** KaTeX 数式レンダラ（renderToString を dangerouslySetInnerHTML で挿入） */
import { useMemo } from "react";
import katex from "katex";

export function Math({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: block,
        throwOnError: false,
      }),
    [tex, block],
  );
  return (
    <span
      style={block ? { display: "block", overflowX: "auto" } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
