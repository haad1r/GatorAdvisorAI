import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicPage = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/preview"]);
const isApi = createRouteMatcher(["/api(.*)"]);

/* With every endpoint mocked there is no real data behind the pages, and the e2e suite browses signed out. */
const allMocked = process.env.NEXT_PUBLIC_API_MOCKS === "true" && !process.env.NEXT_PUBLIC_API_LIVE?.trim();

/*
 * A first gate only. Each API route still checks the user itself, because
 * Next.js doesn't treat proxy as authorization.
 */
export default clerkMiddleware(async (auth, req) => {
  if (isApi(req)) {
    const { userId } = await auth();
    if (!userId) {
      return Response.json(
        { error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } },
        { status: 401 }
      );
    }
    return;
  }
  if (isPublicPage(req) || allMocked) return;
  await auth.protect();
});

export const config = {
    matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)"
    ],
};
