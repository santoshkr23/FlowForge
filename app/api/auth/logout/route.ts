import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { siteUrl } from "@/lib/oauth/providers";

export async function POST(req: Request) {
  await destroySession();
  return NextResponse.redirect(`${siteUrl(req)}/`, 303);
}
