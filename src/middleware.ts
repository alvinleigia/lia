import { type NextRequest, NextResponse } from "next/server";

const publicRoutes = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/invite/accept",
  "/reset-password",
]);

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublicRoute = publicRoutes.has(pathname);
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isWidgetRoute = pathname.startsWith("/widget");
  const isWidgetApiRoute = pathname.startsWith("/api/widget/");
  const isUploadWorkerRoute = pathname === "/api/upload/process-next";
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token");

  if (
    isPublicRoute ||
    isAuthRoute ||
    isWidgetRoute ||
    isWidgetApiRoute ||
    isUploadWorkerRoute
  ) {
    return NextResponse.next();
  }

  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const redirectUrl = new URL("/", req.nextUrl);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
