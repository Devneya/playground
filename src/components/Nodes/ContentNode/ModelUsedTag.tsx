import {Typography} from "@mui/material";
import {ModelLibrary} from "../../../logic/models/modelLibrary";
import {StyledButton} from "../../../themes/componentStyles";
import ImportedIcon from "../../ImportedIcon";
import {memo} from "react";

export const ModelUsedTag = memo(({modelName}: { modelName: string }) => {
  const model = ModelLibrary.getModelByName(modelName);
  const icon = model?.provider?.logoBig;

  return (
    <StyledButton
      disabled
      startIcon={
        icon ? (
          <ImportedIcon Icon={icon} width="20px"/>
        ) : undefined
      }
      sx={{
        color: "text.primary",
        backgroundColor: "transparent",
        padding: "2px 6px",
        height: "28px",
        cursor: "default",
        "&:hover": {
          backgroundColor: "transparent",
        },
        "& .MuiButton-startIcon": {
          marginRight: "6px",
        },
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontSize: "0.8rem",
          textTransform: "none",
          fontWeight: 500,
          color: "text.primary",
        }}
      >
        {model?.name || modelName}
      </Typography>
    </StyledButton>
  );
});