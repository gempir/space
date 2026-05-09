import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Identity } from "spacetimedb";
import { SpacetimeDBProvider } from "spacetimedb/react";
import App from "./App.tsx";
import "./index.css";
import { DbConnection, type ErrorContext } from "./module_bindings";

const SPACETIMEDB_URI =
  import.meta.env.VITE_SPACETIMEDB_URL ?? "ws://127.0.0.1:3000";
const DATABASE_NAME = "space";
const TOKEN_KEY = `${SPACETIMEDB_URI}/${DATABASE_NAME}/auth_token`;

const onConnect = (_conn: DbConnection, identity: Identity, token: string) => {
  localStorage.setItem(TOKEN_KEY, token);
  console.log("Connected to SpacetimeDB:", identity.toHexString());
};

const onDisconnect = (_ctx: ErrorContext, error: Error | undefined) => {
  if (error) {
    console.error("Disconnected from SpacetimeDB:", error);
  } else {
    console.log("Disconnected from SpacetimeDB");
  }
};

const onConnectError = (_ctx: ErrorContext, error: Error) => {
  console.error("Error connecting to SpacetimeDB:", error);
};

const connectionBuilder = DbConnection.builder()
  .withUri(SPACETIMEDB_URI)
  .withDatabaseName(DATABASE_NAME)
  .withToken(localStorage.getItem(TOKEN_KEY) ?? undefined)
  .onConnect(onConnect)
  .onDisconnect(onDisconnect)
  .onConnectError(onConnectError);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>,
);
