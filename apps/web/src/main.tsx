import { createRoot } from "react-dom/client";

import { App } from "./App.js";

const rootElement = document.querySelector<HTMLDivElement>("#root");

if (!rootElement) {
  throw new Error("Missing #root mount point.");
}

createRoot(rootElement).render(<App />);
