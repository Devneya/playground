import { App as ProductionApp } from "../app/App";
import { MockAuthProvider } from "../auth/MockAuthProvider";
import { readBrowserConnection } from "../api/browserConnection";

/** Mock-only entrypoint; production loads the regular App entrypoint. */
export const App = () => <ProductionApp authBoundary={MockAuthProvider} {...(readBrowserConnection() === undefined ? { initialProvider: "devneya" as const } : {})} />;
