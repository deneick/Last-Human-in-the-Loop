import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App4 from "./App4";
import App from "./App";
import "./App.css";

/** Standard ist das aktuelle Spiel (v4 Delegationsökonomie). Das frühere
 * Aufsichts-Spiel (v2/v3) bleibt über den Umschalter erreichbar. */
function Root() {
  const [legacy, setLegacy] = useState(false);
  return (
    <>
      <div style={{ position: "fixed", right: 8, top: "calc(6px + env(safe-area-inset-top))", zIndex: 50 }}>
        <button style={{ fontSize: "0.7rem", minHeight: 30, padding: "4px 8px", opacity: 0.7 }} onClick={() => setLegacy((v) => !v)}>
          {legacy ? "→ v4" : "→ v2/v3"}
        </button>
      </div>
      {legacy ? <App /> : <App4 />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
