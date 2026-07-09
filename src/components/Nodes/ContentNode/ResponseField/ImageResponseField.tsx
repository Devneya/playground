import {Box, Skeleton} from "@mui/material";
import React, {useEffect, useState} from "react";
import {downloadFile} from "../../../../storage";

interface imageResponseFieldProps {
  path: string;
}

export default function ImageResponseField({path}: imageResponseFieldProps) {
  const [url, setUrl] = useState<null | string>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    const loadImage = async () => {
      try {
        const resp = await downloadFile(path);
        if (resp instanceof Error) {
          console.log("Error loading file:" + resp.message);
          return;
        }
        objectUrl = URL.createObjectURL(resp);
        setUrl(objectUrl);
      } catch (err) {
        console.log(err);
      }
    };
    loadImage();
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path]);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
        boxSizing: "border-box",
        display: "flex",
        backgroundColor: "transparent",
      }}
      padding="0px 4px 0px 4px"
    >
      {url ? (
        <img
          src={url}
          alt=""
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            margin: "0px",
            display: "block",
          }}
        />
      ) : (
        <Skeleton variant="rectangular" width={"99%"} height={"99%"}/>
      )}
    </Box>
  );
}
