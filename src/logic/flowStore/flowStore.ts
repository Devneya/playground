import {NodeSlice, createNodeSlice} from "./nodeSlice";
import {EdgeSlice, createEdgeSlice} from "./edgeSlice";
import {ViewportSlice, createViewportSlice} from "./viewportSlice";
import {SharedSlice, createSharedSlice} from "./sharedSlice";
import {StoreApi, UseBoundStore, create} from "zustand";
import {CanvasSlice, createCanvasSlice} from "./canvasSlice";

const useFlowStoreBase = create<
  NodeSlice & EdgeSlice & ViewportSlice & SharedSlice & CanvasSlice
>()((...a) => ({
  ...createNodeSlice(...a),
  ...createEdgeSlice(...a),
  ...createViewportSlice(...a),
  ...createSharedSlice(...a),
  ...createCanvasSlice(...a),
}));

type WithSelectors<S> = S extends { getState: () => infer T }
  ? S & { use: { [K in keyof T]: () => T[K] } }
  : never;

const createSelectors = <S extends UseBoundStore<StoreApi<object>>>(
  _store: S
) => {
  let store = _store as WithSelectors<typeof _store>;
  store.use = {};
  for (let k of Object.keys(store.getState())) {
    (store.use as any)[k] = () => store((s) => s[k as keyof typeof s]);
  }

  return store;
};

const useFlowStore = createSelectors(useFlowStoreBase);
export default useFlowStore;
