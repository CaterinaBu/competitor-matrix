import React from "react";
import { createRoot } from "react-dom/client";
import CompetitorMatrix from "./CompetitorMatrix";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CompetitorMatrix />
  </React.StrictMode>
);
