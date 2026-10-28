import type { PlanId } from "@/db/schema";

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  usd: number; // monthly price in USD
  inr: number; // monthly price in INR
  credits: number; // credits per month
  activeWorkflows: number; // -1 = unlimited
  minIntervalMin: number; // fastest schedule allowed
  maxSeats: number; // -1 = unlimited
  features: string[];
  highlight?: boolean;
};

/**
 * Edit prices and limits here. Stripe/Razorpay plan IDs live in .env and must
 * match these tiers (see README → "Setting up payments").
 */
export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: "FREE",
    name: "Free",
    tagline: "Kick the tyres",
    usd: 0,
    inr: 0,
    credits: 1_000,
    activeWorkflows: 2,
    minIntervalMin: 15,
    maxSeats: 1,
    features: ["1,000 credits / month", "2 active workflows", "15-minute schedules", "All core apps", "7-day run history"],
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    tagline: "For solo builders",
    usd: 9,
    inr: 799,
    credits: 10_000,
    activeWorkflows: -1,
    minIntervalMin: 1,
    maxSeats: 1,
    features: ["10,000 credits / month", "Unlimited active workflows", "1-minute schedules", "Webhooks & HTTP", "30-day run history"],
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    tagline: "For serious automation",
    usd: 16,
    inr: 1399,
    credits: 10_000,
    activeWorkflows: -1,
    minIntervalMin: 1,
    maxSeats: 3,
    features: ["Everything in Starter", "AI agent steps", "Code steps (JS)", "API & MCP access", "Full-text run search"],
    highlight: true,
  },
  TEAMS: {
    id: "TEAMS",
    name: "Teams",
    tagline: "Build together",
    usd: 29,
    inr: 2499,
    credits: 10_000,
    activeWorkflows: -1,
    minIntervalMin: 1,
    maxSeats: 25,
    features: ["Everything in Pro", "Up to 25 seats", "Roles & permissions", "Audit log", "Shared connections"],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    tagline: "Org-wide rollout",
    usd: -1,
    inr: -1,
    credits: 500_000,
    activeWorkflows: -1,
    minIntervalMin: 1,
    maxSeats: -1,
    features: ["Custom credit volume", "Unlimited seats", "SSO (on request)", "Dedicated support", "Custom integrations"],
  },
};

export const PAID_PLANS: PlanId[] = ["STARTER", "PRO", "TEAMS"];

/** Plan gates for premium modules. */
export const PLAN_RANK: Record<PlanId, number> = { FREE: 0, STARTER: 1, PRO: 2, TEAMS: 3, ENTERPRISE: 4 };

export function planAllows(plan: PlanId, min: PlanId) {
  return PLAN_RANK[plan] >= PLAN_RANK[min];
}

export const CREDIT_PACK = { credits: 10_000, usd: 9, inr: 749 };
