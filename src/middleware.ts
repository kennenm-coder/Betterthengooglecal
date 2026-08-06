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
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Authenticated user on a protected page — verify they're still on the allowlist.
  // If their email was removed from allowed_emails, sign them out and redirect to login.
  if (user?.email) {
    const { data: allowed } = await supabase
      .from("allowed_emails")
      .select("email")
      .eq("email", user.email.toLowerCase())
      .maybeSingle();

    if (!allowed) {
      // Not on allowlist — clear their session and redirect to login
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
