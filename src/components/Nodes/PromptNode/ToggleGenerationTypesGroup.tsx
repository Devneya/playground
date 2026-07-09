import {
  ModelConfiguration,
  ModelType,
  ModelTypeList,
} from "../../../logic/models/modelLibrary";
import {Stack} from "@mui/material";
import useFlowStore from "../../../logic/flowStore/flowStore";
import {ActiveChip, BaseChip, ExecutedChip, InactiveChip} from "../../../themes/componentStyles";
import {isPromptNodeData} from "../../../logic/flowStore/interfaces";
import {memo} from "react";

type ToggleGenerationTypesGroupProps = {
  isExecuted: boolean;
  nodeId: string;
  models: ModelConfiguration[];
  isContained?: boolean;
  activeType: ModelType;
  onTypeChange: (type: ModelType) => void;
  isFromNode?: boolean;
};

/**
 * ToggleGenerationTypesGroup component
 * Provides interactive chips for switching between different model types.
 */
function ToggleGenerationTypesGroup(props: ToggleGenerationTypesGroupProps) {
  const getNodeData = useFlowStore.use.getNodeData();

  const promptNodeData = getNodeData(props.nodeId);
  if (!promptNodeData || !isPromptNodeData(promptNodeData)) return;

  const handleTypeClick = (type: ModelType) => {
    props.onTypeChange(type);
  };

  const renderChip = (type: ModelType, index: number) => {
    const isActive = props.activeType === type;
    if (props.isExecuted) {
      return <ExecutedChip key={`${type}-${index}`} label={type}/>;
    }
    const Result = isActive ? ActiveChip : InactiveChip;
    return <Result key={type} label={type} onClick={() => handleTypeClick(type)}/>;
  };

  if (props.isContained || promptNodeData.isContained) {
    return <Stack className="nodrag" direction="row">{renderChip(ModelTypeList[0], 0)}</Stack>;
  }

  if (props.isExecuted) {
    return <Stack className="nodrag" direction="row">{props.models.map((m, i) => renderChip(m.type, i))}</Stack>;
  }

  return (
    <Stack className="nodrag" direction="row" gap={"6px"}>
      {ModelTypeList.map(renderChip)}
      {["Audio", "Video"].map((label) => <BaseChip key={label} label={label} disabled/>)}
    </Stack>
  );
}

export default memo(ToggleGenerationTypesGroup);
