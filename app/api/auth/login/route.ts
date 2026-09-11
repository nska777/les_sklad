import { NextResponse } from "next/server";
import { accessPassword, sessionToken } from "@/lib/warehouse-auth";

export async function POST(request: Request) {
  const { password } = await request.json() as { password?: string };
  if (password !== accessPassword()) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("warehouse_session", await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
