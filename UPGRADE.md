To keep Synapse focused and deployable, the key is not trying to build a full “AI project OS” immediately. Instead, ship a tight V1 with three high-leverage capabilities that feel magical but remain technically achievable.

Below is a refined plan that:
	•	focuses on 3 major improvements
	•	keeps the system conceptually simple
	•	leads to a clear deployable product
	•	supports free-tier LLM usage (Gemini or alternatives)

⸻

Synapse V1 → V2 Evolution Plan

The idea is to turn Synapse into:

A visual AI system that converts ideas into build-ready development artifacts.

The three improvements below form a complete pipeline:

Idea
  ↓
PRD
  ↓
Development Plan
  ↓
Agent Prompts


⸻

1️⃣ Structured PRD Engine

Problem Today

Right now the PRD is large generated text.

That makes it hard to:
	•	derive milestones
	•	generate prompts
	•	evolve specific sections
	•	track changes

⸻

Improvement

Convert the PRD into structured sections stored as nodes.

Example internal schema:

type PRD = {
  vision: string
  targetUsers: string[]
  coreProblem: string
  features: Feature[]
  architecture: string
  risks: string[]
}

type Feature = {
  name: string
  description: string
  userValue: string
  complexity: "low" | "medium" | "high"
}

Each section becomes editable + branchable in Synapse.

⸻

Why This Matters

Once structured, you can programmatically derive:
	•	milestones
	•	UI specs
	•	engineering tasks
	•	prompts

This becomes the foundation for everything else.

⸻

User Flow

User enters project idea
↓
Synapse generates structured PRD
↓
User refines nodes
↓
User branches alternative feature ideas
↓
User consolidates into canonical PRD


⸻

2️⃣ Development Plan Generator

Once the PRD is structured, Synapse can produce a build plan.

This becomes the second core artifact.

⸻

Input

Structured PRD.

⸻

Output

A milestone-based development roadmap.

Example:

Milestone 1 — Core Architecture
• Choose framework
• Define data model
• Implement project scaffolding

Milestone 2 — Core Feature Set
• Feature A
• Feature B
• Feature C

Milestone 3 — UX and polish
• UI improvements
• error handling
• documentation

Each milestone becomes its own node in Synapse.

⸻

Why This Matters

Users now get a clear engineering roadmap, not just ideas.

This dramatically increases the perceived usefulness.

⸻

Visual Representation

Your graph now becomes:

Idea
  ↓
PRD
  ↓
Milestones
  ↓
Tasks


⸻

3️⃣ Coding Agent Prompt Generator

This is where Synapse becomes extremely useful.

From a milestone or task node, the user can generate:
	•	Cursor prompts
	•	Codex prompts
	•	Claude prompts
	•	GitHub Copilot prompts

⸻

Example Output

Branch: feature/user-authentication

Objective:
Implement user authentication using JWT.

Tasks:
• Create user table
• Implement login endpoint
• Implement signup endpoint
• Add session handling

Constraints:
• Use Node.js
• Use PostgreSQL
• Maintain REST architecture

Verification:
• Users can sign up
• Users can log in
• Invalid tokens rejected


⸻

This Is Very Powerful Because

You already do this manually.

Synapse automates it.

It becomes:

idea → build-ready prompts


⸻

Resulting System

Your system pipeline becomes:

Idea
↓
PRD
↓
Development Plan
↓
Agent Prompts
↓
Code Implementation

This is a complete loop.

⸻

Deployment Plan

Now let’s focus on how to ship this publicly.

⸻

Architecture for Deployment

Frontend

Current stack is perfect:

React
Vite
Zustand

Deploy to:

Vercel


⸻

Backend

Add a minimal serverless layer.

Purpose:
	•	hide API keys
	•	proxy LLM calls

⸻

Example

/api/generate-prd
/api/generate-milestones
/api/generate-agent-prompts

Each endpoint calls Gemini or other models.

⸻

Free LLM Options for Users

You want users to be able to bring their own free API key.

Best Options

Model	Free Tier	Good For
Gemini	generous	PRD generation
OpenRouter	multiple models	fallback
Groq	very fast	structured outputs


⸻

Recommended Default

Gemini

Specifically:

gemini-1.5-flash

It has:
	•	generous free tier
	•	strong reasoning
	•	cheap tokens

⸻

User Setup Flow

When a user opens Synapse:

Step 1

Prompt:

Enter your LLM API key

Options:
	•	Gemini
	•	OpenRouter
	•	Groq

⸻

Step 2

Store key in:

localStorage

OR encrypted cookie.

⸻

Step 3

Requests flow through server proxy.

Frontend
↓
Vercel serverless
↓
LLM provider

This prevents exposing keys.

⸻

Example Gemini Setup Instructions

Inside Synapse you show:

How to get a free Gemini API key

1. Visit:
https://aistudio.google.com/app/apikey

2. Create an API key

3. Paste it below

Most users can do this in 30 seconds.

⸻

Estimated Infrastructure Cost

For you as the host:

Vercel free tier
+
user provides API key

Cost = $0

⸻

Clean V1 Scope

To keep this deployable, the V1 should include:

Core

✔ idea → PRD generation
✔ PRD → milestone plan
✔ milestone → agent prompts

UI

✔ node branching
✔ branch consolidation
✔ export artifacts

Deployment

✔ Vercel deployment
✔ Gemini integration

⸻

Example User Experience

User opens Synapse.

They type:

I want to build a habit tracking app for ADHD users.

Synapse generates:
PRD → Milestones → Dev prompts.
User exports prompts into Cursor and builds the app.

