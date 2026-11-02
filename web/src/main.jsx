import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
// The family's shared stylesheet first (tokens, controls, dark mode, banner), then this app's aliases and layout.
import "./standalone-ui.css";
import "./tokens.css";
import "./app.css";

createRoot(document.getElementById("root")).render(<App />);
