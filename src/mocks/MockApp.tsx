import { App as ProductionApp } from "../app/App";
import { MockAuthProvider } from "../auth/MockAuthProvider";

/** Mock-only entrypoint; production loads the regular App entrypoint. */
export const App = () => <ProductionApp authBoundary={MockAuthProvider} />;
