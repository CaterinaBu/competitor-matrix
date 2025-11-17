import React from "react";
import { createRoot } from "react-dom/client";
import CompetitorMatrix from "./CompetitorMatrix";
import { PasswordGate } from "./PasswordGate";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PasswordGate>
      <CompetitorMatrix />
    </PasswordGate>
  </React.StrictMode>
);
