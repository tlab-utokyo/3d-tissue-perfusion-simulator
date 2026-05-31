import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App.tsx";
import { logValidation } from "./solver/validate";

// 起動時検証（spec 必須）: 解析解 vs 数値定常の相対誤差を console に表示
logValidation();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
