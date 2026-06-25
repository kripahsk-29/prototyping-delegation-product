import { Router } from "express";
import { randomUUID } from "crypto";

const router = Router();

interface Message {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: string;
  type?: "text" | "allocation_form";
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
  msgType: "text" | "allocation_form";
}

const sessions = new Map<string, Session>();

// 5 turns: Q1 (text), Q2 (text), Q3 (allocation_form), Q4 (income), Q5 (team)
const QUESTIONS: QuestionDef[] = [
  {
    content:
      "Hey there — let's figure out what's eating your time. Walk me through a typical week: what are you spending your time on, day to day?",
    msgType: "text",
  },
  {
    content:
      "Now flip that around — if you had a completely clear day with zero tasks on your plate, how would you spend it to actually grow your business?",
    msgType: "text",
  },
  {
    content:
      "While running your business, approximately what percentage of your time do you currently spend — and would like to spend — on the following activities?",
    msgType: "allocation_form",
  },
  {
    content:
      "One more piece of the puzzle: roughly what's your annual business revenue, or how much are you personally targeting to earn this year? A ballpark is totally fine — this lets us calculate exactly what your time is actually worth.",
    msgType: "text",
  },
  {
    content:
      "Last question: how many people are currently on your team? And have you ever tried delegating before — if so, what happened?",
    msgType: "text",
  },
];

function makeMessage(
  role: "assistant" | "user",
  content: string,
  type: "text" | "allocation_form" = "text"
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
  nextQuestionIndex: number,
  userAnswer: string
): { content: string; type: "text" | "allocation_form" } {
  const nextQ = QUESTIONS[nextQuestionIndex];

  const bridges: Record<number, () => string> = {
    // After Q1 → Q2
    1: () => {
      const wordCount = userAnswer.trim().split(/\s+/).length;
      const opener =
        wordCount > 30
          ? "That's a lot to be carrying — and it paints a very clear picture."
          : "Got it — that's really useful to know.";
      return `${opener}\n\n` + nextQ.content;
    },
    // After Q2 → Q3 (allocation form)
    2: () => `That's a clear vision. Now let's map out where your time actually goes today:`,
    // After Q3 form → Q4 (income)
    3: () =>
      `That breakdown is really telling. The gap between where you are and where you want to be is exactly what we'll close.\n\n` +
      nextQ.content,
    // After Q4 income → Q5 (team)
    4: () =>
      `Perfect — that gives us everything we need to be precise with the numbers.\n\n` +
      nextQ.content,
  };

  const bridge = bridges[nextQuestionIndex];
  const content = bridge ? bridge() : nextQ.content;
  return { content, type: nextQ.msgType };
}

// ── Income parsing (Martell Buyback Rate) ───────────────────────────────────

function parseIncome(text: string): number | null {
  const cleaned = text.toLowerCase().replace(/,/g, "").replace(/\$/g, "");

  // "1.5 million" / "1.5m"
  const millionMatch = cleaned.match(/(\d+\.?\d*)\s*(?:million|m\b)/);
  if (millionMatch) return Math.round(parseFloat(millionMatch[1]) * 1_000_000);

  // "200k" / "200 thousand"
  const kMatch = cleaned.match(/(\d+\.?\d*)\s*(?:k\b|thousand)/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000);

  // Plain number >= 10,000 (e.g. "200000")
  const bigMatch = cleaned.match(/\b(\d{5,})\b/);
  if (bigMatch) return parseInt(bigMatch[1]);

  // 3-4 digit number — treat as thousands (e.g. "200" → $200k, "85" → $85k)
  const smallMatch = cleaned.match(/\b(\d{2,4})\b/);
  if (smallMatch) {
    const n = parseInt(smallMatch[1]);
    if (n >= 20) return n * 1_000;
  }

  return null;
}

// ── Allocation parsing ──────────────────────────────────────────────────────

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
    ops:           parsePct(text, ["day-to-day operations", "operations"]),
    strategy:      parsePct(text, ["business strategy", "strategy"]),
    relationships: parsePct(text, ["relationships / partnerships", "relationships"]),
    sales:         parsePct(text, ["sales"]),
    finance:       parsePct(text, ["finance / accounting", "finance"]),
  });
  return { current: extract(currentPart), desired: extract(desiredPart) };
}

function getCategoryHrs(alloc: Allocation | null, category: string): number {
  const WK = 40;
  if (!alloc) {
    const defaults: Record<string, number> = {
      ops: 16, finance: 3, sales: 5, relationships: 6, strategy: 10,
    };
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
  /** Market rate for the role (hourly) */
  marketRatePerHour: number;
}

const TASK_POOL: TaskTemplate[] = [
  // ── Operations ─────────────────────────────────────────────────────────
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
  // ── Finance ─────────────────────────────────────────────────────────────
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
  // ── Sales ───────────────────────────────────────────────────────────────
  {
    taskName: "CRM Data Entry & Pipeline Management",
    description:
      "Updating lead records, logging call notes, moving deals through pipeline stages, and keeping your CRM accurate.",
    drip: "D", dripLabel: "Delegate",
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
  // ── Relationships ───────────────────────────────────────────────────────
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
  hoursPerWeek: number;
  estimatedCostPerMonth: number;
  timeValuePerMonth: number;
  roi: string;
}

function selectTasks(
  alloc: Allocation | null,
  q1Text: string,
  buybackRate: number
): SelectedTask[] {
  const lower = q1Text.toLowerCase();

  const scored = TASK_POOL.map((task) => {
    let score = 0;
    const kwHits = task.keywords.filter((k) => lower.includes(k)).length;
    score += kwHits * 18;

    if (alloc) {
      const catPctMap: Record<string, number> = {
        ops:           alloc.current.ops,
        finance:       alloc.current.finance,
        sales:         alloc.current.sales,
        relationships: alloc.current.relationships,
      };
      const desPctMap: Record<string, number> = {
        ops:           alloc.desired.ops,
        finance:       alloc.desired.finance,
        sales:         alloc.desired.sales,
        relationships: alloc.desired.relationships,
      };
      const currentPct = catPctMap[task.category] ?? 0;
      const desiredPct = desPctMap[task.category] ?? 0;
      const delta = Math.max(0, currentPct - desiredPct);
      score += currentPct * 0.7;
      score += delta * 1.5;
    } else {
      if (task.category === "ops") score += 20;
    }

    return { task, score };
  });

  const top5 = scored.sort((a, b) => b.score - a.score).slice(0, 5);

  return top5.map(({ task }, i) => {
    const categoryHrs = getCategoryHrs(alloc, task.category);
    const hoursPerWeek = Math.max(1, Math.round(categoryHrs * task.hoursFraction));

    // Martell's formula:
    //   value  = hours × buybackRate (what the owner's time is actually worth)
    //   cost   = hours × marketRatePerHour (what the delegatee gets paid)
    //   roi    = buybackRate / marketRatePerHour
    const weeksPerMonth = 4;
    const valuePerMonth = Math.round(hoursPerWeek * weeksPerMonth * buybackRate);
    const costPerMonth  = Math.round(hoursPerWeek * weeksPerMonth * task.marketRatePerHour);
    const roiMultiple   = Math.round(buybackRate / task.marketRatePerHour);

    return {
      rank: i + 1,
      taskName: task.taskName,
      description: task.description,
      drip: task.drip,
      dripLabel: task.dripLabel,
      roleType: task.roleType,
      whyDelegate: task.whyDelegate,
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
  const delta = (cur: number, des: number, scale = 1) =>
    Math.max(0, ((cur - des) / 100) * WK * scale);
  const reclaimed =
    delta(alloc.current.ops, alloc.desired.ops, 0.9) +
    delta(alloc.current.finance, alloc.desired.finance, 1.0) +
    delta(alloc.current.sales, alloc.desired.sales, 0.75) +
    delta(alloc.current.relationships, alloc.desired.relationships, 0.45);
  return Math.min(35, Math.max(1, Math.round(reclaimed)));
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
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Content is required" });
  }

  const userMsg = makeMessage("user", content);
  session.messages.push(userMsg);
  session.questionCount += 1;

  const nextQuestionIndex = session.questionCount;
  const readyForAnalysis = nextQuestionIndex >= QUESTIONS.length;

  let assistantMsg: Message;

  if (readyForAnalysis) {
    assistantMsg = makeMessage(
      "assistant",
      "We understand and hear you. Let's figure out how to further gain your time back."
    );
    session.phase = "analysis";
    session.isComplete = true;
  } else {
    const { content: nextContent, type: nextType } = buildNextMessage(
      nextQuestionIndex,
      content
    );
    assistantMsg = makeMessage("assistant", nextContent, nextType);
  }

  session.messages.push(assistantMsg);
  res.json({ message: assistantMsg, session, readyForAnalysis });
});

router.post("/conversation/:sessionId/analyze", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });

  session.phase = "complete";

  const alloc = parseAllocation(session.messages);
  const q1Answer = session.messages.find((m) => m.role === "user")?.content ?? "";

  // Find Q4 (income) answer — the second user text message after the allocation form
  const userMessages = session.messages.filter((m) => m.role === "user");
  // userMessages[0] = Q1, [1] = Q2, [2] = allocation form, [3] = income, [4] = team
  const incomeText = userMessages[3]?.content ?? "";
  const annualIncome = parseIncome(incomeText) ?? 100_000; // fallback only if truly unparseable

  // Martell's Buyback Rate: income / 2000 working hours per year
  const buybackRate = annualIncome / 2_000;
  // ¼ Rule: max hourly delegation cost should be ≤ 1/4 of buyback rate
  const quarterRate = buybackRate / 4;

  const tasks = selectTasks(alloc, q1Answer, buybackRate);
  const totalHoursReclaimed = computeTotalReclaimed(alloc, tasks);

  const totalCost  = tasks.reduce((s, t) => s + t.estimatedCostPerMonth, 0);
  const totalValue = tasks.reduce((s, t) => s + t.timeValuePerMonth, 0);
  const top3Cost   = tasks.slice(0, 3).reduce((s, t) => s + t.estimatedCostPerMonth, 0);
  const overallRoi = Math.round(buybackRate / (totalCost / tasks.reduce((s, t) => s + t.hoursPerWeek * 4, 0) || 1));

  const report = {
    sessionId: session.sessionId,
    founderName: "",
    businessType: "Service Business",
    totalHoursReclaimed,
    annualIncome,
    buybackRate: Math.round(buybackRate),
    quarterRate: Math.round(quarterRate),
    tasks,
    summary: `Based on what you shared, you're spending roughly ${totalHoursReclaimed} hours a week on work that doesn't need to be yours. At your Buyback Rate of $${Math.round(buybackRate)}/hr, that's $${(totalHoursReclaimed * 4 * Math.round(buybackRate)).toLocaleString()}/month in time cost. Delegating the top three items would run about $${top3Cost.toLocaleString()}/month — an immediate ${overallRoi}x return.`,
    nextStep:
      "Start with the highest-ranked item on this list. Pick one thing, hire or systemize for it this week, and let the momentum build. That first delegation decision is always the hardest — and the most valuable.",
  };

  res.json(report);
});

export default router;
