import { NextResponse, type NextRequest } from "next/server";

// Passes the request path to the root layout (as a request header), so it can set <html lang> to
// Spanish only on pages that are fully translated. Nothing else is read or changed.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-easescore-path", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not API routes, Next's own files, or files with an extension (tiles, images, fonts).
  matcher: ["/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
