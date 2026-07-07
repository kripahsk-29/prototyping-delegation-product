import { Router } from "express";
import { randomUUID } from "crypto";

const router = Router();

interface Message {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: string;
  type?: "text" | "allocation_form" | "energy_form";
}

interface Session {
  sessionId: string;
  messages: Message[];
  phase: "intake" | "analysis" | "complete";
  questionCount: number;
  isComplete: boolean;
}

interface QuestionDef {
  content: string;
  msgType: "text" | "allocation_form" | "energy_form";
}

const sessions = new Map<string, Session>();

// 6 questions following the v2 spec:
// Q1: Business context  Q2: Existing team  Q3: Week tasks (text)
// Q4: Time per task + energy (allocation_form)
// Q5: Value (text)  Q6: History + take-home income (text)
const QUESTIONS: QuestionDef[] = [
  {
    content:
      "Let's start with some context. Tell me about your business — what you do, what stage you're at, what industry, and roughly how big the operation is today.",
    msgType: "text",
  },
  {
    content:
      "Who's already on your team — even part-time or contract? Walk me through who's there and what each person actually owns day to day.",
    msgType: "text",
  },
  {
    content:
      "Now let's get into your week. Walk me through Monday to Friday — what actually lands on your plate? Just list it out, everything that you're doing.",
    msgType: "text",
  },
  {
    content:
      "For each area below, roughly how much of your time do you currently spend on it, how much would you like to spend, and — on a scale of 1 (not good) to 5 (best) — how does it feel? Both percentage columns must add up to 100%.",
    msgType: "allocation_form",
  },
  {
    content:
      "Looking at that same list — which of these tasks can only you do well? And which ones could someone else handle, with the right guidance?",
    msgType: "text",
  },
  {
    content:
      "Last one. Have you tried delegating before? What worked, and what got in the way? And what's your personal take-home or target income — even a ballpark is fine. That's what lets us put a real number on what your time is worth.",
    msgType: "text",
  },
];

function makeMessage(
  role: "assistant" | "user",
  content: string,
  type: "text" | "allocation_form" | "energy_form" = "text"
): Message {
  return {
    id: randomUUID(),
    role,
    content,
    timestamp: new Date().toISOString(),
    type,
  };
}

function buildNextMessage(
  nextIdx: number,
  userAnswer: string
): { content: string; type: "text" | "allocation_form" | "energy_form" } {
  const nextQ = QUESTIONS[nextIdx];

  const bridges: Record<number, () => string> = {
    // After Q1 (context) → Q2 (team)
    1: () => `Good context — that helps a lot.\n\n${nextQ.content}`,
    // After Q2 (team) → Q3 (week tasks)
    2: () => `Got it — knowing who's already there changes everything.\n\n${nextQ.content}`,
    // After Q3 (week) → Q4 (allocation + energy form)
    3: () => {
      const wc = userAnswer.trim().split(/\s+/).length;
      const opener = wc > 40
        ? "That's a full plate — and a clear picture of where your time is going."
        : "That's useful — I can already see some patterns there.";
      return `${opener}\n\nNow let's put some numbers on it — and how each one feels:`;
    },
    // After Q4 (allocation + energy) → Q5 (value)
    4: () => `That time and energy breakdown is really telling. One more angle:\n\n${nextQ.content}`,
    // After Q5 (value) → Q6 (history + income)
    5: () => `That distinction — what only you can do versus what anyone could — is exactly what shapes the plan.\n\n${nextQ.content}`,
  };

  const bridge = bridges[nextIdx];
  const content = bridge ? bridge() : nextQ.content;
  return { content, type: nextQ.msgType };
}

// ── Parsers ─────────────────────────────────────────────────────────────────

function parseIncome(text: string): number | null {
  const cleaned = text.toLowerCase().replace(/,/g, "").replace(/\$/g, "");
  const millionMatch = cleaned.match(/(\d+\.?\d*)\s*(?:million|m\b)/);
  if (millionMatch) return Math.round(parseFloat(millionMatch[1]) * 1_000_000);
  const kMatch = cleaned.match(/(\d+\.?\d*)\s*(?:k\b|thousand)/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000);
  const bigMatch = cleaned.match(/\b(\d{5,})\b/);
  if (bigMatch) return parseInt(bigMatch[1]);
  const smallMatch = cleaned.match(/\b(\d{2,4})\b/);
  if (smallMatch) {
    const n = parseInt(smallMatch[1]);
    if (n >= 20) return n * 1_000;
  }
  return null;
}

function parsePct(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx === -1) continue;
    const after = text.slice(idx + kw.length);
    const m = after.match(/\s+(\d+)%/);
    if (m) return parseInt(m[1]);
  }
  return 0;
}

interface Allocation {
  current: { ops: number; strategy: number; relationships: number; sales: number; finance: number };
  desired: { ops: number; strategy: number; relationships: number; sales: number; finance: number };
}

function parseAllocation(messages: Message[]): Allocation | null {
  const msg = messages.find(
    (m) => m.role === "user" && m.content.includes("Currently spending:")
  );
  if (!msg) return null;
  const [currentPart = "", desiredPart = ""] = msg.content.split("Would like to spend:");
  const extract = (text: string) => ({
    ops:           parsePct(text, ["day-to-day operations", "Handling day-to-day", "operations"]),
    strategy:      parsePct(text, ["business strategy", "strategy"]),
    relationships: parsePct(text, ["relationships / partnerships", "relationships"]),
    sales:         parsePct(text, ["sales"]),
    finance:       parsePct(text, ["finance / accounting", "finance"]),
  });
  return { current: extract(currentPart), desired: extract(desiredPart) };
}

// Parse energy scores from the allocation_form submission's "Feels" segment
// Format: "... Feels — Handling day-to-day operations: 2, Business strategy: 5, ..."
function parseEnergy(messages: Message[]): Record<string, number> {
  const msg = messages.find(
    (m) => m.role === "user" && m.content.includes("Feels —")
  );
  if (!msg) return {};
  const result: Record<string, number> = {};
  const matches = msg.content.matchAll(/([A-Za-z\s\/]+):\s*(\d)/g);
  for (const m of matches) {
    const key = m[1].trim().toLowerCase();
    const val = parseInt(m[2]);
    if (key.includes("oper")) result.ops = val;
    else if (key.includes("strateg")) result.strategy = val;
    else if (key.includes("relat")) result.relationships = val;
    else if (key.includes("sale")) result.sales = val;
    else if (key.includes("financ") || key.includes("account")) result.finance = val;
  }
  return result;
}

// Detect roles already on the team from Q2 text
function parseTeamRoles(q2Text: string): Set<string> {
  const lower = q2Text.toLowerCase();
  const roles = new Set<string>();
  if (lower.match(/ops|operations manager|operations/)) roles.add("ops");
  if (lower.match(/marketing|social media|content/)) roles.add("marketing");
  if (lower.match(/bookkeeper|accountant|finance|accounting/)) roles.add("finance");
  if (lower.match(/va|virtual assistant|admin assistant/)) roles.add("va");
  if (lower.match(/sales|biz dev|business development/)) roles.add("sales");
  if (lower.match(/project manager|pm|coordinator/)) roles.add("pm");
  if (lower.match(/customer service|support/)) roles.add("support");
  return roles;
}

// Determine the who_takes_it route given a task and team context
function routeWhoTakesIt(
  task: TaskTemplate,
  teamRoles: Set<string>,
  energyScore: number
): string {
  // System/automation route for R-tagged tasks
  const systemTools: Record<string, string> = {
    "Client Onboarding Administration": "System: HoneyBook or Dubsado",
    "Proposal & Quote Preparation":     "System: PandaDoc or Proposify",
    "CRM Data Entry & Pipeline Management": "System: HubSpot automation",
  };
  if (task.drip === "R" && systemTools[task.taskName]) {
    return systemTools[task.taskName];
  }

  // Check existing team first
  const teamMatch: Record<string, string[]> = {
    ops:       ["Email & Inbox Management", "Calendar & Meeting Scheduling", "Project Status Updates & Reporting", "Client Onboarding Administration"],
    marketing: ["Social Media Posting & Management"],
    finance:   ["Bookkeeping & Invoicing", "Payroll & Contractor Payments"],
    va:        ["Email & Inbox Management", "Calendar & Meeting Scheduling", "Routine Client Check-in Emails", "Review & Testimonial Requests"],
    sales:     ["CRM Data Entry & Pipeline Management", "Outbound Outreach & Follow-up Sequences", "Proposal & Quote Preparation"],
    pm:        ["Project Status Updates & Reporting", "Client Onboarding Administration", "Partnership & Vendor Coordination"],
    support:   ["Routine Client Check-in Emails", "Review & Testimonial Requests"],
  };

  for (const [role, tasks] of Object.entries(teamMatch)) {
    if (teamRoles.has(role) && tasks.includes(task.taskName)) {
      const roleLabel: Record<string, string> = {
        ops:       "Operations Manager",
        marketing: "Marketing / Content person",
        finance:   "Bookkeeper / Accountant",
        va:        "Virtual Assistant",
        sales:     "Sales person",
        pm:        "Project Manager / Coordinator",
        support:   "Customer Support person",
      };
      return `Existing team member: ${roleLabel[role]}`;
    }
  }

  // External hire
  return `External hire: ${task.roleType}`;
}

// ── Task pool ───────────────────────────────────────────────────────────────

interface TaskTemplate {
  taskName: string;
  description: string;
  drip: "D" | "R" | "I" | "P";
  dripLabel: string;
  roleType: string;
  whyDelegate: string;
  category: "ops" | "finance" | "sales" | "relationships";
  keywords: string[];
  hoursFraction: number;
  marketRatePerHour: number;
}

const TASK_POOL: TaskTemplate[] = [
  {
    taskName: "Email & Inbox Management",
    description:
      "Triaging your inbox, responding to routine inquiries, flagging what needs your attention, and sending templated replies — consuming your first and last hour of every day.",
    drip: "D", dripLabel: "Delegate",
    roleType: "Executive / Virtual Assistant",
    whyDelegate:
      "A trained EA can handle 80–90% of your inbox using a decision framework you build once. You review and approve — you don't process.",
    category: "ops",
    keywords: ["email", "inbox", "emails", "respond", "replies", "messages", "gmail", "outlook", "mailbox"],
    hoursFraction: 0.40,
    marketRatePerHour: 22,
  },
  {
    taskName: "Calendar & Meeting Scheduling",
    description:
      "Booking calls, coordinating availability, sending reminders, handling reschedules, and making sure nothing slips through the cracks.",
    drip: "D", dripLabel: "Delegate",
    roleType: "Executive / Virtual Assistant",
    whyDelegate:
      "Back-and-forth scheduling is pure coordination overhead. An EA with calendar access eliminates it — one fewer cognitive drain every single day.",
    category: "ops",
    keywords: ["calendar", "schedule", "scheduling", "meetings", "appointments", "booking", "calls", "zoom", "reschedule"],
    hoursFraction: 0.20,
    marketRatePerHour: 22,
  },
  {
    taskName: "Social Media Posting & Management",
    description:
      "Writing captions, resizing visuals, posting across platforms, and responding to comments and DMs.",
    drip: "D", dripLabel: "Delegate",
    roleType: "Social Media VA / Content Assistant",
    whyDelegate:
      "You set the strategy and voice — someone else handles execution. Batching content creation once a week with an assistant cuts this to a 30-minute review.",
    category: "ops",
    keywords: ["social", "instagram", "facebook", "linkedin", "twitter", "tiktok", "posts", "posting", "content", "media", "reel", "reels"],
    hoursFraction: 0.25,
    marketRatePerHour: 18,
  },
  {
    taskName: "Client Onboarding Administration",
    description:
      "Sending welcome packets, scheduling kick-off calls, collecting intake forms, and setting up project folders every time a new client signs.",
    drip: "R", dripLabel: "Replace with a System",
    roleType: "EA + Automation (e.g. HoneyBook, Dubsado)",
    whyDelegate:
      "This is 100% repeatable. A good EA paired with a simple CRM runs your entire onboarding without you — clients feel taken care of, and you only show up at the moments that matter.",
    category: "ops",
    keywords: ["onboarding", "onboard", "welcome", "new client", "intake", "setup", "kickoff", "kick-off", "portal"],
    hoursFraction: 0.25,
    marketRatePerHour: 22,
  },
  {
    taskName: "Project Status Updates & Reporting",
    description:
      "Compiling weekly progress notes, updating project trackers, and sending stakeholder status emails so everyone stays aligned.",
    drip: "D", dripLabel: "Delegate",
    roleType: "Project Coordinator / VA",
    whyDelegate:
      "Status updates are important but don't require you. A coordinator who understands your workflow can pull and distribute this on your behalf.",
    category: "ops",
    keywords: ["updates", "status", "project", "reporting", "reports", "tracker", "progress", "asana", "notion", "monday", "clickup"],
    hoursFraction: 0.15,
    marketRatePerHour: 20,
  },
  {
    taskName: "Bookkeeping & Invoicing",
    description:
      "Logging expenses, categorizing transactions, chasing late invoices, and preparing clean reports for your accountant.",
    drip: "I", dripLabel: "Invest in a Specialist",
    roleType: "Part-time Bookkeeper",
    whyDelegate:
      "A bookkeeper does this faster and more accurately than you — and catches errors that cost you money. It also dramatically reduces your tax-prep stress.",
    category: "finance",
    keywords: ["books", "bookkeeping", "accounting", "invoices", "invoicing", "expenses", "finance", "financial", "taxes", "billing", "quickbooks", "xero"],
    hoursFraction: 0.70,
    marketRatePerHour: 35,
  },
  {
    taskName: "Payroll & Contractor Payments",
    description:
      "Processing payroll runs, tracking contractor hours, sending payments, and maintaining accurate pay records.",
    drip: "I", dripLabel: "Invest in a Specialist",
    roleType: "Payroll Service / HR Admin",
    whyDelegate:
      "Payroll errors are expensive and morale-damaging. A specialist service handles this with precision and compliance — for a fraction of what your time costs.",
    category: "finance",
    keywords: ["payroll", "staff", "employees", "wages", "salaries", "contractors", "hr", "paystub", "gusto", "rippling"],
    hoursFraction: 0.30,
    marketRatePerHour: 35,
  },
  {
    taskName: "CRM Data Entry & Pipeline Management",
    description:
      "Updating lead records, logging call notes, moving deals through pipeline stages, and keeping your CRM accurate.",
    drip: "R", dripLabel: "Replace with a System",
    roleType: "Sales Support VA",
    whyDelegate:
      "CRM hygiene is essential but not strategic. A sales support VA keeps your pipeline accurate while you focus on the conversations that actually close deals.",
    category: "sales",
    keywords: ["crm", "leads", "pipeline", "hubspot", "salesforce", "contacts", "deals", "prospects", "sales", "follow-up", "follow up"],
    hoursFraction: 0.35,
    marketRatePerHour: 20,
  },
  {
    taskName: "Proposal & Quote Preparation",
    description:
      "Building proposal documents, calculating pricing, formatting decks, and sending them for signature.",
    drip: "R", dripLabel: "Replace with a System",
    roleType: "EA + Proposal Software (e.g. PandaDoc, Proposify)",
    whyDelegate:
      "Once you build one great template, 80% of proposals write themselves. An EA running a tool like PandaDoc can produce polished proposals in under 30 minutes.",
    category: "sales",
    keywords: ["proposals", "quotes", "bids", "pitches", "estimates", "decks", "scope", "pricing", "proposal"],
    hoursFraction: 0.30,
    marketRatePerHour: 22,
  },
  {
    taskName: "Outbound Outreach & Follow-up Sequences",
    description:
      "Sending initial outreach emails, LinkedIn messages, and follow-up sequences to warm up new prospects.",
    drip: "D", dripLabel: "Delegate",
    roleType: "Sales Development Rep / VA",
    whyDelegate:
      "Top-of-funnel outreach is systematizable. A trained SDR working from your templates generates qualified conversations without eating your calendar.",
    category: "sales",
    keywords: ["outreach", "prospecting", "cold", "linkedin", "lead", "leads", "contact", "prospects", "sales email", "cold email"],
    hoursFraction: 0.35,
    marketRatePerHour: 25,
  },
  {
    taskName: "Routine Client Check-in Emails",
    description:
      "Sending weekly or bi-weekly status updates to active clients, requesting feedback, and sharing project progress.",
    drip: "D", dripLabel: "Delegate",
    roleType: "Virtual Assistant",
    whyDelegate:
      "Clients value consistency, not you personally. An EA using your templates maintains the relationship warmth while you focus on the high-value conversations.",
    category: "relationships",
    keywords: ["check-in", "check in", "checking in", "update", "client emails", "weekly", "touchpoint", "follow up"],
    hoursFraction: 0.40,
    marketRatePerHour: 18,
  },
  {
    taskName: "Partnership & Vendor Coordination",
    description:
      "Managing back-and-forth with partners, vendors, and service providers — scheduling, follow-ups, contracts, and documentation.",
    drip: "D", dripLabel: "Delegate",
    roleType: "Operations Coordinator / VA",
    whyDelegate:
      "Most vendor coordination is logistics, not strategy. Handing this to an ops-minded EA frees you from being the bottleneck on every external relationship.",
    category: "relationships",
    keywords: ["partnerships", "partners", "vendors", "suppliers", "collaborations", "contractors", "coordination", "agencies"],
    hoursFraction: 0.35,
    marketRatePerHour: 20,
  },
  {
    taskName: "Review & Testimonial Requests",
    description:
      "Following up with happy clients for Google reviews, case study interviews, and referral requests.",
    drip: "D", dripLabel: "Delegate",
    roleType: "VA / Customer Success Coordinator",
    whyDelegate:
      "This is templatable and high-return but almost always falls off the list. A VA running a simple sequence captures social proof you're leaving on the table.",
    category: "relationships",
    keywords: ["reviews", "testimonials", "feedback", "referrals", "google", "case study", "reputation"],
    hoursFraction: 0.20,
    marketRatePerHour: 18,
  },
];

// ── Task selection ──────────────────────────────────────────────────────────

interface SelectedTask {
  rank: number;
  taskName: string;
  description: string;
  drip: string;
  dripLabel: string;
  roleType: string;
  whyDelegate: string;
  whoTakesIt: string;
  hoursPerWeek: number;
  estimatedCostPerMonth: number;
  timeValuePerMonth: number;
  roi: string;
}

function getCategoryHrs(alloc: Allocation | null, category: string): number {
  const WK = 40;
  if (!alloc) {
    const defaults: Record<string, number> = { ops: 16, finance: 3, sales: 5, relationships: 6 };
    return defaults[category] ?? 5;
  }
  const pctMap: Record<string, number> = {
    ops:           alloc.current.ops,
    strategy:      alloc.current.strategy,
    relationships: alloc.current.relationships,
    sales:         alloc.current.sales,
    finance:       alloc.current.finance,
  };
  return ((pctMap[category] ?? 0) / 100) * WK;
}

function selectTasks(
  alloc: Allocation | null,
  weekText: string,
  energy: Record<string, number>,
  teamRoles: Set<string>,
  buybackRate: number
): SelectedTask[] {
  const lower = weekText.toLowerCase();

  const scored = TASK_POOL.map((task) => {
    let score = 0;

    // Keyword match on week text (Q3)
    const kwHits = task.keywords.filter((k) => lower.includes(k)).length;
    score += kwHits * 18;

    if (alloc) {
      const catPct: Record<string, number> = {
        ops: alloc.current.ops, finance: alloc.current.finance,
        sales: alloc.current.sales, relationships: alloc.current.relationships,
      };
      const desPct: Record<string, number> = {
        ops: alloc.desired.ops, finance: alloc.desired.finance,
        sales: alloc.desired.sales, relationships: alloc.desired.relationships,
      };
      const cur = catPct[task.category] ?? 0;
      const des = desPct[task.category] ?? 0;
      score += cur * 0.7;
      score += Math.max(0, cur - des) * 1.5;
    } else {
      if (task.category === "ops") score += 20;
    }

    // Energy score: low energy (1-2) in a category → big boost to tasks in that category
    const eCat: Record<string, string> = {
      ops: "ops", finance: "finance", sales: "sales", relationships: "relationships",
    };
    const energyKey = eCat[task.category];
    if (energyKey && energy[energyKey] !== undefined) {
      const e = energy[energyKey];
      if (e <= 2) score += 25;       // draining → prioritize delegating
      else if (e >= 4) score -= 10;  // energizing → maybe keep it
    }

    return { task, score };
  });

  const top5 = scored.sort((a, b) => b.score - a.score).slice(0, 5);

  return top5.map(({ task }, i) => {
    const categoryHrs = getCategoryHrs(alloc, task.category);
    const hoursPerWeek = Math.max(1, Math.round(categoryHrs * task.hoursFraction));
    const weeksPerMonth = 4;
    const valuePerMonth = Math.round(hoursPerWeek * weeksPerMonth * buybackRate);
    const costPerMonth  = Math.round(hoursPerWeek * weeksPerMonth * task.marketRatePerHour);
    const roiMultiple   = Math.round(buybackRate / task.marketRatePerHour);
    const whoTakesIt    = routeWhoTakesIt(task, teamRoles, energy[task.category] ?? 3);

    return {
      rank: i + 1,
      taskName: task.taskName,
      description: task.description,
      drip: task.drip,
      dripLabel: task.dripLabel,
      roleType: task.roleType,
      whyDelegate: task.whyDelegate,
      whoTakesIt,
      hoursPerWeek,
      estimatedCostPerMonth: costPerMonth,
      timeValuePerMonth: valuePerMonth,
      roi: `${roiMultiple}x return — your time is worth $${Math.round(buybackRate)}/hr, you pay $${task.marketRatePerHour}/hr`,
    };
  });
}

function computeTotalReclaimed(alloc: Allocation | null, tasks: SelectedTask[]): number {
  if (!alloc) return tasks.reduce((s, t) => s + t.hoursPerWeek, 0);
  const WK = 40;
  const delta = (cur: number, des: number, scale = 1) => Math.max(0, ((cur - des) / 100) * WK * scale);
  const reclaimed =
    delta(alloc.current.ops, alloc.desired.ops, 0.9) +
    delta(alloc.current.finance, alloc.desired.finance, 1.0) +
    delta(alloc.current.sales, alloc.desired.sales, 0.75) +
    delta(alloc.current.relationships, alloc.desired.relationships, 0.45);
  return Math.min(35, Math.max(1, Math.round(reclaimed)));
}

// Placeholder tier — pending Ashley's definition
function computeElevateTier(buybackRate: number): string {
  if (buybackRate < 40) return "Elevate Starter";
  if (buybackRate < 100) return "Elevate Growth";
  return "Elevate Scale";
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.post("/conversation/start", (req, res) => {
  const sessionId = randomUUID();
  const firstMessage = makeMessage("assistant", QUESTIONS[0].content, "text");
  const session: Session = {
    sessionId,
    messages: [firstMessage],
    phase: "intake",
    questionCount: 0,
    isComplete: false,
  };
  sessions.set(sessionId, session);
  res.status(201).json(session);
});

router.get("/conversation/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

router.post("/conversation/:sessionId/message", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const { content } = req.body as { content: string };
  if (!content || !content.trim()) return res.status(400).json({ error: "Content is required" });

  const userMsg = makeMessage("user", content);
  session.messages.push(userMsg);
  session.questionCount += 1;

  const nextIdx = session.questionCount;
  const readyForAnalysis = nextIdx >= QUESTIONS.length;

  let assistantMsg: Message;

  if (readyForAnalysis) {
    assistantMsg = makeMessage(
      "assistant",
      "We understand and hear you. Let's figure out how to further gain your time back."
    );
    session.phase = "analysis";
    session.isComplete = true;
  } else {
    const { content: nextContent, type: nextType } = buildNextMessage(nextIdx, content);
    assistantMsg = makeMessage("assistant", nextContent, nextType);
  }

  session.messages.push(assistantMsg);
  res.json({ message: assistantMsg, session, readyForAnalysis });
});

router.post("/conversation/:sessionId/analyze", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  session.phase = "complete";

  const userMessages = session.messages.filter((m) => m.role === "user");
  // userMessages: [0]=Q1 context, [1]=Q2 team, [2]=Q3 week,
  //               [3]=Q4 allocation + energy form,
  //               [4]=Q5 value text, [5]=Q6 history+income
  const q2TeamText   = userMessages[1]?.content ?? "";
  const q3WeekText   = userMessages[2]?.content ?? "";
  const q6IncomeText = userMessages[5]?.content ?? "";

  const alloc       = parseAllocation(session.messages);
  const energy      = parseEnergy(session.messages);
  const teamRoles   = parseTeamRoles(q2TeamText);
  const annualIncome = parseIncome(q6IncomeText) ?? 80_000;

  // Martell Buyback Rate
  const buybackRate = annualIncome / 2_000;
  const quarterRate = buybackRate / 4;

  const tasks = selectTasks(alloc, q3WeekText, energy, teamRoles, buybackRate);
  const totalHoursReclaimed = computeTotalReclaimed(alloc, tasks);
  const elevateTier = computeElevateTier(buybackRate);

  const totalCost  = tasks.reduce((s, t) => s + t.estimatedCostPerMonth, 0);
  const top3Cost   = tasks.slice(0, 3).reduce((s, t) => s + t.estimatedCostPerMonth, 0);
  const totalValue = tasks.reduce((s, t) => s + t.timeValuePerMonth, 0);
  const overallRoi = Math.round(totalValue / (totalCost || 1));

  const report = {
    sessionId: session.sessionId,
    founderName: "",
    businessType: "Service Business",
    totalHoursReclaimed,
    annualIncome,
    buybackRate: Math.round(buybackRate),
    quarterRate: Math.round(quarterRate),
    elevateTier,
    tasks,
    summary: `Based on what you shared, you're spending roughly ${totalHoursReclaimed} hours a week on work that doesn't need to be yours. At your Buyback Rate of $${Math.round(buybackRate)}/hr, that's $${(totalHoursReclaimed * 4 * Math.round(buybackRate)).toLocaleString()}/month in time cost. Delegating the top three items would run about $${top3Cost.toLocaleString()}/month — an immediate ${overallRoi}x return.`,
    nextStep:
      "Start with the highest-ranked item on this list. Pick one thing, hire or systemize for it this week, and let the momentum build. That first delegation decision is always the hardest — and the most valuable.",
  };

  res.json(report);
});

export default router;
