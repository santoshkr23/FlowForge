/**
 * Hashtag suggestions for a post. Uses the configured AI model when there is one;
 * otherwise picks keywords from the text and adds popular tags for the topics it mentions.
 */
import { aiProvider, chat, extractJson } from "../ai";

const STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its just me more most my no not of on or our out so than that the their them then there these they this to too up us was we were what when which who why will with you your about after all also any because before being both each few here just like many much new now only other over own same should some such through under very want way well would yours i'm it's don't you're we're let's get got make made one two three day days time year years today really thing things".split(
    " ",
  ),
);

/** topic → popular tags. Matched against words in the post. */
const TOPICS: [RegExp, string[]][] = [
  [/\b(ai|artificial|gpt|chatgpt|llm|claude|genai|machine learning|ml)\b/i, ["AI", "ArtificialIntelligence", "GenerativeAI", "MachineLearning", "FutureOfWork"]],
  [/\b(automat\w*|workflow|no-?code|zapier|make\.com|n8n)\b/i, ["Automation", "NoCode", "Productivity", "WorkflowAutomation"]],
  [/\b(market\w*|brand\w*|seo|content|campaign|growth)\b/i, ["Marketing", "DigitalMarketing", "ContentMarketing", "GrowthMarketing", "Branding"]],
  [/\b(startup|founder|funding|vc|bootstrap\w*|saas|entrepreneur\w*)\b/i, ["Startup", "Entrepreneurship", "Founders", "SaaS", "StartupIndia"]],
  [/\b(job|hiring|career|resume|interview|internship|layoff\w*|opportunit\w*)\b/i, ["Hiring", "Careers", "JobSearch", "OpenToWork", "CareerGrowth"]],
  [/\b(lead\w*|manag\w*|team|culture|ceo)\b/i, ["Leadership", "Management", "TeamWork", "Culture"]],
  [/\b(sale|sales|revenue|customer|client|b2b)\b/i, ["Sales", "B2B", "CustomerSuccess", "BusinessGrowth"]],
  [/\b(data|analytics|sql|excel|power ?bi|tableau|dashboard)\b/i, ["DataAnalytics", "SQL", "PowerBI", "DataScience", "BusinessIntelligence"]],
  [/\b(code|coding|developer|programming|javascript|python|react|software)\b/i, ["SoftwareDevelopment", "Programming", "Developers", "Tech", "WebDevelopment"]],
  [/\b(design|ux|ui|figma|creative)\b/i, ["Design", "UXDesign", "UIDesign", "Creativity"]],
  [/\b(financ\w*|invest\w*|stock\w*|money|wealth|crypto|trading)\b/i, ["Finance", "Investing", "PersonalFinance", "StockMarket"]],
  [/\b(learn\w*|course|study|student|education|tips|guide|cheat ?sheet|pdf|roadmap)\b/i, ["Learning", "Education", "Upskilling", "CareerDevelopment", "Tips"]],
  [/\b(productiv\w*|habit\w*|focus|mindset|motivat\w*|success)\b/i, ["Productivity", "Mindset", "Motivation", "PersonalDevelopment", "Success"]],
  [/\b(social media|linkedin|instagram|youtube|creator|influencer|post\w*)\b/i, ["SocialMedia", "ContentCreator", "LinkedInTips", "PersonalBranding"]],
  [/\b(india|bharat|bangalore|bengaluru|mumbai|delhi|hyderabad|pune)\b/i, ["India", "IndianStartups", "MakeInIndia"]],
  [/\b(cloud|aws|azure|gcp|devops|kubernetes|docker)\b/i, ["CloudComputing", "AWS", "DevOps", "Cloud"]],
  [/\b(security|cyber|hack\w*|privacy)\b/i, ["CyberSecurity", "InfoSec", "Privacy"]],
  [/\b(ecommerce|e-commerce|shopify|d2c|retail|store)\b/i, ["Ecommerce", "D2C", "OnlineBusiness", "Retail"]],
];

const GENERIC = ["Innovation", "Technology", "Business", "Networking", "Inspiration"];

const camel = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function keywordHashtags(text: string, max = 12): string[] {
  const existing = new Set([...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase()));
  const out: string[] = [];
  const add = (tag: string) => {
    const k = tag.toLowerCase();
    if (!existing.has(k) && !out.some((t) => t.toLowerCase() === k)) out.push(tag);
  };
  for (const [re, tags] of TOPICS) if (re.test(text)) tags.slice(0, 3).forEach(add);
  // most frequent meaningful words in the post itself
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().replace(/https?:\/\/\S+/g, " ").match(/[\p{L}][\p{L}\p{N}]{3,}/gu) ?? [])
    if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([w]) => add(camel(w)));
  GENERIC.forEach(add);
  return out.slice(0, max);
}

export async function suggestHashtags(text: string): Promise<{ tags: string[]; source: "ai" | "keywords" }> {
  if (!text.trim()) return { tags: GENERIC, source: "keywords" };
  if (aiProvider()) {
    try {
      const r = await chat({
        system:
          "You suggest hashtags for social media posts (LinkedIn, Instagram, X). Mix 3-4 broad high-reach tags popular on LinkedIn right now with niche tags specific to the post. Return JSON only: {\"tags\":[\"Tag\",...]} with 10-12 CamelCase tags, no # sign, no spaces.",
        messages: [{ role: "user", content: text.slice(0, 4000) }],
        json: true,
        maxTokens: 300,
      });
      const tags = ((extractJson(r.text) as { tags?: unknown[] })?.tags ?? [])
        .map((t) => String(t).replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
        .filter(Boolean)
        .slice(0, 12);
      if (tags.length) return { tags, source: "ai" };
    } catch {
      /* fall back to keywords */
    }
  }
  return { tags: keywordHashtags(text), source: "keywords" };
}
