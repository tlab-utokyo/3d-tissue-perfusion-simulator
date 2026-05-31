// 一時スモークテスト: App を happy-dom 上で実レンダリングし、例外が出ないか確認
import { register } from "node:module";
// CSS / CSS Modules インポートをスタブ（tsx の後に登録 → こちらが先に走る）
register(new URL("./css-loader.mjs", import.meta.url));
import { Window } from "happy-dom";
import React from "react";

const win = new Window({ url: "http://localhost/" });
// グローバルに DOM を注入
const g = globalThis as any;
g.window = win;
g.document = win.document;
try {
  Object.defineProperty(g, "navigator", { value: win.navigator, configurable: true });
} catch {
  /* navigator は読み取り専用環境ではスキップ */
}
g.HTMLElement = win.HTMLElement;
g.HTMLCanvasElement = win.HTMLCanvasElement;
g.Element = win.Element;
g.Node = win.Node;
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};
g.devicePixelRatio = 1;
// canvas getContext を最小スタブ（Heatmap 用）
(win.HTMLCanvasElement.prototype as any).getContext = () => ({
  setTransform: () => {},
  clearRect: () => {},
  createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: () => {},
  beginPath: () => {},
  arc: () => {},
  stroke: () => {},
  fill: () => {},
  setLineDash: () => {},
});

async function main() {
  const { createRoot } = await import("react-dom/client");
  const App = (await import("../src/App.tsx")).default;
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await new Promise<void>((resolve, reject) => {
    try {
      root.render(React.createElement(App));
      // flush microtasks/effects
      setTimeout(resolve, 200);
    } catch (e) {
      reject(e);
    }
  });
  const html = (container as unknown as HTMLElement).innerHTML;
  const ok = html.includes("3D tissue perfusion Simulator");
  console.log("rendered length:", html.length, " title present:", ok);
  console.log("smoke:", ok ? "PASS" : "FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke ERROR:", e);
  process.exit(1);
});
