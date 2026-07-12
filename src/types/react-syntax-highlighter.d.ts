declare module "react-syntax-highlighter" {
  import type { ComponentType, CSSProperties, ReactNode } from "react";

  type SyntaxHighlighterProps = {
    children?: ReactNode;
    className?: string;
    codeTagProps?: { className?: string };
    customStyle?: CSSProperties;
    language?: string;
    lineNumberStyle?: CSSProperties;
    showLineNumbers?: boolean;
    style?: Record<string, CSSProperties>;
  };

  export const Prism: ComponentType<SyntaxHighlighterProps>;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  import type { CSSProperties } from "react";

  export const oneDark: Record<string, CSSProperties>;
  export const oneLight: Record<string, CSSProperties>;
}
