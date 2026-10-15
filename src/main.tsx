import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/kantumruy-pro/400.css";
import "@fontsource/kantumruy-pro/600.css";
import "dockview-react/dist/styles/dockview.css";
import "./styles/theme.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { perf } from "./lib/perf";

perf.mark("boot");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
