import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/app", "/admin"];
const AUTH_PAGES = ["/login", "/signup"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(p + "/"));

  if (!url || !key) {
    // Not configured yet: keep marketing pages working, block the app.
    if (isProtected) {
      const to = request.nextUrl.clone();
      to.pathname = "/login";
      to.search = "";
      to.searchParams.set("error", "Supabase is not configured yet. See the README.");
      return NextResponse.redirect(to);
    }
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtected && !user) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    to.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(to);
  }

  if (user && AUTH_PAGES.includes(path)) {
    const to = request.nextUrl.clone();
    to.pathname = "/app";
    to.search = "";
    return NextResponse.redirect(to);
  }

  // Admin role is verified again server-side in the admin layout & API routes.
  return response;
}
