import { z } from "zod";
import nodemailer from "nodemailer";
import { body, err, json, withAuth } from "@/lib/http";
import { db, schema } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { PLANS } from "@/lib/plans";
import { seatCount } from "@/lib/team";
import { audit } from "@/lib/audit";

export const POST = withAuth("ADMIN", async (ctx, req) => {
  const b = await body(req, z.object({ email: z.string().trim().email(), role: z.enum(["ADMIN", "BUILDER", "VIEWER"]) }));
  const max = PLANS[ctx.org.plan].maxSeats;
  if (max >= 0 && (await seatCount(ctx.org.id)) >= max) return err(`Your ${PLANS[ctx.org.plan].name} plan includes ${max} seat(s). Upgrade to Teams to invite more people.`, 402);
  const token = randomToken(24);
  await db.insert(schema.invites).values({ orgId: ctx.org.id, email: b.email.toLowerCase(), role: b.role, token });
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/signup?invite=${token}&email=${encodeURIComponent(b.email)}`;
  let emailed = false;
  if (process.env.SMTP_HOST) {
    try {
      const port = Number(process.env.SMTP_PORT) || 587;
      await nodemailer
        .createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
        .sendMail({
          from: process.env.SMTP_FROM,
          to: b.email,
          subject: `${ctx.user.name ?? ctx.user.email} invited you to ${ctx.org.name} on FlowForge`,
          html: `<p>You've been invited to join <b>${ctx.org.name}</b> on FlowForge.</p><p><a href="${link}">Accept the invite</a></p>`,
        });
      emailed = true;
    } catch (e) {
      console.error("invite email failed", e);
    }
  }
  await audit(ctx.org.id, ctx.user.id, "member.invited", b.email, { role: b.role });
  return json({ link, emailed }, 201);
});
