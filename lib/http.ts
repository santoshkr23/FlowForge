import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { getCtx, hasRole, type Ctx } from "./auth";
import type { Role } from "@/db/schema";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function handleError(e: unknown) {
  if (e instanceof ZodError) return err(e.errors.map((x) => `${x.path.join(".") || "body"}: ${x.message}`).join("; "), 422);
  if (e instanceof HttpError) return err(e.message, e.status);
  console.error(e);
  return err("Something went wrong", 500);
}

type RouteArgs = { params: Record<string, string> };

/** Wrap an API handler with auth + role check + error handling. */
export function withAuth(minRole: Role, handler: (ctx: Ctx, req: Request, args: RouteArgs) => Promise<Response>) {
  return async (req: Request, args: RouteArgs) => {
    try {
      const ctx = await getCtx();
      if (!ctx) return err("Not signed in", 401);
      if (!hasRole(ctx.role, minRole)) return err("You don't have permission to do that", 403);
      return await handler(ctx, req, args);
    } catch (e) {
      return handleError(e);
    }
  };
}

export async function body<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  const raw = await req.json().catch(() => ({}));
  return schema.parse(raw);
}
