import {Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack} from "@mui/material";
import React, {memo, useState} from "react";
import {Close} from "@mui/icons-material";
import NodeDeleteButton from "../../../Buttons/NodeDeleteButton";
import EmojiObjectsIcon from "@mui/icons-material/EmojiObjects";
import NodeButton from "../../../Buttons/NodeButton";

type ThinkingFieldProps = {
  initialText: string | undefined;
};

const ThinkingField = (props: ThinkingFieldProps) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return props.initialText ? (
    <Box zIndex={4} overflow="hidden">
      <NodeButton
        icon={EmojiObjectsIcon}
        func={() => setIsDialogOpen(true)}
        toolTipValue="Show thoughts"
        color={"secondary"}
        sx={{padding: "4px"}}
        iconSize="medium"
      />
      <Dialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        fullWidth
        maxWidth="md"
        PaperProps={{
          sx: {
            borderRadius: "16px",
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
          }
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{padding: "16px 16px 0px 16px"}}
        >
          <DialogTitle sx={{padding: "0px"}}>
            Thinking process
          </DialogTitle>
          <NodeDeleteButton func={() => setIsDialogOpen(false)} toClose={true}/>
        </Stack>
        <DialogContent
          sx={{
            padding: "16px",
            overflow: "auto",
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {props.initialText}
          </Box>
        </DialogContent>
        <DialogActions sx={{padding: "0px 16px 16px 16px", justifyContent: "center"}}>
          <Button
            endIcon={<Close/>}
            onClick={() => setIsDialogOpen(false)}
            variant="contained"
            sx={{height: "32px", borderRadius: "16px"}}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  ) : null;
}

export default memo(ThinkingField);