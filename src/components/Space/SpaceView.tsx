import React, { useContext, useState, memo, useEffect, useMemo } from "react";
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { ViewList, ViewModule, Add, ArrowBack } from "@mui/icons-material";
import { SessionContext } from "../../context/supabaseContext";
import { useSnackbar } from "notistack";

import useFlowStore from "../../logic/flowStore/flowStore";
import useCanvas from "./useCanvas";

import SpaceListView from "./SpaceListView";
import SpaceGridView from "./SpaceGridView";
import SystemIconButton from "../Buttons/SystemIconButton";
import { StyledAppBarStack } from "../../themes/componentStyles";
import { Canvas } from "../../logic/flowStore/interfaces";

/**
 * Main container component for the Space view.
 * Handles view mode switching (grid/list) and canvas creation.
 */
type SpaceViewProps = {
  onBack: () => void;
};

const SpaceView: React.FC<SpaceViewProps> = ({ onBack }) => {
  const session = useContext(SessionContext);
  const { enqueueSnackbar } = useSnackbar();

  const {
    createCanvas,
    deleteCanvas,
    duplicateCanvas,
    exportCanvas,
    openCanvas,
  } = useCanvas();

  const documents = useFlowStore.use.canvases();
  const getCurrentCanvasId = useFlowStore.use.getCurrentCanvasId();

  const sortedDocuments = useMemo(() => {
    return [...documents].sort((a, b) => {
      const dateA = new Date(a.lastEdit).getTime();
      const dateB = new Date(b.lastEdit).getTime();
      return dateB - dateA;
    });
  }, [documents]);

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creatingCanvasId, setCreatingCanvasId] = useState<string | null>(null);
  const [openingCanvasId, setOpeningCanvasId] = useState<string | null>(null);

  useEffect(() => {
    if (creatingCanvasId && getCurrentCanvasId() === creatingCanvasId) {
      const timer = setTimeout(() => {
        setCreatingCanvasId(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [creatingCanvasId, getCurrentCanvasId]);

  const handleViewModeChange = (newMode: "grid" | "list") => {
    if (newMode && newMode !== viewMode) {
      setRenamingId(null);
    }
    if (newMode) {
      setViewMode(newMode);
    }
  };

  const actions = {
    onOpen: async (canvas: Canvas) => {
      try {
        setOpeningCanvasId(canvas.id);
        await openCanvas(canvas);
        onBack();
      } catch (e) {
        console.error(e);
        enqueueSnackbar("Failed to open canvas", { variant: "error" });
      } finally {
        setOpeningCanvasId(null);
      }
    },
    onCreate: async () => {
      try {
        const newCanvas = await createCanvas();
        if (newCanvas) {
          setCreatingCanvasId(newCanvas.id);
          await openCanvas(newCanvas);
        }
        onBack();
      } catch (e) {
        console.error(e);
        enqueueSnackbar("Failed to create canvas", { variant: "error" });
        setCreatingCanvasId(null);
      }
    },
    onDelete: async (canvas: Canvas) => {
      try {
        await deleteCanvas(canvas);
      } catch (e) {
        console.error(e);
        enqueueSnackbar("Failed to delete canvas", { variant: "error" });
      }
    },
    onDuplicate: async (canvas: Canvas) => {
      try {
        await duplicateCanvas(canvas);
      } catch (e) {
        console.error(e);
        enqueueSnackbar("Failed to duplicate canvas", { variant: "error" });
      }
    },
    onExport: async (canvas: Canvas) => {
      try {
        await exportCanvas(canvas);
      } catch (e) {
        console.error(e);
        enqueueSnackbar("Failed to export canvas", { variant: "error" });
      }
    },
  };

  return (
    <Box
      sx={{
        padding: "20px",
        boxSizing: "border-box",
        backgroundColor: "background.default",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        height: "100%",
        width: "100%",
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={"16px"}>
          <StyledAppBarStack
            sx={{ height: 32, width: 32, alignItems: "center", justifyContent: "center", padding: "3px" }}>
            <SystemIconButton func={onBack} icon={ArrowBack} />
          </StyledAppBarStack>
          <Typography variant="body1">
            Space
          </Typography>
        </Stack>

        <Stack direction="row" alignItems="center" gap={"12px"}>
          <StyledAppBarStack sx={{ height: 32, padding: "5px 3px" }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={viewMode}
              onChange={(_, next) => handleViewModeChange(next)}
              sx={{
                backgroundColor: "background.paper",
                borderRadius: 1,
                "& .MuiToggleButton-root": { border: "none", mx: 0.25, borderRadius: 1 },
                "& .Mui-selected": {
                  backgroundColor: "primary.main",
                  color: "primary.contrastText",
                },
                height: "22px",
              }}
            >
              <ToggleButton value="list">
                <ViewList fontSize="small" />
              </ToggleButton>
              <ToggleButton value="grid">
                <ViewModule fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </StyledAppBarStack>

          <StyledAppBarStack
            sx={{ height: 32, width: 32, padding: "3px", alignItems: "center", justifyContent: "center" }}>
            <SystemIconButton
              func={actions.onCreate}
              icon={Add}
              toolTipValue="Create new canvas"
              tooltipPlacement="bottom"
              disabled={!session}
              isLoading={creatingCanvasId !== null}
            />
          </StyledAppBarStack>
        </Stack>
      </Stack>

      <Box
        sx={{
          flex: 1,
          overflow: "auto",
          borderRadius: "16px",
          backgroundColor: "background.paper",
          padding: "12px",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(0, 0, 0, 0.2) transparent",
        }}
      >
        {sortedDocuments.length === 0 ? (
          <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }} spacing={1}>
            <Typography variant="body2" color="text.secondary">No canvases yet.</Typography>
            <Typography variant="body2" color="text.secondary">Create your first canvas to get started.</Typography>
          </Stack>
        ) : (
          <>
            {viewMode === "list" ? (
              <SpaceListView
                canvases={sortedDocuments}
                currentCanvas={getCurrentCanvasId}
                renamingId={renamingId}
                setRenamingId={setRenamingId}
                actions={actions}
                creatingCanvasId={creatingCanvasId}
                openingCanvasId={openingCanvasId}
              />
            ) : (
              <SpaceGridView
                canvases={sortedDocuments}
                currentCanvas={getCurrentCanvasId}
                renamingId={renamingId}
                setRenamingId={setRenamingId}
                actions={actions}
                creatingCanvasId={creatingCanvasId}
                openingCanvasId={openingCanvasId}
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
};

export default memo(SpaceView);