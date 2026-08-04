declare module "next/navigation" {
  export function useRouter(): {
    push(href: string): void;
    replace(href: string): void;
  };
  export function usePathname(): string;
  export function useParams<TParams extends Record<string, string | string[]> = Record<string, string | string[]>>(): TParams;
  export function useSearchParams(): URLSearchParams;
  export function redirect(href: string): never;
  export function notFound(): never;
}

declare module "next/headers" {
  export function headers(): Promise<Headers>;
}

declare module "next/server" {
  export class NextRequest extends Request {
    readonly nextUrl: URL;
  }

  export class NextResponse extends Response {
    static next(): NextResponse;
    static redirect(url: string | URL, status?: number): NextResponse;
  }
}

declare module "next/link" {
  import type { AnchorHTMLAttributes, ReactNode } from "react";

  export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: ReactNode;
    href: string;
  }): ReactNode;
}
