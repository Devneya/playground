import React, {useState, memo} from "react";
import {
  Box,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import {
  NoteOutlined,
  DriveFileRenameOutline,
  LibraryAddOutlined,
  DownloadOutlined,
  DeleteOutline
} from "@mui/icons-material";
import {Canvas} from "../../logic/flowStore/interfaces";
import CanvasActionButton from "./CanvasActionButton";
import useCanvas from "./useCanvas";
import {formatCanvasDate} from "../../logic/utils";

/**
 * List view of Space displaying canvases as a vertical list with inline actions.
 * Supports renaming, duplication, export, deletion, and opening canvases.
 */
type CanvasListViewProps = {
  canvases: Canvas[];
  currentCanvas: () => (string | undefined);
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  actions: {
    onOpen: (c: Canvas) => void;
    onDuplicate: (c: Canvas) => void;
    onExport: (c: Canvas) => void;
    onDelete: (c: Canvas) => void;
  };
  creatingCanvasId?: string | null;
  openingCanvasId?: string | null;
};

const SpaceListView: React.FC<CanvasListViewProps> = ({
                                                        canvases,
                                                        currentCanvas,
                                                        renamingId,
                                                        setRenamingId,
                                                        actions,
                                                        creatingCanvasId = null,
                                                        openingCanvasId = null,
                                                      }) => {
  const {renameCanvas} = useCanvas();

  const [loadingMap, setLoadingMap] = useState<Record<string, "delete" | "rename" | "duplicate" | "export" | null>>({});
  const [localNamesMap, setLocalNamesMap] = useState<Record<string, string>>({});

  return (
    <List disablePadding>
      {canvases.map(canvas => {
        const isRenaming = renamingId === canvas.id;
        const isActive = currentCanvas() === canvas.id;
        const isLoading = loadingMap[canvas.id] || null;
        const isDeleting = isLoading === "delete";
        const isCreating = creatingCanvasId === canvas.id;
        const isOpening = openingCanvasId === canvas.id;
        const localName = localNamesMap[canvas.id] ?? canvas.name;

        return (
          <ListItem key={canvas.id} disablePadding sx={{mb: 1}}>
            <ListItemButton onClick={() => actions.onOpen(canvas)} sx={{
              px: 1,
              py: 1,
              height: 48,
              borderRadius: 1,
              backgroundColor: isActive ? "action.hover" : "transparent",
              display: "flex",
              overflow: "hidden"
            }}>
              <ListItemIcon sx={{width: 36, minWidth: 36}}>
                {isCreating || isOpening ? (
                  <CircularProgress size={20} sx={{color: "text.secondary"}}/>
                ) : (
                  <NoteOutlined sx={{color: "text.primary", marginRight: 0}}/>
                )}
              </ListItemIcon>

              {isRenaming ? (
                <Stack direction="column" sx={{flex: 1, minWidth: 0}} spacing={0}>
                  <Box sx={{height: "20px", display: "flex", alignItems: "center", flex: 1, minWidth: 0}}>
                    <TextField
                      size="small"
                      variant="outlined"
                      value={localName}
                      autoFocus
                      onChange={(e) => {
                        setLocalNamesMap((prev) => ({
                          ...prev,
                          [canvas.id]: e.target.value,
                        }));
                      }}
                      onBlur={async () => {
                        setRenamingId(null);
                        setLocalNamesMap((prev) => {
                          const next = {...prev};
                          delete next[canvas.id];
                          return next;
                        });
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") {
                          setRenamingId(null);
                          const trimmed = localName.trim();
                          if (trimmed && trimmed !== canvas.name) {
                            setLoadingMap((prev) => ({...prev, [canvas.id]: "rename"}));
                            try {
                              await renameCanvas(canvas, trimmed);
                            } catch (e) {
                              console.error(e);
                            } finally {
                              setLoadingMap((prev) => {
                                const next = {...prev};
                                delete next[canvas.id];
                                return next;
                              });
                            }
                          }
                          setLocalNamesMap((prev) => {
                            const next = {...prev};
                            delete next[canvas.id];
                            return next;
                          });
                        }
                        if (e.key === "Escape") {
                          setRenamingId(null);
                          setLocalNamesMap((prev) => {
                            const next = {...prev};
                            delete next[canvas.id];
                            return next;
                          });
                        }
                      }}
                      sx={{
                        flex: 1,
                        minWidth: "120px",
                        "& .MuiOutlinedInput-root": {
                          padding: "2px",
                          fontSize: "0.875rem",
                          height: "20px",
                          "& fieldset": {
                            borderColor: "text.disabled",
                            borderWidth: "1px",
                          },
                          "&:hover fieldset": {
                            borderColor: "text.disabled",
                          },
                          "&.Mui-focused fieldset": {
                            borderColor: "text.disabled",
                          },
                        },
                        "& .MuiInputBase-input": {
                          padding: "2px",
                          height: "20px",
                          lineHeight: "16px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        },
                      }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Modified on {formatCanvasDate(canvas.lastEdit)}
                  </Typography>
                </Stack>
              ) : (
                <Stack direction="column" sx={{flex: 1, minWidth: 0, overflow: "hidden"}}>
                  <Typography
                    variant="body2" noWrap
                    sx={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                      color: "text.primary"
                    }}
                  >
                    {canvas.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Modified on {formatCanvasDate(canvas.lastEdit)}
                  </Typography>
                </Stack>
              )}

              <Stack direction="row" gap={0.5} alignItems="center" sx={{flexShrink: 0}}>
                <CanvasActionButton
                  icon={DriveFileRenameOutline}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(canvas.id);
                    setLocalNamesMap((prev) => ({
                      ...prev,
                      [canvas.id]: canvas.name,
                    }));
                  }}
                  tooltipValue="Rename"
                  tooltipPlacement="top"
                  disabled={isLoading !== null || isDeleting || isCreating}
                />
                <CanvasActionButton
                  icon={LibraryAddOutlined}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setLoadingMap((prev) => ({...prev, [canvas.id]: "duplicate"}));
                    try {
                      await actions.onDuplicate(canvas);
                    } finally {
                      setLoadingMap((prev) => {
                        const next = {...prev};
                        delete next[canvas.id];
                        return next;
                      });
                    }
                  }}
                  tooltipValue="Duplicate"
                  tooltipPlacement="top"
                  isLoading={isLoading === "duplicate"}
                  disabled={isLoading !== null || isDeleting || isCreating}
                />
                <CanvasActionButton
                  icon={DownloadOutlined}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setLoadingMap((prev) => ({...prev, [canvas.id]: "export"}));
                    try {
                      await actions.onExport(canvas);
                    } finally {
                      setLoadingMap((prev) => {
                        const next = {...prev};
                        delete next[canvas.id];
                        return next;
                      });
                    }
                  }}
                  tooltipValue="Export flow"
                  tooltipPlacement="top"
                  isLoading={isLoading === "export"}
                  disabled={isLoading !== null || isDeleting || isCreating}
                />
                <CanvasActionButton
                  icon={DeleteOutline}
                  onClick={async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setLoadingMap((prev) => ({...prev, [canvas.id]: "delete"}));
                    try {
                      await actions.onDelete(canvas);
                    } catch (error) {
                      console.error("Error deleting canvas:", error);
                    } finally {
                      setLoadingMap((prev) => {
                        const next = {...prev};
                        delete next[canvas.id];
                        return next;
                      });
                    }
                  }}
                  tooltipValue="Delete canvas"
                  tooltipPlacement="top"
                  color="error"
                  isLoading={isLoading === "delete"}
                  disabled={isLoading !== null || isDeleting || isCreating}
                />
              </Stack>
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
};

export default memo(SpaceListView);
