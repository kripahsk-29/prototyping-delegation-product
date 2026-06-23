import { useState, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useStartConversation,
  useSendMessage,
  useAnalyzeConversation,
} from "@workspace/api-client-react";
import type {
  Message,
  DelegationReport,
  DelegationTask,
} from "@workspace/api-client-react/src/generated/api.schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Send,
  ArrowRight,
  Loader2,
  RefreshCcw,
  Play,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  Star,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const queryClient = new QueryClient();

type Screen = "landing" | "chat" | "report";

const DRIP_COLORS: Record<string, string> = {
  D: "#4e8c61",
  R: "#4a7ab5",
  I: "#7c5cbf",
  P: "#c27c2c",
};

const dripBgClass: Record<string, string> = {
  D: "bg-primary text-primary-foreground",
  R: "bg-blue-600 text-white",
  I: "bg-purple-600 text-white",
  P: "bg-orange-500 text-white",
};

function TimeMapNow({ report }: { report: DelegationReport }) {
  const delegatableHours = report.tasks.reduce(
    (sum, t) => sum + t.hoursPerWeek,
    0
  );
  const protectedHours = Math.max(0, 40 - delegatableHours);

  const chartData = [
    ...report.tasks.map((t) => ({
      name: t.taskName,
      value: t.hoursPerWeek,
      drip: t.drip,
      color: DRIP_COLORS[t.drip] ?? "#aaa",
      delegatable: true,
    })),
    {
      name: "Strategic / Growth Work",
      value: protectedHours,
      drip: "P",
      color: "#c8b882",
      delegatable: false,
    },
  ];

  const weaknesses = report.tasks.filter((t) => t.drip === "D" || t.drip === "R");
  const strengths = report.tasks.filter((t) => t.drip === "I" || t.drip === "P");

  return (
    <div
      className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
      data-testid="section-time-map-now"
    >
      <div className="text-center space-y-1">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Current State
        </p>
        <h3 className="text-2xl md:text-3xl font-serif text-foreground">
          Where your time goes right now
        </h3>
        <p className="text-muted-foreground text-sm max-w-lg mx-auto">
          Based on your responses, here's a breakdown of your typical 40-hour
          week — and how much of it is working against you.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 items-center">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={68}
                outerRadius={110}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value} hrs/wk`,
                  name,
                ]}
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--card))",
                  color: "hsl(var(--foreground))",
                  fontSize: "13px",
                }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(value) =>
                  value.length > 24 ? value.slice(0, 24) + "…" : value
                }
                wrapperStyle={{ fontSize: "12px" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-4">
          <div
            className="bg-destructive/8 border border-destructive/20 rounded-2xl p-4 space-y-2"
            data-testid="section-weaknesses"
          >
            <div className="flex items-center gap-2 text-destructive/80 font-medium text-sm">
              <AlertCircle className="w-4 h-4" />
              Time drains (delegate these)
            </div>
            {weaknesses.map((t) => (
              <div key={t.rank} className="flex items-center justify-between">
                <span className="text-sm text-foreground/80">{t.taskName}</span>
                <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {t.hoursPerWeek} hrs/wk
                </span>
              </div>
            ))}
          </div>

          <div
            className="bg-primary/8 border border-primary/20 rounded-2xl p-4 space-y-2"
            data-testid="section-strengths"
          >
            <div className="flex items-center gap-2 text-primary font-medium text-sm">
              <Star className="w-4 h-4" />
              Your zone of genius (protect these)
            </div>
            <p className="text-sm text-foreground/80">
              Strategic decisions, client relationships, and vision-setting —
              the work only you can do.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground/80">
                Strategic / Growth Work
              </span>
              <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {protectedHours} hrs/wk
              </span>
            </div>
            {strengths.map((t) => (
              <div key={t.rank} className="flex items-center justify-between">
                <span className="text-sm text-foreground/80">{t.taskName}</span>
                <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {t.hoursPerWeek} hrs/wk
                </span>
              </div>
            ))}
          </div>

          <div
            className="bg-accent/30 border border-accent/40 rounded-2xl p-4 flex items-center gap-3"
            data-testid="section-team"
          >
            <Users className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm text-foreground/80">
              <span className="font-medium">Your team right now:</span> You're
              largely operating solo — wearing every hat. That's the core
              constraint this plan addresses.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimeMapFuture({ report }: { report: DelegationReport }) {
  const delegatedHours = report.tasks.reduce(
    (sum, t) => sum + t.hoursPerWeek,
    0
  );
  const currentProtected = Math.max(0, 40 - delegatedHours);
  const futureGrowth = currentProtected + delegatedHours;

  const futureChartData = [
    {
      name: "Strategic / Growth Work",
      value: futureGrowth,
      color: "#4e8c61",
    },
    { name: "Email oversight", value: 1, color: "#a3c4a8" },
    { name: "Social review", value: 0.5, color: "#b8d4bc" },
    { name: "Admin oversight", value: 0.5, color: "#cce0cf" },
    { name: "Financial review", value: 0.5, color: "#d8e8da" },
    { name: "Check-ins", value: 0.5, color: "#e3eee5" },
  ];

  const totalDelegatedCost = report.tasks.reduce(
    (sum, t) => sum + t.estimatedCostPerMonth,
    0
  );
  const totalTimeValueReclaimed = report.tasks.reduce(
    (sum, t) => sum + t.timeValuePerMonth,
    0
  );
  const quarterHours = report.totalHoursReclaimed * 12;

  return (
    <div
      className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
      data-testid="section-time-map-future"
    >
      <div className="text-center space-y-1">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          End of Quarter
        </p>
        <h3 className="text-2xl md:text-3xl font-serif text-foreground">
          Your week, reclaimed
        </h3>
        <p className="text-muted-foreground text-sm max-w-lg mx-auto">
          If you start delegating in the next two weeks, this is what your
          typical 40-hour week looks like by the end of the quarter.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 items-center">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={futureChartData}
                cx="50%"
                cy="50%"
                innerRadius={68}
                outerRadius={110}
                paddingAngle={2}
                dataKey="value"
              >
                {futureChartData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value} hrs/wk`,
                  name,
                ]}
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--card))",
                  color: "hsl(var(--foreground))",
                  fontSize: "13px",
                }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(value) =>
                  value.length > 24 ? value.slice(0, 24) + "…" : value
                }
                wrapperStyle={{ fontSize: "12px" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-4">
          <div
            className="bg-primary/10 border border-primary/25 rounded-2xl p-5 space-y-3"
            data-testid="section-future-gains"
          >
            <div className="flex items-center gap-2 text-primary font-medium text-sm">
              <TrendingUp className="w-4 h-4" />
              What you gain this quarter
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background rounded-xl p-3 text-center">
                <div className="font-serif text-2xl text-primary">
                  {quarterHours}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  hours freed
                </div>
              </div>
              <div className="bg-background rounded-xl p-3 text-center">
                <div className="font-serif text-2xl text-primary">
                  ${(totalTimeValueReclaimed * 3).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  time value reclaimed
                </div>
              </div>
              <div className="bg-background rounded-xl p-3 text-center">
                <div className="font-serif text-2xl text-primary">
                  ${(totalDelegatedCost * 3).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  delegation cost
                </div>
              </div>
              <div className="bg-background rounded-xl p-3 text-center">
                <div className="font-serif text-2xl text-primary">
                  {Math.round(totalTimeValueReclaimed / totalDelegatedCost)}x
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  avg ROI
                </div>
              </div>
            </div>
          </div>

          <div
            className="bg-accent/30 border border-accent/40 rounded-2xl p-4 space-y-2"
            data-testid="section-future-focus"
          >
            <p className="text-sm font-medium text-foreground">
              Where your energy goes instead
            </p>
            {[
              "Building client relationships",
              "Product and service development",
              "Business development and growth",
              "Team leadership and vision",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm text-foreground/80">
                <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCards({ report }: { report: DelegationReport }) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Your Plan
        </p>
        <h3 className="text-2xl md:text-3xl font-serif text-foreground">
          What to hand off, and to whom
        </h3>
      </div>
      {report.tasks.map((task) => (
        <Card
          key={task.rank}
          className="overflow-hidden border-border/60 shadow-sm hover:shadow-md transition-shadow duration-300 rounded-3xl"
          data-testid={`card-task-${task.rank}`}
        >
          <CardContent className="p-0 sm:flex">
            <div className="p-6 md:p-8 sm:w-2/3 border-b sm:border-b-0 sm:border-r border-border/40 space-y-4">
              <div className="flex items-center space-x-3 mb-2">
                <Badge
                  variant="outline"
                  className="bg-background text-muted-foreground font-medium rounded-full px-3"
                  data-testid={`badge-rank-${task.rank}`}
                >
                  #{task.rank}
                </Badge>
                <Badge
                  className={cn("rounded-full px-3 font-medium", dripBgClass[task.drip])}
                  data-testid={`badge-drip-${task.rank}`}
                >
                  {task.dripLabel}
                </Badge>
              </div>
              <div>
                <h4
                  className="text-xl md:text-2xl font-serif text-foreground mb-2"
                  data-testid={`text-task-name-${task.rank}`}
                >
                  {task.taskName}
                </h4>
                <p
                  className="text-muted-foreground leading-relaxed"
                  data-testid={`text-task-desc-${task.rank}`}
                >
                  {task.description}
                </p>
              </div>
              <div className="bg-muted/50 p-4 rounded-2xl">
                <p
                  className="text-sm text-foreground/80 italic font-serif"
                  data-testid={`text-task-why-${task.rank}`}
                >
                  "{task.whyDelegate}"
                </p>
              </div>
            </div>
            <div className="p-6 md:p-8 sm:w-1/3 bg-background flex flex-col justify-center space-y-6">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                  Time Cost
                </div>
                <div className="text-lg font-medium text-foreground">
                  {task.hoursPerWeek} hrs/week
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                  Who Takes It
                </div>
                <div className="text-lg font-medium text-foreground">
                  {task.roleType}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                  Payoff
                </div>
                <div className="text-xl font-serif text-primary">{task.roi}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ElevateApp() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [report, setReport] = useState<DelegationReport | null>(null);
  const [readyForAnalysis, setReadyForAnalysis] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const startConversation = useStartConversation();
  const sendMessage = useSendMessage();
  const analyzeConversation = useAnalyzeConversation();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sendMessage.isPending]);

  const handleStart = () => {
    startConversation.mutate(undefined, {
      onSuccess: (session) => {
        setSessionId(session.sessionId);
        if (session.messages) {
          setMessages(session.messages);
        }
        setScreen("chat");
      },
    });
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !sessionId || sendMessage.isPending) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");

    sendMessage.mutate(
      { sessionId, data: { content: userMessage.content } },
      {
        onSuccess: (response) => {
          setMessages((prev) => [...prev, response.message]);
          setReadyForAnalysis(response.readyForAnalysis);
        },
      }
    );
  };

  const handleAnalyze = () => {
    if (!sessionId) return;
    analyzeConversation.mutate(
      { sessionId },
      {
        onSuccess: (data) => {
          setReport(data);
          setScreen("report");
        },
      }
    );
  };

  const handleStartOver = () => {
    setScreen("landing");
    setSessionId(null);
    setMessages([]);
    setReport(null);
    setReadyForAnalysis(false);
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center selection:bg-primary/20 bg-background text-foreground relative overflow-hidden">
      <header className="w-full max-w-4xl mx-auto p-6 md:p-8 flex justify-between items-center shrink-0 z-10">
        <div
          className="font-serif text-2xl font-semibold text-primary tracking-tight"
          data-testid="text-logo"
        >
          Elevate
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-6 pb-12 md:px-8 flex flex-col justify-center z-10">
        {/* ── LANDING ── */}
        {screen === "landing" && (
          <div className="max-w-2xl mx-auto text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <h1
              className="text-4xl md:text-6xl font-serif text-foreground leading-tight"
              data-testid="text-landing-heading"
            >
              Let's figure out what's{" "}
              <span className="text-primary italic">eating your time.</span>
            </h1>
            <p
              className="text-lg md:text-xl text-muted-foreground font-sans max-w-xl mx-auto leading-relaxed"
              data-testid="text-landing-subhead"
            >
              Burned out by the endless side tasks? Confused about where to
              hand off what exactly? Discover the potential hiding behind all
              that lost time.
            </p>
            <div className="pt-8">
              <Button
                onClick={handleStart}
                disabled={startConversation.isPending}
                size="lg"
                className="rounded-full px-8 py-6 text-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all"
                data-testid="button-begin"
              >
                {startConversation.isPending ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <Play className="w-5 h-5 mr-2 fill-current" />
                )}
                Begin the conversation
              </Button>
            </div>
          </div>
        )}

        {/* ── CHAT ── */}
        {screen === "chat" && (
          <div className="w-full max-w-2xl mx-auto flex flex-col h-[75vh] bg-card rounded-3xl shadow-sm border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-500">
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 scroll-smooth">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex w-full animate-in fade-in slide-in-from-bottom-2",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                  data-testid={`message-${msg.role}-${msg.id}`}
                >
                  <div
                    className={cn(
                      "max-w-[85%] px-5 py-4 text-[15px] md:text-base shadow-sm",
                      msg.role === "user"
                        ? "bg-accent text-accent-foreground rounded-2xl rounded-tr-sm"
                        : "bg-muted text-foreground rounded-2xl rounded-tl-sm"
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {sendMessage.isPending && (
                <div
                  className="flex w-full justify-start animate-in fade-in"
                  data-testid="indicator-typing"
                >
                  <div className="max-w-[80%] px-5 py-4 bg-muted text-foreground rounded-2xl rounded-tl-sm flex items-center space-x-2 shadow-sm">
                    <div
                      className="w-2 h-2 rounded-full bg-primary/40 animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <div
                      className="w-2 h-2 rounded-full bg-primary/40 animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <div
                      className="w-2 h-2 rounded-full bg-primary/40 animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 md:p-6 bg-card border-t border-border/50">
              {readyForAnalysis && !analyzeConversation.isPending ? (
                <div className="flex flex-col items-center justify-center p-4 space-y-4 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex items-center text-primary font-medium">
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    I have enough to build your plan.
                  </div>
                  <Button
                    onClick={handleAnalyze}
                    className="w-full sm:w-auto rounded-full px-8 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
                    size="lg"
                    data-testid="button-analyze"
                  >
                    See my delegation plan{" "}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              ) : analyzeConversation.isPending ? (
                <div className="flex flex-col items-center justify-center p-6 space-y-4 text-muted-foreground animate-in fade-in">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="font-serif italic text-lg text-foreground">
                    Crafting your delegation plan...
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={handleSendMessage}
                  className="relative flex items-center"
                >
                  <Input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Type your response..."
                    className="pr-12 py-6 text-base rounded-2xl bg-background border-border shadow-inner focus-visible:ring-primary/20"
                    disabled={sendMessage.isPending}
                    data-testid="input-chat"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    variant="ghost"
                    className="absolute right-2 text-primary hover:bg-primary/10 hover:text-primary rounded-xl"
                    disabled={!inputValue.trim() || sendMessage.isPending}
                    data-testid="button-send-message"
                  >
                    <Send className="w-5 h-5" />
                  </Button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* ── REPORT ── */}
        {screen === "report" && report && (
          <div className="w-full max-w-3xl mx-auto space-y-16 animate-in fade-in slide-in-from-bottom-8 duration-700 py-8">
            {/* Header */}
            <div className="space-y-4 text-center">
              <h2
                className="text-4xl md:text-5xl font-serif text-foreground"
                data-testid="text-report-heading"
              >
                Here's your delegation plan
                {report.founderName ? `, ${report.founderName}` : ""}.
              </h2>
              <p
                className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
                data-testid="text-report-summary"
              >
                {report.summary}
              </p>
            </div>

            {/* Hours callout */}
            <div className="flex justify-center">
              <div className="bg-accent/50 text-accent-foreground px-8 py-6 rounded-3xl inline-flex flex-col items-center border border-accent">
                <span className="text-sm font-medium uppercase tracking-widest opacity-80 mb-2">
                  Hours Reclaimed Per Week
                </span>
                <span
                  className="font-serif text-5xl md:text-6xl text-primary"
                  data-testid="text-report-hours"
                >
                  {report.totalHoursReclaimed}{" "}
                  <span className="text-2xl text-foreground font-sans">
                    hrs/wk
                  </span>
                </span>
              </div>
            </div>

            {/* ── SECTION 1: Current time map ── */}
            <div className="bg-card border border-border/60 rounded-3xl p-6 md:p-8 shadow-sm">
              <TimeMapNow report={report} />
            </div>

            {/* Divider with label */}
            <div className="flex items-center gap-4">
              <div className="flex-1 border-t border-border/60" />
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground shrink-0 px-2">
                Your Delegation Plan
              </span>
              <div className="flex-1 border-t border-border/60" />
            </div>

            {/* ── SECTION 2: Task cards ── */}
            <TaskCards report={report} />

            {/* Divider with label */}
            <div className="flex items-center gap-4">
              <div className="flex-1 border-t border-border/60" />
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground shrink-0 px-2">
                End of Quarter
              </span>
              <div className="flex-1 border-t border-border/60" />
            </div>

            {/* ── SECTION 3: Future time map ── */}
            <div className="bg-card border border-border/60 rounded-3xl p-6 md:p-8 shadow-sm">
              <TimeMapFuture report={report} />
            </div>

            {/* Next step CTA */}
            <div className="pt-4 pb-12 border-t border-border flex flex-col items-center text-center space-y-8">
              <h3 className="text-2xl font-serif text-foreground">
                Ready to take the next step?
              </h3>
              <p
                className="text-lg text-muted-foreground max-w-xl mx-auto"
                data-testid="text-report-next-step"
              >
                {report.nextStep}
              </p>

              <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4 pt-4">
                <Button
                  size="lg"
                  className="rounded-full px-8 py-6 text-base bg-foreground hover:bg-foreground/90 text-background shadow-lg"
                  data-testid="button-action"
                  onClick={() =>
                    alert("This would link to the actual handoff workflow.")
                  }
                >
                  Start Handoff
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleStartOver}
                  className="rounded-full px-6 text-muted-foreground hover:text-foreground"
                  data-testid="button-start-over"
                >
                  <RefreshCcw className="w-4 h-4 mr-2" />
                  Start over
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Decorative blobs */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px] pointer-events-none -z-10" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-accent/20 blur-[120px] pointer-events-none -z-10" />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ElevateApp />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
