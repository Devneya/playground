import {useCallback, useContext, useEffect, useRef, useState} from "react";
import {
  ReactFlow,
  BackgroundVariant,
  Background,
  Controls,
  Viewport, ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import PromptNode from "./Nodes/PromptNode/Node";
import ContentNode from "./Nodes/ContentNode/Node";
import useFlowStore from "../logic/flowStore/flowStore";
import FloatingEdge from "./Edges/FloatingEdge/FloatingEdge";
import FloatingConnectionLine from "./Edges/FloatingEdge/FloatingConnectionLine";
import FlowAppBar from "./AppBar/AppBar";
import React from "react";
import theme from "../themes";
import AccountMenuModal from "./AccountMenuModal";
import ModelParamsMenu from "./ModelParamsMenu";
import TemplatesModal from "./Templates/TemplatesModal";
import {useSnackbar} from "notistack";
import ContainerNode from "./Nodes/ContainerNode/Node";
import {useDropzone, DropEvent} from "react-dropzone";
import useAppBar from "./AppBar/useAppBar";
import {SessionContext, VirtualKeyContext} from "../context/supabaseContext";
import {Typography} from "@mui/material";
import useCanvas from "./Space/useCanvas";
import SpaceView from "./Space/SpaceView";
import {loadLastOpenedCanvasId} from "../logic/flowSaveAndLoad";

const nodeTypes = {
  prompt: PromptNode,
  content: ContentNode,
  container: ContainerNode,
};

const edgeTypes = {
  floating: FloatingEdge,
};

const proOptions = {hideAttribution: true};

/**
 * Main ReactFlow component: create canvas and configure its behavior
 */
export default function Flow() {
  // modal window states
  const [open, setOpen] = useState<boolean>(false);
  const [avatarPath, setAvatarPath] = useState<string | undefined>();
  const [isCanvasListOpen, setIsCanvasListOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);
  const session = useContext(SessionContext);
  const virtualKey = useContext(VirtualKeyContext);

  const reactFlowWrapper = useRef<HTMLInputElement | null>(null);
  const nodes = useFlowStore.use.nodes();
  const edges = useFlowStore.use.edges();
  const onMoveEnd = useFlowStore.use.onMoveEnd();
  const onNodesChange = useFlowStore.use.onNodesChange();
  const onNodeDragStop = useFlowStore.use.onNodeDragStop();
  const onEdgesChange = useFlowStore.use.onEdgesChange();
  const onConnect = useFlowStore.use.onConnect();
  const onConnectStart = useFlowStore.use.onConnectStart();
  const onConnectEnd = useFlowStore.use.onConnectEnd();
  const onEdgeMouseEnter = useFlowStore.use.onEdgeMouseEnter();
  const onEdgeMouseLeave = useFlowStore.use.onEdgeMouseLeave();
  const loadInitialFlow = useFlowStore.use.loadInitialFlow();
  const isOpenModelParamsMenu = useFlowStore.use.isOpenModelParamsMenu();
  const selectedModel = useFlowStore.use.selectedModel();
  const setCurrentCanvas = useFlowStore.use.setCurrentCanvasId();
  const getCanvases = useFlowStore.use.getCanvases();
  const getCanvasById = useFlowStore.use.getCanvasById();
  const addNewCanvas = useFlowStore.use.addNewCanvas();
  const setCanvases = useFlowStore.use.setCanvases();
  const setStoreViewport = useFlowStore.use.setStoreViewport();
  const getStoreViewport = useFlowStore.use.getStoreViewport();

  //Loading initial flow from CDN and DexieDB
  const [loaded, setLoaded] = useState(false);

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const {loadCanvasIndex} = useCanvas();

  // Initialize Canvases from index and load saved Flow of the last opened canvas,
  // immediately set the storeViewport in the store.
  useEffect(() => {
    if (loaded || !session || virtualKey === null) {
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const index = await loadCanvasIndex();
        setCanvases(index);
        const lastOpenedCanvasId = await loadLastOpenedCanvasId(getCanvases, getCanvasById, addNewCanvas);
        setCurrentCanvas(lastOpenedCanvasId);
        const flow = await loadInitialFlow();
        const viewport: Viewport = flow ?? {x: 0, y: 0, zoom: 0.9};
        setStoreViewport(viewport);

        if (mounted) {
          setLoaded(true);
        }
      } catch (error) {
        console.error("Error initializing the Flow:", error);
      }
    })();

    return () => {
      mounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, virtualKey]);

  // After Flow has fully initialized, apply the stored viewport to the React Flow instance.
  // If this runs before Flow is loaded, the viewport won't be applied correctly.
  useEffect(() => {
    if (!rfInstance) return;
    const viewport = getStoreViewport();
    if (!viewport) return;

    requestAnimationFrame(() => {
      rfInstance.setViewport(viewport, {duration: 0});
    });
  }, [rfInstance, loaded, getStoreViewport]);

  // Notifiaction management about not created edge.
  const {enqueueSnackbar} = useSnackbar();

  const handleAddNewEdgeResult = useCallback((res?: Error) => {
    if (res) {
      console.error(res);
      enqueueSnackbar("You can not create cycle with new edge", {
        variant: "error",
      });
    }
  }, [enqueueSnackbar]);

  // Handle drag & drop for content import (single file only)
  const {handleFileDrop} = useAppBar();

  const onDrop = useCallback(
    (
      files: File[],
      _fileRejections: unknown[],
      event?: DropEvent
    ) => {
      if (!session || !event || files.length === 0) {
        return;
      }
      const file = files[0];
      if (!file) {
        return;
      }
      if (!("clientX" in event) || !("clientY" in event)) {
        handleFileDrop(file, session.user.id);
        return;
      }
      handleFileDrop(file, session.user.id, {x: event.clientX, y: event.clientY});
    },
    [handleFileDrop, session]
  );

  const {getRootProps, getInputProps, isDragActive} = useDropzone({
    onDrop,
    noClick: true,
    multiple: false,
    accept: {
      "image/*": [".jpg", ".jpeg", ".png"],
      "text/plain": [".txt", ".md"],
      "audio/*": [".mp3", ".wav", ".ogg", ".m4a"],
      "application/pdf": [".pdf"],
    },
  });

  /*
   * The main component - the canvas with nodes and edges itself.
   * It takes some time to actually load it (loaded ? () : ()).
   * <React.Fragment> needs to show notifications: like it is done here https://mui.com/base-ui/react-snackbar/.
   * <ReactFlow> has many props for different needs.
   * It is easy to see them just by examine its type or here: https://reactflow.dev/docs/api/react-flow-props/
   */
  return (
    <div className="wrapper" ref={reactFlowWrapper} {...getRootProps()}>
      <input {...getInputProps()} />
      <React.Fragment>
        {isCanvasListOpen ? (
          <SpaceView
            onBack={async () => {
              setIsCanvasListOpen(false);
            }}
          />
        ) : (
          <>
            <ReactFlow
              onInit={
                (instance) => {
                  // @ts-ignore - suppressed because of custom edges
                  setRfInstance(instance);
                }
              }
              fitView={false}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeDragStop={onNodeDragStop}
              onEdgesChange={onEdgesChange}
              onMoveEnd={onMoveEnd}
              onConnect={(connection) => {
                const res = onConnect(connection);
                handleAddNewEdgeResult(res === undefined ? undefined : res);
              }}
              onConnectStart={onConnectStart}
              onConnectEnd={(event: MouseEvent | TouchEvent) =>
                onConnectEnd(
                  event,
                  reactFlowWrapper.current
                    ? reactFlowWrapper.current.getBoundingClientRect()
                    : undefined
                )
              }
              deleteKeyCode={null}
              onEdgeMouseEnter={onEdgeMouseEnter}
              onEdgeMouseLeave={onEdgeMouseLeave}
              connectionLineComponent={FloatingConnectionLine}
              minZoom={0.2}
              maxZoom={2}
              proOptions={proOptions}
              style={{backgroundColor: theme.palette.background.default}}
              defaultViewport={{x: 0, y: 0, zoom: 0.9}}
            >
              <FlowAppBar
                openAccountMenuModal={handleOpen}
                avatarPath={avatarPath}
                onOpenCanvasList={setIsCanvasListOpen}
                onOpenTemplates={() => setIsTemplatesOpen(true)}
              />
              <Background
                variant={BackgroundVariant.Lines}
                gap={30}
                id={"main-flow"}
              />
              <Controls
                style={{
                  marginLeft: "20px",
                  marginBottom: "20px",
                  borderRadius: "5px",
                  overflow: "hidden",
                  padding: "8px 6px",
                  backgroundColor: "white",
                }}
                showInteractive={false}
              />
            </ReactFlow>

            <AccountMenuModal
              open={open}
              handleOpen={handleOpen}
              handleClose={handleClose}
              avatarPath={avatarPath}
              setAvatarPath={setAvatarPath}
            />

            {selectedModel !== undefined ? (
              <ModelParamsMenu isOpenModelParamsMenu={isOpenModelParamsMenu}/>
            ) : null}

            <TemplatesModal
              open={isTemplatesOpen}
              onClose={() => setIsTemplatesOpen(false)}
            />
          </>
        )}
      </React.Fragment>
      {isDragActive && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,0.25)",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
            zIndex: 10,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Typography
            variant="overline"
            sx={{
              color: theme.palette.text.primary,
              userSelect: "none",
              fontSize: "16px",
            }}
          >
            Drop file to create node
          </Typography>
        </div>
      )}
    </div>
  );
}
