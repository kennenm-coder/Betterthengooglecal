import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // API routes handle their own auth — don't redirect them
  if (pathname.startsWith("/api/")) {
    return supabaseResponse;
  }

  if (
    !user &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/forgot-password") &&
    !pathname.startsWith("/reset-password")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Remember where they were headed (e.g. a write-up doc link from an email)
    // so login can send them back there instead of the home screen.
    if (pathname !== "/") {
      url.search = "";
      url.searchParams.set("redirect", pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/login")) {
    const dest = request.nextUrl.searchParams.get("redirect");
    // Honor a same-origin redirect target (path + query); else fall back home.
    if (dest && dest.startsWith("/") && !dest.startsWith("//")) {
      return NextResponse.redirect(new URL(dest, request.url));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Authenticated user on a protected page — verify they're still on the allowlist.
  // If their email was removed from allowed_emails, sign them out and redirect to login.
  if (
    user?.email &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/forgot-password") &&
    !pathname.startsWith("/reset-password")
  ) {
    const { data: isAllowed } = await supabase
      .rpc("is_email_allowed", { check_email: user.email.toLowerCase() });

    if (!isAllowed) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|js|css|ico)$).*)",
  ],
};
