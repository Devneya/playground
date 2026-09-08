import type { SVGProps } from "react";

export type CardIconName = "branch" | "send" | "close" | "grip" | "history" | "note" | "message" | "undo" | "redo" | "library" | "download" | "upload" | "trash";

type CardIconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: CardIconName;
  size?: number;
};

/** Small, stroke-based glyphs shared by the compact spatial cards. */
export const CardIcon = ({ name, size = 14, ...props }: CardIconProps) => {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  return <svg
    {...props}
    aria-hidden="true"
    focusable="false"
    height={size}
    viewBox="0 0 24 24"
    width={size}
  >
    {name === "branch" && <>
      <path {...common} d="M6 4v8a4 4 0 0 0 4 4h8" />
      <path {...common} d="M14 4h2a4 4 0 0 1 4 4v1" />
      <path {...common} d="m15 13 3 3-3 3" />
    </>}
    {name === "send" && <path {...common} d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14" />}
    {name === "close" && <path {...common} d="m6 6 12 12M18 6 6 18" />}
    {name === "grip" && <>
      <circle cx="7" cy="7" fill="currentColor" r="1.4" />
      <circle cx="12" cy="7" fill="currentColor" r="1.4" />
      <circle cx="17" cy="7" fill="currentColor" r="1.4" />
      <circle cx="7" cy="17" fill="currentColor" r="1.4" />
      <circle cx="12" cy="17" fill="currentColor" r="1.4" />
      <circle cx="17" cy="17" fill="currentColor" r="1.4" />
    </>}
    {name === "history" && <>
      <path {...common} d="M6 3.5h12a2 2 0 0 1 2 2v15H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path {...common} d="M8 8h8M8 12h8M8 16h6" />
      <path {...common} d="M4 6.5h16" />
    </>}
    {name === "note" && <>
      <path {...common} fill="#ffe58a" d="M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path {...common} d="M15 21v-6h6M7 8h10M7 12h6" />
    </>}
    {name === "message" && <path {...common} d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />}
    {name === "undo" && <>
      <path {...common} d="M9 7H4v5" />
      <path {...common} d="M4 12a8 8 0 1 1 2.2 5.5" />
    </>}
    {name === "redo" && <>
      <path {...common} d="M15 7h5v5" />
      <path {...common} d="M20 12a8 8 0 1 0-2.2 5.5" />
    </>}
    {name === "library" && <>
      <path {...common} d="M5 4h14v16H5z" />
      <path {...common} d="M8 8h8M8 12h8M8 16h5" />
    </>}
    {name === "download" && <>
      <path {...common} d="M12 3v12" />
      <path {...common} d="m7 11 5 5 5-5M5 21h14" />
    </>}
    {name === "upload" && <>
      <path {...common} d="M12 21V9" />
      <path {...common} d="m7 13 5-5 5 5M5 3h14" />
    </>}
    {name === "trash" && <>
      <path {...common} d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
    </>}
  </svg>;
};
