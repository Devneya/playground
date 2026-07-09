import {LibraryAddOutlined} from "@mui/icons-material";
import {Stack} from "@mui/material";
import {NodeProps} from "@xyflow/react";
import useFlowStore from "../../../logic/flowStore/flowStore";
import {ModelLibrary, ModelType} from "../../../logic/models/modelLibrary";
import ModelSelectMenu from "./ModelSelectMenu";
import usePromptNode from "./usePromptNode";
import NodeButton from "../../Buttons/NodeButton";
import NodeDeleteButton from "../../Buttons/NodeDeleteButton";
import RoleButton from "../ContainerNode/RoleButton";
import {PromptNode} from "../../../logic/flowStore/interfaces";

import {createSvgIcon} from "@mui/material/utils";
import theme from "../../../themes";

export const OpenWithIcon = createSvgIcon(
  <text
    x="12"
    y="75%"
    dominantBaseline="middle"
    textAnchor="middle"
    fontSize="24"
    className="material-icons-outlined"
  >
    open_with
  </text>,
  "OpenWith"
);

type ModelHeaderProps = NodeProps<PromptNode> & {
  handleDeleteButtonClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  activeType: ModelType;
  onTypeChange: (type: ModelType) => void;
};

/**
 * ModelHeader component
 * Displays the header of a prompt node with controls.
 */
export const ModelHeader = function (props: ModelHeaderProps) {
  const openModelParamsMenu = useFlowStore.use.openModelParamsMenu();
  const setSelectedModel = useFlowStore.use.setSelectedModel();
  const togglePromptModelsMode = useFlowStore.use.togglePromptModelsMode();

  const selectedModel = useFlowStore.use.selectedModel();
  const {duplicateNode} = usePromptNode();

  const firstType = props.data.selectedModels?.[0]?.type;
  const models = firstType ? ModelLibrary.getModelsByType(firstType) : [];

  const openParamsMenu = () => {
    const firstModel = props.data.selectedModels?.[0];
    if (!firstModel) return;

    let model = models.find((m) => {
      return m.name === firstModel.name
    });
    if (!model) return;
    if (!props.data.isExecuted && selectedModel === undefined) return;
    if (props.data.isExecuted) setSelectedModel(model);
    openModelParamsMenu(props.id);
  };

  const isRoleButtonShown =
    props.data.isContained &&
    !!props.data.MoAContainerId &&
    props.data.interactionMode?.toLowerCase() === "sequential";

  const isMultiModel = (props.data.selectedModels?.length ?? 0) > 1;

  return (
    <Stack
      direction="row"
      justifyContent={"space-between"}
      alignItems={"center"}
      padding={"8px"}
    >
      <Stack display="flex" direction="row" gap="6px" alignItems={"center"}
             justifyContent={props.data.isContained ? "flex-start" : "flex-end"} flexGrow={1}>
        {!props.data.isAggregateNode && (
          <ModelSelectMenu
            recentModelsList={props.data.recentModelsList}
            nodeId={props.id}
            openModelParamsMenu={openModelParamsMenu}
            openParamsMenu={openParamsMenu}
            selectedModels={props.data.selectedModels ?? []}
            activeType={props.activeType}
            onTypeChange={props.onTypeChange}
          />
        )}
        {props.data.isExecuted && !props.data.isContained && (
          <NodeButton
            icon={LibraryAddOutlined}
            func={() => duplicateNode(props.id)}
            toolTipValue={"Duplicate"}
          />
        )}
        {!props.data.isContained && !props.data.MoAContainerId && !props.data.isExecuted && (
          <NodeButton
            icon={OpenWithIcon}
            func={() => togglePromptModelsMode(props.id)}
            toolTipValue={
              isMultiModel
                ? "Switch to single model request"
                : "Switch to 4 models request"
            }
            color={isMultiModel ? "secondary" : undefined}
            bgcolor={isMultiModel ? theme.palette.text.secondary : undefined}
          />
        )}
        {!props.data.isContained && (
          <NodeDeleteButton func={props.handleDeleteButtonClick}/>
        )}
      </Stack>

      {props.data.isContained &&
        <Stack direction="row" alignItems="center" gap={"6px"}>
          {isRoleButtonShown && (
            <RoleButton nodeId={props.id} selectedRole={props.data.role}/>
          )}
          <NodeDeleteButton func={props.handleDeleteButtonClick}/>
        </Stack>
      }
    </Stack>
  );
};
