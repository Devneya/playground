import { useCallback } from "react";
import useFlowStore from "../../../logic/flowStore/flowStore";
import {
  ContentNode, ContentResponse, isAudioResponse,
  isContentNode,
  isContentNodeData, isImageResponse, isPdfResponse, isTextResponse,
} from "../../../logic/flowStore/interfaces";
import { DEFAULT_CONTENT_NODE_SIZE } from "../../../config/nodeSize";
import { XYPosition } from "@xyflow/react";
import { ImagesResponse } from "openai/resources";
import { downloadFile } from "../../../storage";

export default function useContentNode() {
  const addContentNode = useFlowStore.use.addContentNode();
  const getNodeCopyById = useFlowStore.use.getNodeCopyById();
  const setNodeToFocus = useFlowStore.use.setNodeToFocus();
  const getNodeChildren = useFlowStore.use.getNodeChildren();
  const getNodeById = useFlowStore.use.getNodeById();
  const getNodeSize = useFlowStore.use.getNodeSize();
  const duplicateEdges = useFlowStore.use.duplicateEdges();

  const duplicateNode = useCallback(
    (id: string) => {
      const node = getNodeCopyById(id);
      if (!node) {
        console.error(`Error when duplicating the node: Node with id '${id}' not found.`);
        return;
      }

      try {
        if (!isContentNodeData(node.data)) {
          return;
        }
        const parentPromptId = node.data.parentId;
        let newPosition: XYPosition = {
          x: node.position.x + DEFAULT_CONTENT_NODE_SIZE.width,
          y: node.position.y,
        };
        if (parentPromptId) {
          const siblings = getNodeChildren(parentPromptId);
          const contentSiblings = siblings
            .map((id) => getNodeById(id))
            .filter((n): n is ContentNode => !!n && isContentNode(n))

            .filter((s) => {
              const pos = s.position;
              const size = getNodeSize(s.id);
              const height = size.height || DEFAULT_CONTENT_NODE_SIZE.height;
              const top = pos.y;
              const bottom = pos.y + height;

              return bottom > node.position.y && top < (node.position.y + (node.height ?? DEFAULT_CONTENT_NODE_SIZE.height));
            });

          const rightMostX =
            contentSiblings.length > 0
              ? Math.max(...contentSiblings.map((n) => n.position.x + (getNodeSize(n.id).width || DEFAULT_CONTENT_NODE_SIZE.width)))
              : 0;

          newPosition = {
            x: rightMostX,
            y: node.position.y,
          };
        }
        const newNode = addContentNode(
          newPosition,
          {
            ...node.data
          },
          {
            width: node.measured?.width ?? DEFAULT_CONTENT_NODE_SIZE.width,
            height: node.measured?.height ?? DEFAULT_CONTENT_NODE_SIZE.height,
          }
        );
        duplicateEdges(id, newNode.id);
        setNodeToFocus(newNode.id);
      } catch (error) {
        console.error("Error when duplicating the node:", error);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addContentNode, getNodeCopyById, setNodeToFocus, duplicateEdges]
  );

  const isImagesResponse = useCallback((obj: any): obj is ImagesResponse => {
    return (
      typeof obj.created === "number" &&
      obj.data !== undefined &&
      obj.data.length > 0 &&
      (typeof obj.data[0].b64_json === "string" ||
        typeof obj.data[0].url === "string")
    );
  }, []);

  const parseResponseText = useCallback((responseText: string) => {
    const thinkMatch = responseText.match(/<think>([\s\S]*?)<\/think>/);
    const answerMatch = responseText.match(/<answer>([\s\S]*?)<\/answer>/);
    return {
      thinking: thinkMatch ? thinkMatch[1].trim() : "",
      answer: answerMatch ? answerMatch[1].trim() : responseText,
    };
  }, []);


  const copyResponse = useCallback(async (response: ContentResponse) => {
    if (isTextResponse(response)) {
      navigator.clipboard.writeText(response.text);
    } else if (isImageResponse(response)) {
      const filedata = await downloadFile(response.path);
      if (filedata instanceof Blob) {
        navigator.clipboard
          .write([
            new ClipboardItem({
              "image/png": filedata.slice(0, filedata.size, "image/png"),
            }),
          ])
          .then(() => console.log("Image copied."))
          .catch((err) =>
            console.error(`Error on image copy: ${err.toString()}`)
          );
      }
    }
  }, []);

  const downloadResponse = useCallback(async (response: ContentResponse) => {
    if (isTextResponse(response)) {
      let filename = "text.txt";
      let contentType = "text/plain;charset=utf-8;";
      let url =
        "data:" +
        contentType +
        "," +
        encodeURIComponent(response.text);
      initiateDownload(filename, url);
    } else if (isImageResponse(response) || isAudioResponse(response) || isPdfResponse(response)) {
      let filename =
        isImageResponse(response) ? "image.png"
          : isAudioResponse(response) ? "audio.mp3"
            : "document.pdf";
      const filedata = await downloadFile(response.path);
      if (filedata instanceof Blob) {
        const url = URL.createObjectURL(filedata);
        initiateDownload(filename, url);
        URL.revokeObjectURL(url);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initiateDownload = useCallback((filename: string, url: string) => {
    let a = document.createElement("a");
    a.download = filename;
    a.href = url;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  /**
   * Adjusts child node position relative to parent after resizing
   */
  const correctChildPositionAfterResize = useCallback((
    oldSize: { width: number; height: number },
    newSize: { width: number; height: number },
    childPos: XYPosition,
    parentPos?: XYPosition,
  ): XYPosition => {
    if (!parentPos) {
      return childPos;
    }
    const dx = childPos.x - parentPos.x;
    const dy = childPos.y - parentPos.y;
    const isVertical = Math.abs(dy) >= Math.abs(dx);
    const deltaH = newSize.height - oldSize.height;
    if (deltaH === 0) {
      return childPos;
    }

    if (isVertical) {
      return dy < 0
        ? { x: childPos.x, y: childPos.y - deltaH }
        : childPos;
    }
    return {
      x: childPos.x,
      y: childPos.y - deltaH / 2,
    };
  }, []);


  return {
    duplicateNode,
    isImagesResponse,
    parseResponseText,
    copyResponse,
    downloadResponse,
    correctChildPositionAfterResize,
    initiateDownload
  };
}
