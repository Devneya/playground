import { App as Playground } from "./App";
import { LocalAuthProvider } from "../auth/LocalAuthProvider";
export const App = () => <Playground authBoundary={LocalAuthProvider} />;
