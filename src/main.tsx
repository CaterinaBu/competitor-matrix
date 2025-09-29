import React from "react";
import { createRoot } from "react-dom/client";
import CompetitorMatrix from "./CompetitorMatrix";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CompetitorMatrix />
  </React.StrictMode>
);
