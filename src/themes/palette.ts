import { PaletteOptions } from "@mui/material";
import {
  grey,
  amber,
  deepPurple,
  red,
  deepOrange,
  lightBlue,
  lightGreen,
} from "@mui/material/colors";

const palleteOptions: PaletteOptions = {
  primary: {
    light: amber.A100,
    main: amber.A400,
    dark: amber.A700,
    contrastText: "#111111",
  },
  secondary: {
    light: deepPurple[50],
    main: deepPurple.A100,
    dark: deepPurple.A700,
    contrastText: "#fff",
  },
  error: {
    light: red[100],
    main: red[500],
    dark: red[900],
    contrastText: "#fff",
  },
  warning: {
    light: deepOrange.A100,
    main: deepOrange.A400,
    dark: deepOrange.A700,
    contrastText: "#111111",
  },
  info: {
    light: lightBlue.A100,
    main: lightBlue.A400,
    dark: lightBlue.A700,
    contrastText: "#111111",
  },
  success: {
    light: lightGreen[100],
    main: lightGreen[600],
    dark: lightGreen[900],
    contrastText: "#111111",
  },
  text: {
    primary: "#111111",
    secondary: grey[600],
    disabled: grey[400],
  },
  background: {
    default: grey[200],
    paper: "#fff",
  },
  divider: grey[300],
};

export default palleteOptions;
