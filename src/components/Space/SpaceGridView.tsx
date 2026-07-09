import React, {useState, useEffect, useRef, memo} from "react";
import {Box, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography, alpha, useTheme} from "@mui/material";
import {
  NoteOutlined,
  DriveFileRenameOutline,
  LibraryAddOutlined,
  DownloadOutlined,
  DeleteOutline,
  MoreVert,
} from "@mui/icons-material";
import {StyledAppBarStack} from "../../themes/componentStyles";
import {Canvas} from "../../logic/flowStore/interfaces";
import {formatCanvasDate} from "../../logic/utils";
import CanvasActionButton from "./CanvasActionButton";
import useCanvas from "./useCanvas";

/**
 * Grid view of Space displaying canvases as cards with screenshots.
 * Supports renaming, duplication, export, deletion, and opening canvases.
 */
type SpaceGridViewProps = {
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

const SpaceGridView: React.FC<SpaceGridViewProps> = ({
                                                       canvases,
                                                       currentCanvas,
                                                       renamingId,
                                                       setRenamingId,
                                                       actions,
                                                       creatingCanvasId = null,
                                                       openingCanvasId = null
                                                     }) => {
  const theme = useTheme();
  const [menuOpenMap, setMenuOpenMap] = useState<Record<string, boolean>>({});
  const [localNamesMap, setLocalNamesMap] = useState<Record<string, string>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, "delete" | "rename" | "duplicate" | "export" | null>>({});
  const menuRefs = useRef<Record<string, HTMLElement | null>>({});
  const buttonRefs = useRef<Record<string, HTMLElement | null>>({});
  const {renameCanvas} = useCanvas();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      Object.keys(menuOpenMap).forEach((canvasId) => {
        if (menuOpenMap[canvasId]) {
          const menuElement = menuRefs.current[canvasId];
          const buttonElement = buttonRefs.current[canvasId];

          if (
            menuElement &&
            buttonElement &&
            !menuElement.contains(target) &&
            !buttonElement.contains(target)
          ) {
            setMenuOpenMap((prev) => ({
              ...prev,
              [canvasId]: false,
            }));
          }
        }
      });
    };

    const hasOpenMenus = Object.values(menuOpenMap).some(Boolean);
    if (hasOpenMenus) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [menuOpenMap]);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: "16px",
      }}
    >
      {canvases.map((canvas) => {
        const isRenaming = renamingId === canvas.id;
        const menuOpen = menuOpenMap[canvas.id] || false;
        const localName = localNamesMap[canvas.id] ?? canvas.name;
        const isLoading = loadingMap[canvas.id] || null;
        const isActive = currentCanvas() === canvas.id;
        const isDeleting = isLoading === "delete";
        const isCreating = creatingCanvasId === canvas.id;
        const isOpening = openingCanvasId === canvas.id;

        const screenshotUrl = canvas.screenshotBase64
          ? `data:image/png;base64,${canvas.screenshotBase64}`
          : null;

        return (
          <Box
            key={canvas.id}
            onClick={() => {
              if (!isRenaming) {
                actions.onOpen(canvas);
              }
            }}
            sx={{
              position: "relative",
              borderRadius: "12px",
              overflow: "visible",
              backgroundColor: "background.paper",
              border: isActive
                ? `1px solid ${theme.palette.text.disabled}`
                : `1px solid ${theme.palette.background.default}`,
              pointerEvents: "auto",
              isolation: "isolate",
              cursor: isRenaming ? "default" : "pointer",
              "&:hover": {
                boxShadow: "0 1px 4px 1px rgba(0, 0, 0, 0.08)",
              },
            }}
          >
            <Box
              sx={{
                position: "absolute",
                bottom: "8px",
                right: "12px",
                zIndex: 30,
                pointerEvents: "auto",
              }}
            >
              <Tooltip
                title="Actions"
                placement="top"
                arrow
                disableInteractive
              >
                <IconButton
                  ref={(el) => {
                    buttonRefs.current[canvas.id] = el;
                  }}
                  size="small"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpenMap((prev) => {
                      const isCurrentlyOpen = prev[canvas.id];
                      if (!isCurrentlyOpen) {
                        const newMap: Record<string, boolean> = {};
                        canvases.forEach((d) => {
                          newMap[d.id] = false;
                        });
                        newMap[canvas.id] = true;
                        return newMap;
                      } else {
                        return {
                          ...prev,
                          [canvas.id]: false,
                        };
                      }
                    });
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  disableRipple
                  disableFocusRipple
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: 1,
                    cursor: "pointer",
                    backgroundColor: "transparent",
                    color: "text.primary",
                    "&:hover": {
                      backgroundColor: "background.default",
                    },
                  }}
                >
                  <MoreVert fontSize="small"/>
                </IconButton>
              </Tooltip>
            </Box>
            <Box
              sx={{
                aspectRatio: "1.41 / 1",
                backgroundColor: "background.default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                borderRadius: "12px 12px 0 0",
                position: "relative",
                zIndex: 1,
              }}
            >
              {isCreating ? (
                <CircularProgress size={32} sx={{color: "text.secondary"}}/>
              ) : screenshotUrl ? (
                <>
                  <Box
                    component="img"
                    src={screenshotUrl}
                    alt={canvas.name}
                    sx={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      pointerEvents: "none",
                      backgroundColor: "background.default",
                    }}
                  />
                  {isOpening && (
                    <Box
                      sx={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: alpha(theme.palette.background.paper, 0.4),
                        zIndex: 10,
                      }}
                    >
                      <CircularProgress size={32} sx={{color: "text.secondary"}}/>
                    </Box>
                  )}
                </>
              ) : (
                <Box
                  sx={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <NoteOutlined
                    sx={{
                      color: "grey.400",
                      fontSize: 48,
                      pointerEvents: "none",
                    }}
                  />
                  {isOpening && (
                    <Box
                      sx={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: alpha(theme.palette.background.paper, 0.7),
                        zIndex: 10,
                      }}
                    >
                      <CircularProgress size={32} sx={{color: "text.secondary"}}/>
                    </Box>
                  )}
                </Box>
              )}
            </Box>

            <Box
              sx={{
                padding: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                position: "relative",
                zIndex: 2,
              }}
              onClick={(e) => {
                if (isRenaming) {
                  e.stopPropagation();
                }
              }}
            >
              <Stack sx={{flex: 1, minWidth: 0}} spacing={0}>
                {isRenaming ? (
                  <Box sx={{height: "20px", display: "flex", alignItems: "center", minWidth: 0, flexShrink: 0}}>
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
                          } else {
                            setLocalNamesMap((prev) => {
                              const next = {...prev};
                              delete next[canvas.id];
                              return next;
                            });
                          }
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
                        maxWidth: "calc(100% - 44px)",
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
                ) : (
                  <Typography variant="body2" noWrap
                              sx={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: "calc(100% - 44px)",
                                minWidth: "120px",
                              }}
                  >
                    {canvas.name}
                  </Typography>
                )}
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={isRenaming ? {paddingTop: "4px"} : {}}
                >
                  Modified on {formatCanvasDate(canvas.lastEdit)}
                </Typography>
              </Stack>
            </Box>

            {menuOpen && (
              <Box
                ref={(el) => {
                  menuRefs.current[canvas.id] = el as HTMLElement | null;
                }}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                sx={{
                  position: "absolute",
                  bottom: "66px",
                  right: "8px",
                  zIndex: 40,
                  pointerEvents: "auto",
                }}
              >
                <StyledAppBarStack
                  direction="column"
                  sx={{
                    pointerEvents: "auto",
                  }}
                >
                  <CanvasActionButton
                    icon={DriveFileRenameOutline}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenMap((prev) => ({
                        ...prev,
                        [canvas.id]: false,
                      }));
                      setRenamingId(canvas.id);
                      setLocalNamesMap((prev) => ({
                        ...prev,
                        [canvas.id]: canvas.name,
                      }));
                    }}
                    tooltipValue="Rename"
                    tooltipPlacement="left"
                    disabled={isLoading !== null || isDeleting || isCreating}
                  />
                  <CanvasActionButton
                    icon={LibraryAddOutlined}
                    onClick={async () => {
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
                    tooltipPlacement="left"
                    isLoading={isLoading === "duplicate"}
                    disabled={isLoading !== null || isDeleting || isCreating}
                  />
                  <CanvasActionButton
                    icon={DownloadOutlined}
                    onClick={async () => {
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
                    tooltipPlacement="left"
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
                    tooltipValue="Delete"
                    tooltipPlacement="left"
                    color="error"
                    isLoading={isLoading === "delete"}
                    disabled={isLoading !== null || isDeleting || isCreating}
                  />
                </StyledAppBarStack>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export default memo(SpaceGridView);
