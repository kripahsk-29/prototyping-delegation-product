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

// 4 turns: Q1 (text), Q2 (text), Q3 (allocation_form), Q4 (text)
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

  // Bridges acknowledge the answer without echoing words back verbatim
  const bridges: Record<number, () => string> = {
    // After Q1 (typical week) → Q2 (ideal day)
    1: () => {
      const wordCount = userAnswer.trim().split(/\s+/).length;
      const opener =
        wordCount > 30
          ? "That's a lot to be carrying — and it paints a very clear picture."
          : "Got it — that's really useful to know.";
      return `${opener}\n\n` + nextQ.content;
    },

    // After Q2 (ideal day) → Q3 (allocation form)
    2: () =>
      `That's a clear vision. Now let's map out where your time actually goes today:`,

    // After Q3 form submission → Q4 (team + prior delegation)
    3: () =>
      `That breakdown is really telling. The gap between where you are and where you want to be is exactly what we'll close.\n\n` +
      nextQ.content,
  };

  const bridge = bridges[nextQuestionIndex];
  const content = bridge ? bridge() : nextQ.content;
  return { content, type: nextQ.msgType };
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
    ops: parsePct(text, ["day-to-day operations", "operations"]),
    strategy: parsePct(text, ["business strategy", "strategy"]),
    relationships: parsePct(text, ["relationships / partnerships", "relationships"]),
    sales: parsePct(text, ["sales"]),
    finance: parsePct(text, ["finance / accounting", "finance"]),
  });

  return { current: extract(currentPart), desired: extract(desiredPart) };
}

// ── Compute personalized report numbers ─────────────────────────────────────

interface TaskNumbers {
  emailHrs: number;
  socialHrs: number;
  onboardingHrs: number;
  bookkeepingHrs: number;
  followupHrs: number;
  totalReclaimed: number;
}

function computeTaskNumbers(alloc: Allocation | null): TaskNumbers {
  const WK = 40; // assumed weekly hours

  if (!alloc) {
    // Defaults when no allocation data available
    return { emailHrs: 8, socialHrs: 5, onboardingHrs: 4, bookkeepingHrs: 3, followupHrs: 3, totalReclaimed: 23 };
  }

  const opsHrs = (alloc.current.ops / 100) * WK;
  const financeHrs = (alloc.current.finance / 100) * WK;
  const relHrs = (alloc.current.relationships / 100) * WK;

  const opsDesiredHrs = (alloc.desired.ops / 100) * WK;
  const financeDesiredHrs = (alloc.desired.finance / 100) * WK;
  const relDesiredHrs = (alloc.desired.relationships / 100) * WK;

  // Split ops hours across email, social, onboarding
  const emailHrs  = Math.max(1, Math.round(opsHrs * 0.40));
  const socialHrs = Math.max(1, Math.round(opsHrs * 0.25));
  const onboardingHrs = Math.max(1, Math.round(opsHrs * 0.22));
  const bookkeepingHrs = Math.max(1, Math.round(financeHrs));
  const followupHrs = Math.max(1, Math.round(relHrs * 0.40));

  // Reclaimed hours = delta on delegatable categories (cap at 35)
  const opsReclaimed     = Math.max(0, (opsHrs - opsDesiredHrs) * 0.9);
  const financeReclaimed = Math.max(0, financeHrs - financeDesiredHrs);
  const relReclaimed     = Math.max(0, (relHrs - relDesiredHrs) * 0.4);
  const totalReclaimed   = Math.min(35, Math.round(opsReclaimed + financeReclaimed + relReclaimed));

  return { emailHrs, socialHrs, onboardingHrs, bookkeepingHrs, followupHrs, totalReclaimed };
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
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  res.json(session);
});

router.post("/conversation/:sessionId/message", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

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

  res.json({
    message: assistantMsg,
    session,
    readyForAnalysis,
  });
});

router.post("/conversation/:sessionId/analyze", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  session.phase = "complete";

  const alloc = parseAllocation(session.messages);
  const t = computeTaskNumbers(alloc);

  // Monthly costs by role type (hrs/week × 4 weeks × rate)
  const emailCost        = Math.round(t.emailHrs * 4 * 22);        // EA ~$22/hr
  const socialCost       = Math.round(t.socialHrs * 4 * 18);       // Social VA ~$18/hr
  const onboardingCost   = Math.round(t.onboardingHrs * 4 * 22);   // EA ~$22/hr
  const bookkeepingCost  = Math.round(t.bookkeepingHrs * 4 * 35);  // Bookkeeper ~$35/hr
  const followupCost     = Math.round(t.followupHrs * 4 * 18);     // VA ~$18/hr

  // Owner's time value at $100/hr
  const ownerRate = 100;
  const emailValue       = Math.round(t.emailHrs * 4 * ownerRate);
  const socialValue      = Math.round(t.socialHrs * 4 * ownerRate);
  const onboardingValue  = Math.round(t.onboardingHrs * 4 * ownerRate);
  const bookkeepingValue = Math.round(t.bookkeepingHrs * 4 * ownerRate);
  const followupValue    = Math.round(t.followupHrs * 4 * ownerRate);

  const roiLabel = (value: number, cost: number) =>
    `${Math.round(value / cost)}x return — reclaim $${value.toLocaleString()} of your time for $${cost.toLocaleString()}/mo`;

  const totalDelegatedCost = emailCost + socialCost + onboardingCost + bookkeepingCost + followupCost;
  const totalTimeValue = emailValue + socialValue + onboardingValue + bookkeepingValue + followupValue;
  const overallRoi = Math.round(totalTimeValue / totalDelegatedCost);

  const report = {
    sessionId: session.sessionId,
    founderName: "",
    businessType: "Service Business",
    totalHoursReclaimed: t.totalReclaimed,
    tasks: [
      {
        rank: 1,
        taskName: "Email Management & Scheduling",
        description:
          "Triaging inbox, responding to routine inquiries, booking meetings, and sending follow-up emails — consuming your first and last hour of every day.",
        drip: "D",
        dripLabel: "Delegate",
        hoursPerWeek: t.emailHrs,
        roleType: "Executive / Virtual Assistant",
        estimatedCostPerMonth: emailCost,
        timeValuePerMonth: emailValue,
        roi: roiLabel(emailValue, emailCost),
        whyDelegate:
          "This is high-volume, low-judgment work. A trained EA can handle 90% of your inbox with a simple decision framework. You review and approve; you don't process.",
      },
      {
        rank: 2,
        taskName: "Social Media Posting & Scheduling",
        description:
          "Writing captions, resizing images, posting across platforms, and responding to comments — tasks that feel strategic but are mostly execution.",
        drip: "D",
        dripLabel: "Delegate",
        hoursPerWeek: t.socialHrs,
        roleType: "Social Media VA / Content Assistant",
        estimatedCostPerMonth: socialCost,
        timeValuePerMonth: socialValue,
        roi: roiLabel(socialValue, socialCost),
        whyDelegate:
          "You set the strategy and voice; someone else handles scheduling and posting. Batching content creation weekly with an assistant cuts this to a 30-minute review.",
      },
      {
        rank: 3,
        taskName: "Client Onboarding Admin",
        description:
          "Sending welcome packets, scheduling kick-off calls, collecting intake forms, and setting up project folders every time a new client signs.",
        drip: "R",
        dripLabel: "Replace with a System",
        hoursPerWeek: t.onboardingHrs,
        roleType: "EA + Automation (e.g. HoneyBook, Dubsado)",
        estimatedCostPerMonth: onboardingCost,
        timeValuePerMonth: onboardingValue,
        roi: roiLabel(onboardingValue, onboardingCost),
        whyDelegate:
          "This is 100% repeatable. A good EA paired with a simple CRM can run your entire onboarding without you — clients still feel taken care of, and you only appear at the moments that matter.",
      },
      {
        rank: 4,
        taskName: "Bookkeeping & Invoicing",
        description:
          "Logging expenses, categorizing transactions, chasing late invoices, and preparing reports for your accountant.",
        drip: "I",
        dripLabel: "Invest in a Specialist",
        hoursPerWeek: t.bookkeepingHrs,
        roleType: "Part-time Bookkeeper",
        estimatedCostPerMonth: bookkeepingCost,
        timeValuePerMonth: bookkeepingValue,
        roi: roiLabel(bookkeepingValue, bookkeepingCost),
        whyDelegate:
          "A bookkeeper does this faster and more accurately than you — and catches errors that cost you money. This also reduces your tax prep stress significantly.",
      },
      {
        rank: 5,
        taskName: "Routine Client Check-in Emails",
        description:
          "Sending weekly or bi-weekly status updates to existing clients, asking for feedback, and sharing project progress.",
        drip: "D",
        dripLabel: "Delegate",
        hoursPerWeek: t.followupHrs,
        roleType: "Virtual Assistant",
        estimatedCostPerMonth: followupCost,
        timeValuePerMonth: followupValue,
        roi: roiLabel(followupValue, followupCost),
        whyDelegate:
          "Clients value consistency, not just you personally. An EA using your templates maintains the relationship warmth while you focus on the high-value conversations.",
      },
    ],
    summary: `Based on your week, you're spending roughly ${t.totalReclaimed} hours on tasks that don't need you specifically. Delegating just the top three items would cost around $${(emailCost + socialCost + onboardingCost).toLocaleString()}/month and return ${overallRoi}x that in reclaimed time — immediately.`,
    nextStep:
      "Start with one hire: an Executive Assistant who can own your inbox, scheduling, and client onboarding. That single decision reclaims the most time for the least coordination overhead.",
  };

  res.json(report);
});

export default router;
