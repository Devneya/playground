import { createTheme } from "@mui/material";
import paletteOptions from "./palette";
import typographyOptions from "./typography";

const theme = createTheme({
  palette: paletteOptions,
  typography: typographyOptions,
});

export default theme;
