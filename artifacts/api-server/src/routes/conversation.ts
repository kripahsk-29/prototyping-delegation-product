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

// 4 turns total: Q1 (text), Q2 (text), Q3 (allocation_form), Q4 (text)
const QUESTIONS: QuestionDef[] = [
  {
    content:
      "Hey there — let's figure out what's eating your time. Walk me through a typical week: what are you spending your time on, day to day?",
    msgType: "text",
  },
  {
    content:
      "Got it. Now flip that around — if you had a completely clear day with zero tasks on your plate, how would you spend it to actually grow your business?",
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

function extractSnippet(text: string, maxWords = 6): string {
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
  const words = firstSentence.split(/\s+/).filter(Boolean);
  const slice = words.slice(0, maxWords).join(" ");
  return words.length > maxWords ? slice + "…" : slice;
}

function buildNextMessage(
  nextQuestionIndex: number,
  userAnswer: string
): { content: string; type: "text" | "allocation_form" } {
  const nextQ = QUESTIONS[nextQuestionIndex];
  const snippet = extractSnippet(userAnswer);

  const bridges: Record<number, (s: string) => string> = {
    // After Q1 (typical week) → Q2 (ideal day)
    1: (s) =>
      `"${s}" — sounds like your week is full before it even starts. That's really useful context.\n\n` +
      nextQ.content,

    // After Q2 (ideal day) → Q3 (allocation form)
    2: (s) =>
      `That's a clear picture of where you want your energy going. Keeping "${s}" in mind — let's get specific about where your time actually goes right now:`,

    // After Q3 form submission → Q4 (team + prior delegation)
    3: () =>
      `That breakdown is really telling — the gap between current and desired is exactly where we focus.\n\nOne last thing:\n\n` +
      nextQ.content,
  };

  const bridge = bridges[nextQuestionIndex];
  // For allocation_form, the bridge IS the full content (widget renders the form)
  const content = bridge ? bridge(snippet) : nextQ.content;

  return { content, type: nextQ.msgType };
}

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
      "Thank you for sharing all of that — I have a really clear picture now. Give me just a moment to map everything through the DRIP framework and build your personalized delegation plan..."
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

  const report = {
    sessionId: session.sessionId,
    founderName: "",
    businessType: "Service Business",
    totalHoursReclaimed: 23,
    tasks: [
      {
        rank: 1,
        taskName: "Email Management & Scheduling",
        description:
          "Triaging inbox, responding to routine inquiries, booking meetings, and sending follow-up emails — consuming your first and last hour of every day.",
        drip: "D",
        dripLabel: "Delegate",
        hoursPerWeek: 8,
        roleType: "Executive/Virtual Assistant",
        estimatedCostPerMonth: 800,
        timeValuePerMonth: 3200,
        roi: "4x return — you get $3,200 worth of your time back for $800/mo",
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
        hoursPerWeek: 5,
        roleType: "Social Media VA / Content Assistant",
        estimatedCostPerMonth: 500,
        timeValuePerMonth: 2000,
        roi: "4x return — reclaim $2,000 of your time for $500/mo",
        whyDelegate:
          "You set the strategy and voice; someone else handles scheduling and posting. Batching content creation weekly with an assistant cuts this from 5 hours to a 30-minute review.",
      },
      {
        rank: 3,
        taskName: "Client Onboarding Admin",
        description:
          "Sending welcome packets, scheduling kick-off calls, collecting intake forms, and setting up project folders every time a new client signs.",
        drip: "R",
        dripLabel: "Replace with a System",
        hoursPerWeek: 4,
        roleType: "EA + Automation (e.g. HoneyBook, Dubsado)",
        estimatedCostPerMonth: 600,
        timeValuePerMonth: 1600,
        roi: "2.7x return — save $1,600 of your time for $600/mo",
        whyDelegate:
          "This is 100% repeatable. A good EA paired with a simple CRM can run your entire onboarding without you — clients still feel taken care of, and you only appear at the relationship moments that matter.",
      },
      {
        rank: 4,
        taskName: "Bookkeeping & Invoicing",
        description:
          "Logging expenses, categorizing transactions, chasing late invoices, and preparing reports for your accountant.",
        drip: "I",
        dripLabel: "Invest in a Specialist",
        hoursPerWeek: 3,
        roleType: "Part-time Bookkeeper",
        estimatedCostPerMonth: 400,
        timeValuePerMonth: 1200,
        roi: "3x return — reclaim $1,200 of your time for $400/mo",
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
        hoursPerWeek: 3,
        roleType: "Virtual Assistant",
        estimatedCostPerMonth: 300,
        timeValuePerMonth: 1200,
        roi: "4x return — reclaim $1,200 of your time for $300/mo",
        whyDelegate:
          "Clients value consistency, not just you personally. An EA using your templates maintains the relationship warmth while you focus on the high-value conversations.",
      },
    ],
    summary:
      "Based on your week, you're spending roughly 23 hours on tasks that don't need you specifically — that's more than half a full-time week. If you delegated just the top 3 items, you'd reclaim 17 hours a week for under $2,000/month. At your current hourly value, that's an immediate 3–4x return.",
    nextStep:
      "Start with one hire: an Executive Assistant who can own your inbox, scheduling, and client onboarding. That single decision reclaims the most time for the least coordination overhead — and it's the move that Elevate's EA partners specialize in.",
  };

  res.json(report);
});

export default router;
