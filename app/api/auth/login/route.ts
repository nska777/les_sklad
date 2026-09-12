import { NextResponse } from "next/server";
import { authenticateUser, createSessionToken } from "@/lib/warehouse-auth";

export async function POST(request: Request) {
  const { username, password } = await request.json() as { username?: string; password?: string };
  const session = authenticateUser(username || "admin", password || "");
  if (!session) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, user: session });
  response.cookies.set("warehouse_session", await createSessionToken(session), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
