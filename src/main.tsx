import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./app/App";
import { WorkspaceProvider } from "./state/store";
import "./styles/app.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <WorkspaceProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </WorkspaceProvider>
  </React.StrictMode>,
);
