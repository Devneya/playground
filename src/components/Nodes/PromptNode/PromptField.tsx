import {Send} from "@mui/icons-material";
import {Box, Stack} from "@mui/material";
import {NodeProps} from "@xyflow/react";
import useFlowStore from "../../../logic/flowStore/flowStore";
import theme from "../../../themes";
import SystemTextButton from "../../Buttons/SystemTextButton";
import React from "react";
import {PromptNode} from "../../../logic/flowStore/interfaces";

export const PromptField = (
  props: NodeProps<PromptNode> & {
    makeRequest: () => void;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  }
) => {
  const changeNodePrompt = useFlowStore.use.changeNodePrompt();
  return (
    <Box
      padding={"4px"}
      width={"100%"}
      height={"100%"}
      sx={{position: "relative", display: "flex", flexDirection: "column"}}
    >
      <Box sx={{flex: "1 1 auto", minHeight: 0, display: "flex"}}>
        <textarea
          className={"styled-scrollbars nodrag nowheel"}
          value={props.data.prompt}
          ref={props.textareaRef}
          readOnly={props.data.isExecuted}
          onChange={(
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
          ) => {
            changeNodePrompt(props.id, event.target.value);
          }}
          placeholder={"Type anything, for example: write story about a cat"}
          style={{
            overflow: "auto",
            resize: "none",
            width: "100%",
            height: "100%",
            border: "none",
            boxSizing: "border-box",
            padding: "12px",
            borderRadius: "20px",
            ...theme.typography.body1,
            background: "inherit",
          }}
          onKeyDown={(
            event: React.KeyboardEvent<HTMLTextAreaElement>
          ): void => {
            if (event.key.toLowerCase() === "enter" && !event.shiftKey) {
              event.preventDefault();
              event.stopPropagation();
              props.makeRequest();
            }
          }}
        />
      </Box>
      <Stack
        height={"34px"}
        width={"100%"}
        direction={"row"}
        justifyContent={"right"}
        padding={"0px 4px 4px 0px"}
      >
        {!props.data.isExecuted && (
          <SystemTextButton
            type="send"
            func={props.makeRequest}
            label={<Send/>}
            isUsed={false}
            data={props.data.prompt}
          />
        )}
      </Stack>
    </Box>
  );
};
