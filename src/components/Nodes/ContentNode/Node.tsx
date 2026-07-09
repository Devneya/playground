import { Box, Divider, Stack } from "@mui/material";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { NodeProps } from "@xyflow/react";
import useFlowStore from "../../../logic/flowStore/flowStore";
import type { ContentNode as ContentNodeType } from "../../../logic/flowStore/interfaces";
import { isPromptNodeData } from "../../../logic/flowStore/interfaces";
import { isContentNodeData } from "../../../logic/flowStore/interfaces";
import { AudioResponse, isPdfResponse } from "../../../logic/flowStore/interfaces";
import {
  ImageResponse,
  isImageResponse,
  isTextResponse,
  TextResponse,
  isAudioResponse
} from "../../../logic/flowStore/interfaces";

import {
  DEFAULT_CONTENT_NODE_HEADER_HEIGHT,
  DEFAULT_CONTENT_NODE_SIZE, DEFAULT_IMAGE_CONTENT_NODE_SIZE,
  DEFAULT_PROMPT_NODE_SIZE,
} from "../../../config/nodeSize";
import {
  ArrowDownward,
  Cached,
  ContentCopy,
  LibraryAddOutlined,
  SaveAlt,
  SmartButton,
} from "@mui/icons-material";
import { useSnackbar } from "notistack";
import {
  ChatCompletionChunk,
  Completion,
} from "openai/resources";
import {
  SessionContext,
} from "../../../context/supabaseContext";
import { createFilename } from "../../../logic/utils";
import { deleteFile, uploadFile } from "../../../storage";
import DeletePopover from "../../DeletePopover";
import NodeDeleteButton from "../../Buttons/NodeDeleteButton";
import NodeButton from "../../Buttons/NodeButton";
import { ResponseField } from "./ResponseField/ResponseField";
import useContentNode from "./useContentNode";
import { saveFlowInUserStorage } from "../../../logic/flowSaveAndLoad";
import {
  emptyModificationParams, defaultModelConfigurations
} from "../../../logic/models/defaultParams";

import * as Sentry from "@sentry/react";
import { StyledNodeCard, StyledNodeContainer } from "../../../themes/componentStyles";
import { NodeHandles } from "../NodeControls/NodeHandles";
import { NodeResizer } from "../NodeControls/NodeResizer";
import SystemTextButton from "../../Buttons/SystemTextButton";
import usePromptNode from "../PromptNode/usePromptNode";
import theme from "../../../themes";
import { ModelUsedTag } from "./ModelUsedTag";
import ThinkingField from "./ResponseField/ThinkingField";
import { ModelLibrary } from "../../../logic/models/modelLibrary";
import ContentNodeActionButton from "../../Buttons/ContentNodeActionButton";
import useViewport from "../../../logic/useViewport";

export default function ContentNode(props: NodeProps<ContentNodeType>) {
  const session = useContext(SessionContext);
  const { enqueueSnackbar } = useSnackbar();

  // node states
  const [loading, setLoading] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [deleteAnchorEl, setDeleteAnchorEl] = useState<HTMLButtonElement | null>(null);
  const textRef = useRef<HTMLDivElement>(null!);
  const [isHovered, setIsHovered] = useState(false);
  const { getViewport } = useViewport();
  const { zoom } = getViewport();

  // store methods
  const changeNodeResponse = useFlowStore.use.changeNodeResponse();
  const getNodeSize = useFlowStore.use.getNodeSize();
  const addPromptNode = useFlowStore.use.addPromptNode();
  const addNewEdge = useFlowStore.use.addNewEdge();
  const setNodeToFocus = useFlowStore.use.setNodeToFocus();
  const deleteNodeWithEdges = useFlowStore.use.deleteNodeWithEdges();
  const getCurrentState = useFlowStore.use.getCurrentState();
  const getCurrentCanvasId = useFlowStore.use.getCurrentCanvasId();
  const connectionNodeId = useFlowStore.use.connectionNodeId();
  const clearContentResponsePromise = useFlowStore.use.clearContentResponsePromise();
  const getNodeChildren = useFlowStore.use.getNodeChildren();
  const changeNodeStyle = useFlowStore.use.changeNodeStyle();
  const updateNodeSize = useFlowStore.use.updateNodeSize();
  const getNodeById = useFlowStore.use.getNodeById();
  const updateNodePosition = useFlowStore.use.updateNodePosition();
  const getNodeData = useFlowStore.use.getNodeData();
  const updateContainerHeight = useFlowStore.use.updateContainerHeight();
  const getLastNodeOnSide = useFlowStore.use.getLastNodeOnSide();

  // other constants
  const isConnecting = !!connectionNodeId;
  const deleteNodePopoverOpened = Boolean(deleteAnchorEl);

  // node methods
  const {
    duplicateNode,
    isImagesResponse,
    parseResponseText,
    copyResponse,
    downloadResponse,
    correctChildPositionAfterResize
  } = useContentNode();
  const { triggerPromptRequest, computeNewSingleChildPosition, autoViewForRequest } = usePromptNode();

  const handleDeleteButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setDeleteAnchorEl(deleteAnchorEl ? null : event.currentTarget);
  };

  const handleRegenerate = () => {
    const parentId = props.data.parentId;
    if (!parentId) {
      return;
    }

    triggerPromptRequest(
      parentId,
      true,
      props.data.modelUsed
    );
  };

  const handleDownloadResponse = async () => {
    await downloadResponse(props.data.response);
  };
  const handleCopyResponse = async () => {
    await copyResponse(props.data.response);
  };

  const changeCurrentNodeResponse = useCallback((newValue: TextResponse | ImageResponse | AudioResponse | undefined) =>
    changeNodeResponse(props.id, newValue),
    [props.id, changeNodeResponse]
  );

  const createAndConnectPromptNode = (isMultiMode?: boolean) => {
    const targetParentId = isMultiMode ? props.data.parentId : props.id;

    const nodeSize = getNodeSize(props.id);
    const children = getNodeChildren(isMultiMode ? props.data.parentId : props.id);
    const parentNode = getNodeById(props.data.parentId);

    let parentSize = getNodeSize(props.data.parentId);
    let defaultSize = DEFAULT_PROMPT_NODE_SIZE;

    let targetParentPos = isMultiMode
      ? parentNode?.position ?? {
        x: props.positionAbsoluteX,
        y: props.positionAbsoluteY
      }
      : {
        x: props.positionAbsoluteX,
        y: props.positionAbsoluteY
      };

    if (isMultiMode) {
      const lowerChildId = getLastNodeOnSide(children, props.data.parentId, "bottom");
      if (lowerChildId) {
        const lowerChild = getNodeById(lowerChildId);
        targetParentPos = lowerChild?.position ?? {
          x: targetParentPos.x,
          y: targetParentPos.y + DEFAULT_PROMPT_NODE_SIZE.height + 50
        };
        parentSize = getNodeSize(lowerChildId)
        defaultSize = DEFAULT_CONTENT_NODE_SIZE;
      }
    }

    const targetParentHeight = isMultiMode
      ? parentSize.height ?? defaultSize.height
      : nodeSize.height ?? DEFAULT_CONTENT_NODE_SIZE.height;

    const pos = computeNewSingleChildPosition(
      targetParentPos,
      targetParentHeight,
      DEFAULT_PROMPT_NODE_SIZE.width,
      isMultiMode ? [] : children
    );
    const model = ModelLibrary.getModelByName(props.data.modelUsed ?? "");

    const selectedModels =
      isMultiMode
        ? [defaultModelConfigurations.text]
        : model && model.name !== "whisper-1" && model.name !== "Llama-4-Scout-17B-16E-Instruct"
          ? [{
            type: model.type,
            name: model.name,
            params: emptyModificationParams,
          }]
          : parentNode && isPromptNodeData(parentNode.data) && parentNode.data.selectedModels?.length === 1
            ? [parentNode.data.selectedModels[0]]
            : [defaultModelConfigurations.text];

    const recentModelsList = selectedModels.map((m, index) => ({
      value: m.name,
      priority: index,
    }));

    let node = addPromptNode(
      pos,
      {
        isExecuted: false,
        prompt: "",
        parentId: [targetParentId],
        selectedModels,
        recentModelsList,
      },
      DEFAULT_PROMPT_NODE_SIZE
    );
    addNewEdge(targetParentId, node.id);
    return node.id;
  };

  const adjustHeight = () => {
    const nodeSize = getNodeSize(props.id);
    if (textRef && textRef.current) {
      const minHeightTextRef = textRef.current.offsetHeight + DEFAULT_CONTENT_NODE_HEADER_HEIGHT + (isImageResponse(props.data.response) ? 34 : 0);
      updateNodeSize(props.id, {
        width: nodeSize.width ?? DEFAULT_CONTENT_NODE_SIZE.width,
        height: minHeightTextRef,
      });
      changeNodeStyle(props.id, {
        width: nodeSize.width ?? DEFAULT_CONTENT_NODE_SIZE.width,
        height: minHeightTextRef,
      });
    }
  };

  const adjustPosition = () => {
    const size = getNodeSize(props.id);
    const parentNode = getNodeById(props.data.parentId);
    let oldSize = DEFAULT_CONTENT_NODE_SIZE;
    if (props.data.modelUsed) {
      oldSize = ModelLibrary.getModelByName(props.data.modelUsed)?.type === "image" ? DEFAULT_IMAGE_CONTENT_NODE_SIZE : DEFAULT_CONTENT_NODE_SIZE;
    }
    const newPos = correctChildPositionAfterResize(
      oldSize,
      {
        width: size.width ?? DEFAULT_CONTENT_NODE_SIZE.width,
        height: size.height ?? DEFAULT_CONTENT_NODE_SIZE.height
      }, {
      x: props.positionAbsoluteX,
      y: props.positionAbsoluteY
    }, parentNode?.position);

    if (newPos.x === props.positionAbsoluteX && newPos.y === props.positionAbsoluteY) {
      return;
    }
    updateNodePosition(props.id, newPos);
  };

  function commitTextResponse(text: string, thinking?: string) {
    changeCurrentNodeResponse({
      type: "text",
      text,
      ...(thinking ? { thinking } : {}),
    });

    setLoading(false);
    clearContentResponsePromise(props.id);
    saveFlowInUserStorage(getCurrentState(), getCurrentCanvasId());
  }

  async function parseAndShow(responseResult: any) {
    try {
      console.log("Parsing response...");
      if (isImagesResponse(responseResult)) {
        if (session === null) {
          console.log("Session is null");
          changeCurrentNodeResponse({ path: "", type: "image" });
          setLoading(false);
          return;
        }
        let filename = createFilename();
        const error = await uploadFile(
          responseResult.data[0],
          filename,
          session!.user.id,
          session!.access_token
        );
        if (error !== null) {
          console.log("Error uploading file to user storage, e: ", error);
          setLoading(false);
          return;
        }
        changeCurrentNodeResponse({
          path: `${session.user.id}/${filename}.png`,
          type: "image"
        });
        setLoading(false);
        return;
      }

      if (responseResult?.object === "chat.completion") {
        const responseTextResult: string =
          responseResult?.choices?.[0]?.message?.content || "";
        const reasoning: string =
          responseResult?.choices?.[0]?.message?.reasoning_content || "";

        if (!props.data.areThoughtsShown) {
          commitTextResponse(responseTextResult);
          return;
        }
        const { thinking, answer } = parseResponseText(responseTextResult);
        commitTextResponse(answer, reasoning || thinking);
        return;
      }

      if (responseResult?.object === "response") {
        let textOutput = "";
        if (typeof responseResult.output_text === "string") {
          textOutput = responseResult.output_text;
        } else if (Array.isArray(responseResult.output)) {
          textOutput = responseResult.output
            .map((item: any) => {
              if (!item.content) return "";
              return item.content
                .filter((c: any) => c.type === "output_text" && typeof c.text === "string")
                .map((c: any) => c.text)
                .join("");
            })
            .join("\n");
        }
        commitTextResponse(textOutput);
        return;
      }

      if (typeof responseResult[Symbol.asyncIterator] === "function") {
        let responseText = "";
        setLoading(false);
        for await (const chunk of responseResult) {
          if (
            (chunk as ChatCompletionChunk).choices !== undefined &&
            (chunk as ChatCompletionChunk).choices[0].delta !== undefined &&
            (chunk as ChatCompletionChunk).choices[0].finish_reason === null
          ) {
            responseText += (chunk as ChatCompletionChunk).choices[0].delta
              .content;
          } else if (
            chunk.data !== undefined &&
            chunk.data.choices[0].delta !== undefined &&
            chunk.data.choices[0].finishReason === null
          ) {
            responseText += (chunk.data as ChatCompletionChunk).choices[0].delta
              .content;
          } else if (
            chunk.choices !== undefined &&
            (chunk as Completion).choices[0].text !== undefined
          ) {
            responseText += (chunk as Completion).choices[0].text;
          }
          let lastUpdateTime = 0;
          const interval = 16;
          let pendingUpdate = false;

          const now = performance.now();
          if (!pendingUpdate && now - lastUpdateTime >= interval) {
            pendingUpdate = true;
            const currentResponseText = responseText;
            requestAnimationFrame(() => {
              changeCurrentNodeResponse({ text: currentResponseText, type: "text" });
              lastUpdateTime = now;
              pendingUpdate = false;
            });
          }
        }
        setLoading(false);
        clearContentResponsePromise(props.id);
        saveFlowInUserStorage(getCurrentState(), getCurrentCanvasId());
        return;
      }

      if (responseResult?.text) {
        commitTextResponse(responseResult.text);
        return;
      }
    } catch (err) {
      Sentry.captureException(err);
    }
  }

  const didInitRef = useRef(false);
  useEffect(() => {
    if (!didInitRef.current) {
      didInitRef.current = true;
      const parseResponse = async () => {
        if (props.data.responsePromise === undefined) {
          return;
        }
        if (!(props.data.responsePromise instanceof Promise)) {
          clearContentResponsePromise(props.id);
          return;
        }
        setLoading(true);
        try {
          const responseResult = await props.data.responsePromise;
          parseAndShow(responseResult).then(() => {
            if (props.data.isContained || props.data.MoAContainerId) {
              return;
            }
            setNodeToFocus(props.data.parentId);
          });
        } catch (error: any) {
          enqueueSnackbar(error.toString(), { variant: "error" });
          clearContentResponsePromise(props.id);
          changeCurrentNodeResponse({ text: error.toString(), type: "text" });
        } finally {
          setLoading(false);
        }
      };
      parseResponse();
    }
  }, [props.id]);

  const didAdjustRef = useRef(false);
  useEffect(() => {
    if (!props.data.response || loading) return;
    if (!didAdjustRef.current && !adjusting) {
      didAdjustRef.current = true;
      setAdjusting(true);
      if ((props.data.isContained && props.data.MoAContainerId) || props.data.isImported) {
        return;
      }
      const id = requestAnimationFrame(() => {
        adjustHeight();
        if (!props.data.modelUsed) {
          const newNodeId = createAndConnectPromptNode();
          setNodeToFocus(newNodeId);
          requestAnimationFrame(() => {
            autoViewForRequest(props.data.parentId);
          });
          return;
        }
        const parentNodeData = getNodeData(props.data.parentId);
        if (parentNodeData && isContentNodeData(parentNodeData) &&
          (isAudioResponse(parentNodeData.response) || isPdfResponse(parentNodeData.response) || isImageResponse(parentNodeData.response))) {
          const newNodeId = createAndConnectPromptNode();
          setNodeToFocus(newNodeId);
          requestAnimationFrame(() => {
            autoViewForRequest(props.data.parentId);
          });
          return;
        }
        if (parentNodeData && isPromptNodeData(parentNodeData) && parentNodeData.selectedModels.length > 1) {
          let ready = true;
          getNodeChildren(props.data.parentId).forEach((child) => {
            const data = getNodeData(child);
            if (isContentNodeData(data) && !data.response) {
              ready = false;
            }
          });
          if (ready) {
            const newNodeId = createAndConnectPromptNode(true);
            setNodeToFocus(newNodeId);
            requestAnimationFrame(() => {
              autoViewForRequest(props.data.parentId);
            });
          }
        }
        adjustPosition();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [props.data.response]);

  return (
    <StyledNodeContainer
      className={props.data.isContained ? "nodrag" : undefined + " content-node"}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {!props.data.isContained && (
        <NodeHandles
          isConnecting={isConnecting}
          nodeId={props.id}
          connectionNodeId={connectionNodeId}
        />
      )}
      <StyledNodeCard
        sx={{
          boxSizing: "border-box",
          "&:hover": {
            boxShadow: props.data.isContained ? "none" : " 0px 4px 5px 0px rgba(0, 0, 0, 0.05)",
          },
          ...(props.data.isContained && {
            boxShadow: "none",
          }),
          ...(props.data.isFocused && {
            border: "1px solid",
            borderColor: theme.palette.text.disabled,
          }),
        }}
      >
        {!props.data.isContained && (
          <NodeResizer
            size={{ height: DEFAULT_CONTENT_NODE_HEADER_HEIGHT, width: 232 }}
            keepAspectRatio={!!isImageResponse(props.data.response)}
            style={{ margin: "-5px" }}
          />
        )}
        <Stack sx={{ width: "100%", height: "100%" }}>
          <Stack
            padding={"8px"}
            direction={"row"}
            alignItems={"center"}
            sx={{ position: "relative" }}
          >
            <Stack direction={"row"} alignItems="center" gap={"2px"}>
              <NodeButton icon={SmartButton} toolTipValue={"Create new prompt"} func={() => {
                const newNodeId = createAndConnectPromptNode();
                setNodeToFocus(newNodeId);
              }} />
              <NodeButton icon={LibraryAddOutlined} func={() => duplicateNode(props.id)} toolTipValue={"Duplicate"} />
              <Divider orientation="vertical" variant="middle" flexItem sx={{ height: "24px" }} />
              {!(isAudioResponse(props.data.response) || isPdfResponse(props.data.response)) &&
                <NodeButton icon={ContentCopy} func={handleCopyResponse} toolTipValue={"Copy to buffer"} />
              }
              <NodeButton icon={SaveAlt} func={handleDownloadResponse} toolTipValue={"Download"} />
              {isTextResponse(props.data.response) && props.data.response.thinking && props.data.response.thinking !== "" &&
                <>
                  <Divider orientation="vertical" variant="middle" flexItem sx={{ height: "24px" }} />
                  <ThinkingField initialText={props.data.response.thinking} />
                </>
              }
              {(isAudioResponse(props.data.response) || isPdfResponse(props.data.response) || isImageResponse(props.data.response)) &&
                <>
                  <Divider orientation="vertical" variant="middle" flexItem sx={{ height: "24px", marginRight: "8px" }} />
                  <ContentNodeActionButton
                    nodeId={props.id}
                    contentType={props.data.response.type}
                  />
                </>
              }
            </Stack>
            {props.data.modelUsed && (
              <Box
                sx={{
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  pointerEvents: "none",
                }}
              >
                <ModelUsedTag modelName={props.data.modelUsed} />
              </Box>
            )}
            <Box sx={{ marginLeft: "auto" }}>
              <NodeDeleteButton func={(event) => {
                handleDeleteButtonClick(event);
              }} />
            </Box>
          </Stack>
          <Divider orientation="horizontal" />
          <ResponseField
            nodeId={props.id}
            response={props.data.response}
            loading={loading}
            isRegenerated={props.data.isRegenerated}
            containerNodeId={props.data.MoAContainerId}
            previousAgentResponse={
              props.data.previousAgentResponse
                ? parseResponseText(props.data.previousAgentResponse).answer
                : undefined
            }
            responseRef={textRef}
          />
          {isImageResponse(props.data.response) && props.data.parentId && (
            <Box
              width={"100%"}
              height={"44px"}
              sx={{
                position: "relative",
                display: "block",
                boxSizing: "border-box"
              }}
            >
              <Stack
                height={"44px"}
                width={"100%"}
                direction={"row"}
                justifyContent={"right"}
                padding={"4px 8px 8px 0px"}
                sx={{
                  boxSizing: "border-box"
                }}
              >
                <SystemTextButton
                  type="send"
                  func={() => {
                    handleRegenerate();
                  }}
                  label={<Cached />}
                  isUsed={true}
                />
              </Stack>
            </Box>
          )}
        </Stack>
        {isHovered && !props.data.isContained && (
          <NodeButton
            func={() => {
              const newNodeId = createAndConnectPromptNode();
              setNodeToFocus(newNodeId);
            }}
            icon={ArrowDownward}
            sx={{
              "&::after": {
                content: '""',
                position: "absolute",
                inset: -8,
              },
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%) translateY(-50%)",
              zIndex: 12,
              boxShadow: "0 1px 4px rgba(0,0,0,0.16)",
              transition: "opacity 0.15s ease, transform 0.15s ease",
            }}
          />
        )}
      </StyledNodeCard>
      <DeletePopover
        actionCallback={() => {
          if ((isImageResponse(props.data.response) || isAudioResponse(props.data.response) || isPdfResponse(props.data.response)) && session) {
            deleteFile(session.access_token, props.data.response.path);
          }
          deleteNodeWithEdges(props.id);
          const isContained = props.data.isContained;
          const containerNodeId = props.data.MoAContainerId;
          if (isContained && containerNodeId) {
            updateContainerHeight(containerNodeId, undefined, true);
          }
        }}
        open={deleteNodePopoverOpened}
        anchorEl={deleteAnchorEl}
        setAnchorEl={setDeleteAnchorEl}
        centered={false}
        label={"Delete block?"}
        zoom={zoom}
      />
    </StyledNodeContainer>
  );
}
