import { createAppClient } from "@supah-osint/rpc/schema";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createElectrobunTransport } from "./electrobun-transport.ts";
import "./app.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

const client = createAppClient(await createElectrobunTransport());

createRoot(root).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
