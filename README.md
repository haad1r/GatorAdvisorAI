# GatorAdvisor AI
**An AI-Assisted Academic Planner for UF Students**
Built by the GatorAdvisor GatorAI Project Team

---

## Goal
Create an AI-assisted academic planner for UF students.

GatorAdvisor AI computes a real degree audit and ranked schedule recommendations with deterministic engines. It then uses AI only to explain those results conversationally.

---

## Problem It Solves
- UF students have to manually reconcile degree requirements, prerequisites, Gen Ed, Critical Tracking deadlines, and course scheduling across multiple semesters.
- Registration can be hard to navigate with all the requirements a major has, especially for freshmen. GatorAdvisor gives students a clearer idea of what is expected.
- Students also have no easy way to find courses that match their interests or to know which professors fit how they learn.

---

## Main Features

### Core Planning
Degree audit, multi-semester pipeline, and What-If simulation.

### Transcript Import
Upload a UF transcript to automatically load the courses a student has already completed. The student confirms the parsed courses before they are saved. Only course codes, grades, and credits are stored; the PDF is discarded after parsing.

### Schedule Builder
Build, save, and compare weekly schedules for each term, with conflict detection.

### Registration Planner
Assemble and validate schedules before registration.

### Discovery
Course explorer, prerequisites, a visual dependency graph, and the recommendation engine.

### ML Course Recommendations
Recommends classes based on each student's interests, collected from an interest survey, and on professor ratings. It only suggests courses the student is eligible to take.

### Professor Pages
GatorAdvisor's own multi-axis ratings and student reviews.

### Official Integration
Direct links out to official UF and RMP pages without scraping RMP content.

### AI Advisor
A grounded conversational assistant designed to explain complex academic paths clearly.

### Real-Time Tech
Live tool calling, conversational streaming, and persistent dialogue history.

### Safety & Reliability
Deterministic grounding verification with a safe conversational fallback mode.

---

## Key Technology Used
- **Deterministic rules engine** for degree audits (prerequisites, GPA, Gen Ed, Critical Tracking)
- **Backtracking search** for schedule generation, plus **multi-factor ranking** for recommendations
- **ML recommendation model** that matches interest-survey results to course content and blends in professor ratings
- **Transcript parser** that extracts completed courses from an uploaded transcript
- **AI layer** (Gemini, with OpenAI as fallback) that generates natural-language explanations of what the engines already computed
- **Grounding technique:** A "Fact Pack" of pre-verified data points is injected into the prompt. A post-generation validator then checks every claim in the AI's answer against that data before showing it to the student, to avoid hallucination.
- **Stack:** Next.js (full-stack React), Supabase (managed PostgreSQL) with Prisma as the ORM layer, Clerk for authentication, and Python for the ML service

---

## 10-Week Semester Schedule

| Weeks | Focus |
|-------|-------|
| **01–03** | Brainstorm and research, architecture and UF data, start frontend, draft interest survey |
| **04–05** | Build out core features (audit engine, scheduler, transcript parser), continue frontend, database, auth |
| **06–08** | Integrate frontend with backend and AI + RAG, connect ML recommendations, remaining features |
| **09** | Testing, QA, fix issues |
| **10** | Polish, deploy, document |

---

## Repository Structure
```
gatoradvisor-ai/
├── .github/            # PR/issue templates, CODEOWNERS
├── app/                # Next.js pages and API routes
├── components/         # UI components
├── lib/
│   ├── engines/        # Audit, scheduler, ranking
│   ├── transcript/     # Transcript parser
│   ├── ai/             # Gemini/OpenAI, Fact Pack, validator
│   └── db/             # Prisma client and queries
├── prisma/             # Database schema and seed data
├── ml/                 # Python recommendation service
├── data/               # UF catalog and requirement data
├── tests/
└── docs/
```

---

## Getting Started
```bash
git clone <repo-url>
cd gatoradvisor-ai
git checkout dev
cp .env.example .env.local      # get the values from the project lead
npm install
npx prisma generate
npm run dev
```

**ML service:**
```bash
cd ml
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

**Never commit `.env.local`, API keys, or real student transcripts.**

---

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, commit, and pull request workflow.
