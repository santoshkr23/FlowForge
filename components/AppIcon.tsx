import {
  Bot,
  Braces,
  Clock,
  Code2,
  CreditCard,
  Database,
  Filter,
  GitBranch,
  Github,
  Globe,
  Hourglass,
  Mail,
  MessageCircle,
  MessageSquare,
  Play,
  Repeat,
  Reply,
  Send,
  Sheet,
  Smartphone,
  Sparkles,
  Table2,
  Type,
  Variable,
  Webhook,
  Workflow,
  FileText,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  play: Play,
  clock: Clock,
  webhook: Webhook,
  filter: Filter,
  router: GitBranch,
  repeat: Repeat,
  hourglass: Hourglass,
  variable: Variable,
  reply: Reply,
  text: Type,
  braces: Braces,
  database: Database,
  sparkles: Sparkles,
  bot: Bot,
  mail: Mail,
  slack: MessageSquare,
  discord: MessageCircle,
  telegram: Send,
  twilio: Smartphone,
  sheets: Sheet,
  notion: FileText,
  airtable: Table2,
  github: Github,
  globe: Globe,
  code: Code2,
  flow: Workflow,
  razorpay: CreditCard,
  stripe: CreditCard,
  google: Sheet,
  smtp: Mail,
  http_auth: Globe,
};

export function AppIcon({ app, color, size = 18 }: { app: string; color?: string; size?: number }) {
  const Icon = ICONS[app] ?? Workflow;
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-lg text-white" style={{ background: color ?? "#2B59C3", width: size + 14, height: size + 14 }}>
      <Icon size={size} strokeWidth={2} aria-hidden />
    </span>
  );
}
