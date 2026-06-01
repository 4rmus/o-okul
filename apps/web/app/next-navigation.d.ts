declare module "next/navigation" {
  export function useRouter(): {
    replace(href: string): void;
  };
  export function usePathname(): string;
}

declare module "next/link" {
  import type { AnchorHTMLAttributes, ReactNode } from "react";

  export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: ReactNode;
    href: string;
  }): ReactNode;
}
