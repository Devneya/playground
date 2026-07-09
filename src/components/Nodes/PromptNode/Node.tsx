import { Divider, Stack } from "@mui/material";
import { useRef, useState, useEffect } from "react";
import {
  NodeProps,
} from "@xyflow/react";
import {
  type PromptNode as PromptNodeType,
} from "../../../logic/flowStore/interfaces";
import useFlowStore from "../../../logic/flowStore/flowStore";
import usePromptNode from "./usePromptNode";
import {
  DEFAULT_CONTENT_NODE_HEADER_HEIGHT,
} from "../../../config/nodeSize";

import DeletePopover from "../../DeletePopover";
import { ModelHeader } from "./ModelHeader";
import { PromptField } from "./PromptField";
import { StyledNodeCard, StyledNodeContainer } from "../../../themes/componentStyles";
import { NodeHandles } from "../NodeControls/NodeHandles";
import { NodeResizer } from "../NodeControls/NodeResizer";
import theme from "../../../themes";
import useViewport from "../../../logic/useViewport";

export default function PromptNode(props: NodeProps<PromptNodeType>) {
  // node states
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [deleteAnchorEl, setDeleteAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [activeType, setActiveType] = useState(props.data.selectedModels?.[0]?.type ?? "text");
  const { getViewport } = useViewport();
  const { zoom } = getViewport();

  //store methods
  const connectionNodeId = useFlowStore.use.connectionNodeId();
  const deleteNodeWithEdges = useFlowStore.use.deleteNodeWithEdges();
  const updateContainerHeight = useFlowStore.use.updateContainerHeight();
  const deleteNodesFromContainer = useFlowStore.use.deleteNodesFromContainer();
  const deleteProposerWithContent = useFlowStore.use.deleteProposerWithContent();

  // other constants
  const isConnecting = !!connectionNodeId;
  const deleteNodePopoverOpened = Boolean(deleteAnchorEl);

  // Node methods
  const { triggerPromptRequest, autoViewForRequest } = usePromptNode();

  useEffect(() => {
    if (props.data.isFocused && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(0, 0);
    }
  }, [props.data.isFocused]);

  const handleDeleteButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setDeleteAnchorEl(deleteAnchorEl ? null : event.currentTarget);
  };

  useEffect(() => {
    if (props.data.selectedModels && props.data.selectedModels?.length > 0) {
      setActiveType(props.data.selectedModels[0]?.type ?? "text");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (props.data.isContained) {
    return (
      <StyledNodeContainer className={"nodrag"} zIndex={3}>
        <StyledNodeCard>
          <Stack
            sx={{
              width: "100%",
              height: "100%",
              overflow: "visible",
            }}
            divider={<Divider orientation="horizontal" />}
          >
            <ModelHeader
              {...props}
              handleDeleteButtonClick={handleDeleteButtonClick}
              activeType={activeType}
              onTypeChange={setActiveType}
            />
          </Stack>
        </StyledNodeCard>
        <DeletePopover
          actionCallback={() => {
            const isContained = props.data.isContained;
            const containerNodeId = props.data.MoAContainerId;
            deleteProposerWithContent(props.id);
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
    )
  }

  return (
    <StyledNodeContainer className="prompt-node">
      <NodeResizer size={{ height: DEFAULT_CONTENT_NODE_HEADER_HEIGHT, width: 232 }} />
      <NodeHandles isConnecting={isConnecting} nodeId={props.id} connectionNodeId={connectionNodeId} />
      <StyledNodeCard
        sx={{
          "&:hover": { boxShadow: " 0px 4px 5px 0px rgba(0, 0, 0, 0.05)" },
          ...(props.data.isFocused && {
            border: "1px solid",
            borderColor: theme.palette.text.disabled,
          })
        }}
      >
        <Stack
          sx={{
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
          divider={<Divider orientation="horizontal" />}
        >
          <ModelHeader
            {...props}
            handleDeleteButtonClick={handleDeleteButtonClick}
            activeType={activeType}
            onTypeChange={setActiveType} />
          <PromptField
            textareaRef={textareaRef}
            {...props}
            makeRequest={() => {
              triggerPromptRequest(props.id);
              autoViewForRequest(props.id);
            }}
          />
        </Stack>
      </StyledNodeCard>
      <DeletePopover
        actionCallback={() => {
          const containerNodeId = props.data.MoAContainerId;
          if (containerNodeId) {
            deleteNodesFromContainer(containerNodeId);
            deleteNodeWithEdges(containerNodeId);
          }
          deleteNodeWithEdges(props.id);
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
