# AI Ops Assistant — Feature Specification

**Branch:** `feature/ai-ops-assistant`
**Status:** In Development (not for production yet)
**Created:** 2026-04-11

---

## Overview

A conversational AI assistant embedded in the OpsCentral admin dashboard. Admins and managers can ask natural-language questions about operations — open jobs, property status, inventory, upcoming check-ins — and get answers backed by live Convex data.

## Why

Admins currently navigate multiple pages (dashboard, jobs, properties, inventory) to build a picture of what needs attention. The AI assistant consolidates this into a single conversational interface accessible from any page.

## User Stories

- "What's open today?" — Get a summary of today's cleaning jobs
- "What needs attention?" — See jobs awaiting approval, rework, overdue, low stock
- "Any check-ins coming up?" — View upcoming guest arrivals
- "Show me in-progress jobs" — Filter jobs by status
- "What needs restocking?" — See the refill queue
- "Which properties have issues?" — List active properties with problems

## Scope (v1)

**In scope:**
- Read-only conversational assistant (no mutations)
- Floating chat panel accessible from all dashboard pages
- 9 tools wrapping existing Convex queries
- Role-gated: admin, property_ops, manager only
- Gemini model via Google AI API

**Out of scope (v1):**
- Chat history persistence (resets on page reload)
- AI-initiated actions or mutations
- Mobile-responsive chat panel
- Multi-language support for AI responses
- New Convex tables or schema changes

## Access Control

| Role | Access |
|------|--------|
| `admin` | Full access |
| `property_ops` | Full access |
| `manager` | Full access |
| `cleaner` | Blocked (403) — cleaners use the mobile app |

## Documentation Index

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | This file — feature overview and scope |
| [architecture.md](architecture.md) | Technical architecture, data flow, tools |
| [implementation-guide.md](implementation-guide.md) | Step-by-step implementation details |
| [setup.md](setup.md) | Environment setup and API key configuration |
