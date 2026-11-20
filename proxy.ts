import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

const PUBLIC_PAGES = ["/sign-in", "/sign-up", "/preview"];

function under(req: NextRequest, prefix: string) {
  const path = req.nextUrl.pathname;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/* With every endpoint mocked there is no real data behind the pages, and the e2e suite browses signed out. */
const allMocked = process.env.NEXT_PUBLIC_API_MOCKS === "true" && !process.env.NEXT_PUBLIC_API_LIVE?.trim();

/*
 * A first gate only, and deny by default: any page not listed above needs a
 * session. Each API route still checks the user itself, because data is only
 * reachable through the API and Next.js doesn't treat proxy as authorization.
 */
export default clerkMiddleware(async (auth, req) => {
  if (under(req, "/api")) {
    const { userId } = await auth();
    if (!userId) {
      return Response.json(
        { error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } },
        { status: 401 }
      );
    }
    return;
  }
  if (PUBLIC_PAGES.some((p) => under(req, p)) || allMocked) return;
  await auth.protect();
});

export const config = {
    matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)"
    ],
};
