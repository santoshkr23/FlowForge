import { z } from "zod";
import { body, err, json, withAuth } from "@/lib/http";
import { getWorkflow } from "@/lib/workflows";
import { validateGraph } from "@/lib/engine/graph";
import { sampleTriggerInput } from "@/lib/engine/sample";
import { startRun } from "@/lib/engine/queue";
import { creditsRemaining } from "@/lib/credits";

export const maxDuration = 300;

/** "Run once" from the builder: runs inline and returns the full step log. */
export const POST = withAuth("BUILDER", async (ctx, req, { params }) => {
  const b = await body(req, z.object({ input: z.unknown().optional() }));
  const wf = await getWorkflow(ctx.org.id, params.id);
  const problems = validateGraph(wf.graph);
  if (problems.length) return err(problems[0], 422);
  if (creditsRemaining(ctx.org) <= 0) return err("You're out of credits. Upgrade or buy a credit pack.", 402);
  let input: unknown = b.input ?? {};
  const empty = input == null || (typeof input === "object" && !Array.isArray(input) && Object.keys(input as object).length === 0);
  if (empty) {
    try {
      input = (await sampleTriggerInput(wf, ctx.org.id)) ?? input;
    } catch (e) {
      return err((e as Error).message, 422);
    }
  }
  const { executionId, outcome } = await startRun(wf, "manual", input, { wait: true });
  return json({ executionId, ...outcome });
});
