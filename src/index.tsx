import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_DEVNEYA_SENTRY_URL,
  integrations: [],
});

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
