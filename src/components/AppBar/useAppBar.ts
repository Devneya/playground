import {
  ChangeEvent,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { FlowSnapshot } from "../../logic/flowSnapshot";
import useFlowStore from "../../logic/flowStore/flowStore";
import useViewport from "../../logic/useViewport";
import { EMPTY_FLOW_SNAPSHOT } from "../../config/constants";
import {
  DEFAULT_AUDIO_CONTENT_NODE_SIZE,
  DEFAULT_CONTENT_NODE_SIZE,
  DEFAULT_IMAGE_CONTENT_NODE_SIZE,
  DEFAULT_PROMPT_NODE_SIZE
} from "../../config/nodeSize";
import { Viewport } from "@xyflow/react";
import {
  ContentNodeData, isAudioResponse,
  isContentNode,
  isImageResponse, isPdfResponse, PromptNodeData,
} from "../../logic/flowStore/interfaces";
import saveAs from "file-saver";
import { deleteFile, mimeToExtension, uploadFile } from "../../storage";
import { createFilename } from "../../logic/utils";
import { SessionContext } from "../../context/supabaseContext";
import { saveFlowInUserStorage } from "../../logic/flowSaveAndLoad";
import { createContentZip } from "../Space/useCanvas";

export default function useAppBar() {
  /**
   * Restore saved flow from storage
   */
  const setNodes = useFlowStore.use._setNodes();
  const session = useContext(SessionContext);
  const setCurrentState = useFlowStore.use.setCurrentState();
  const getCurrentState = useFlowStore.use.getCurrentState();
  const getCurrentCanvasId = useFlowStore.use.getCurrentCanvasId();
  const { getViewport } = useViewport();
  const addPromptNode = useFlowStore.use.addPromptNode();
  const addContentNode = useFlowStore.use.addContentNode();
  const getContent = useFlowStore.use.getContent();

  const [prevAddViewport, setPrevAddViewport] = useState<Viewport | undefined>(
    undefined
  );
  const [notMovedCreations, setNotMovedCreations] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const calcNodeOnViewPosition = useCallback(
    (
      x: number,
      y: number,
      currentWindowWidth: number,
      currentWindowHeight: number,
      zoom: number,
      newNotMovedCreations: number
    ) => ({
      x:
        -x / zoom + currentWindowWidth / 2 - DEFAULT_PROMPT_NODE_SIZE.width / 2, //to make it in center
      y:
        -y / zoom +
        currentWindowHeight / 2 -
        50 / zoom -
        DEFAULT_PROMPT_NODE_SIZE.height / 2 + //to make first one in center
        (DEFAULT_PROMPT_NODE_SIZE.height + 15) * newNotMovedCreations,
    }),
    []
  );

  const addNewNodeOnView = useCallback(
    (nodeType: "prompt" | "content" | "fixed",
      contentData?: ContentNodeData,
      fileType?: "text" | "image" | "audio" | "pdf",
      screenPosition?: { x: number; y: number },
      promptData?: PromptNodeData,
    ) => {
      let nodePosition;
      const { x, y, zoom } = getViewport();

      const contentNodeSize = (fileType === "image" || fileType === "pdf") ? DEFAULT_IMAGE_CONTENT_NODE_SIZE :
        fileType === "audio" ? DEFAULT_AUDIO_CONTENT_NODE_SIZE : DEFAULT_CONTENT_NODE_SIZE
      const nodeSize =
        nodeType === "prompt"
          ? DEFAULT_PROMPT_NODE_SIZE
          : contentNodeSize;

      if (screenPosition) {
        nodePosition = {
          x: (screenPosition.x - x) / zoom - nodeSize.width / 2,
          y: (screenPosition.y - y) / zoom - nodeSize.height / 2,
        };
      } else {
        const currentWindowWidth = window.innerWidth / zoom;
        const currentWindowHeight = window.innerHeight / zoom;
        const notMoved =
          prevAddViewport?.x === x &&
          prevAddViewport?.y === y &&
          prevAddViewport?.zoom === zoom;
        const newNotMovedCreations = notMoved ? notMovedCreations + 1 : 0;
        nodePosition = calcNodeOnViewPosition(
          x,
          y,
          currentWindowWidth,
          currentWindowHeight,
          zoom,
          newNotMovedCreations
        );

        const nodes = useFlowStore.getState().nodes;
        setNotMovedCreations(newNotMovedCreations);
        setPrevAddViewport({ x, y, zoom });
      }

      if (nodeType === "prompt") {
        addPromptNode(
          nodePosition,
          promptData
        );
      } else if (nodeType === "content") {
        if (contentData === undefined) {
          contentData = {
            parentId: "",
            prompt: "",
            responsePromise: undefined,
            response: { text: "", type: "text" },
          };
        }
        addContentNode(
          nodePosition,
          contentData,
          contentNodeSize
        );
      }
    },
    [
      calcNodeOnViewPosition,
      addContentNode,
      addPromptNode,
      getViewport,
      notMovedCreations,
      prevAddViewport,
    ]
  );

  /*
   * Export flow data
   */
  const exportToJson = function (flowData: FlowSnapshot) {
    let filename = "flow_data.json";
    let contentType = "application/json;charset=utf-8;";
    // if (window.navigator) {
    //   var blob = new Blob(
    //     [decodeURIComponent(encodeURI(JSON.stringify(flowData)))],
    //     { type: contentType }
    //   );
    //   navigator.msSaveOrOpenBlob(blob, filename);
    // } else {
    let a = document.createElement("a");
    a.download = filename;
    a.href =
      "data:" +
      contentType +
      "," +
      encodeURIComponent(JSON.stringify(flowData, null, 2));
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // }
  };

  const [importContentFile, setImportContentFile] = useState<{
    user_id: string;
    file: File;
    dropPosition?: { x: number; y: number };
  }>();

  const handleFileChange = (
    e: ChangeEvent<HTMLInputElement>,
    user_id: string
  ) => {
    console.log("File change.");
    if (e.target.files) {
      const currFile = e.target.files[0];
      setImportContentFile({ user_id: user_id, file: currFile });
    }
    e.currentTarget.value = "";
  };

  const handleFileDrop = (
    file: File,
    user_id: string,
    dropPosition?: { x: number; y: number }
  ) => {
    setImportContentFile({ user_id, file, dropPosition });
  };

  /*
   * Handle change of the content file
   */
  const handleImportContent = async function () {
    if (importContentFile === undefined) {
      return;
    }
    const { file, dropPosition } = importContentFile;

    if (
      file.name.includes(".txt") ||
      file.name.includes(".md")
    ) {
      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = () => {
        let textContent: any = undefined;
        try {
          if (reader.result !== null) {
            textContent = reader.result.toString();
            addNewNodeOnView("content", {
              parentId: "",
              prompt: "",
              responsePromise: undefined,
              isImported: true,
              response: { text: textContent, type: "text" },
            },
              "text",
              dropPosition);
          }
        } catch (e) {
          console.log(e);
        }
      };
      setImportContentFile(undefined);
      return;
    }

    if (!session) {
      return;
    }
    const filename = createFilename();

    if (
      file.name.includes(".jpg") ||
      file.name.includes(".png") ||
      file.name.includes(".jpeg")
    ) {
      file.arrayBuffer().then(async (arrayBuffer) => {
        const blob = new Blob([new Uint8Array(arrayBuffer)], {
          type: file.type,
        });
        await uploadFile(
          blob,
          filename,
          session.user.id,
          session.access_token
        );

        addNewNodeOnView("content", {
          parentId: "",
          prompt: "",
          responsePromise: undefined,
          isImported: true,
          response: { path: `${session.user.id}/${filename}.png`, type: "image" },
        }, "image", dropPosition);
      });
    } else if (
      importContentFile.file.type.startsWith("audio/")
    ) {
      const ext = mimeToExtension(file.type);
      if (!ext) {
        console.error("Unsupported audio mime:", file.type);
        return;
      }

      await uploadFile(
        file,
        filename,
        session.user.id,
        session.access_token
      );
      addNewNodeOnView("content", {
        parentId: "",
        prompt: "",
        responsePromise: undefined,
        response: {
          path: `${session.user.id}/${filename}.${ext}`,
          type: "audio",
        },
        isImported: true,
      }, "audio", dropPosition);
    } else if (
      file.type === "application/pdf"
    ) {
      await uploadFile(
        file,
        filename,
        session.user.id,
        session.access_token
      );

      addNewNodeOnView("content", {
        parentId: "",
        prompt: "",
        responsePromise: undefined,
        response: {
          path: `${session.user.id}/${filename}.pdf`,
          type: "pdf"
        },
        isImported: true,
      }, "pdf", dropPosition);
    } else {
      console.log(`Could not import ${file.name}`);
    }
    setImportContentFile(undefined);
  };

  useEffect(() => {
    handleImportContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importContentFile, addContentNode, addNewNodeOnView]);

  const clearFlow = async function (access_token: string) {
    const nodes = useFlowStore.getState().nodes;
    for (const node of nodes) {
      if (
        isContentNode(node) &&
        node.data.response &&
        (isImageResponse(node.data.response) || isAudioResponse(node.data.response) || isPdfResponse(node.data.response))
      ) {
        deleteFile(access_token, node.data.response.path);
      }
    }

    setCurrentState(EMPTY_FLOW_SNAPSHOT);
    const isSaved = await saveFlowInUserStorage(getCurrentState(), getCurrentCanvasId());
    if (isSaved) {
      console.log("Successfully saved flow in user storage.");
    } else {
      console.error("Error saving flow in user storage");
    }
  };

  /*
   * Export generated images and text to zip archive
   */
  const exportContent = async function () {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const blob = await createContentZip(getContent());
      saveAs(blob, "canvas.zip");
    } catch (error) {
      console.error("Error exporting content from canvas: ", error);
    } finally {
      setIsExporting(false);
    }
  };

  return {
    addNewNodeOnView,
    exportToJson,
    handleFileChange,
    clearFlow,
    exportContent,
    handleFileDrop,
    isExporting,
  };
}
