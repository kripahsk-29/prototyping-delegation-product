# Elevate - Delegation Prototype

A prototype built for Elevate's first AI-powered product: a conversational tool that helps small-business owners figure out not just *what* to delegate, but *how* and *where*. Users talk through how they spend their time, and the app turns that into a concrete delegation plan — a time breakdown, ranked tasks to hand off, a 90-day roadmap, and a "buyback rate" for what their time is actually worth.

## Background

This summer at Elevate, I was in charge of prototyping and presenting to 15+ stakeholders, then turning that feedback into decisions about what the final product should be — which features to build, which to cut. I took the market research I'd done and translated it into a visual, testable prototype, built in Replit as well as Claude Code so I could get something fast in front of users and keep iterating toward the real product. 

In addition, the main parts of our project included: my teammate leading the core AI + frontend, while I focused on building out the backend + security layer.

I learned a lot through this project, and it was really fun to see how AI can speed up the building journey, specifically for prototyping. Turning that into conversations where I had to translate business requirements into technical decisions taught me how to filter out necessary features based on time, client value, and what would help actually move Elevate forward!


## How to run: 

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start the API server

```bash
PORT=3000 pnpm --filter @workspace/api-server run dev
```

### 3. Start the frontend (in a second terminal)

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/elevate run dev
```

Open **http://localhost:5173**. The frontend proxies `/api` requests to the API server on port 3000, so both need to be running.

> The prototype's conversation logic runs entirely in-memory on the API server — no database or external AI API key is required to run it locally. `@workspace/db` (Postgres/Drizzle) is scaffolded in the workspace for the production build but isn't wired into this prototype.


## Where things live

- `artifacts/elevate` — the main product prototype (`src/App.tsx` holds the conversation → report flow)
- `artifacts/api-server` — Express API; conversation logic lives in `src/routes/conversation.ts`
- `artifacts/mockup-sandbox` — a separate canvas used for exploring early visual mockups
- `lib/api-spec` — OpenAPI spec (source of truth for the API contract)
- `lib/api-zod`, `lib/api-client-react` — generated Zod schemas and React Query hooks from the spec
- `lib/db` — Drizzle/Postgres schema, not used by the prototype's runtime yet
