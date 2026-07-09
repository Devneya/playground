import React, {memo} from "react";

export interface ImportedIconProps {
  Icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>> | string | undefined;
  width?: string;
  height?: string;
}

const ImportedIcon = memo((props: ImportedIconProps) => {
  if (!props.Icon) {
    return null;
  }
  if (typeof props.Icon === "string") {
    return (
      <img
        src={props.Icon as string}
        width={props.width}
        height={props.height}
        alt="Icon"
      />
    );
  } else {
    const Icon = props.Icon as React.FunctionComponent<
      React.SVGProps<SVGSVGElement>
    >;
    return <Icon width={props.width} height={props.height}/>;
  }
});

export default ImportedIcon;