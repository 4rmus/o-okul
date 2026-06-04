declare module "next/navigation" {
  export function useRouter(): {
    replace(href: string): void;
  };
  export function usePathname(): string;
  export function useParams<TParams extends Record<string, string | string[]> = Record<string, string | string[]>>(): TParams;
  export function useSearchParams(): URLSearchParams;
}

declare module "next/link" {
  import type { AnchorHTMLAttributes, ReactNode } from "react";

  export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: ReactNode;
    href: string;
  }): ReactNode;
}
