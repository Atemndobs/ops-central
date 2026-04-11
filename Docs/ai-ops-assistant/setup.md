# AI Ops Assistant — Setup Guide

## Prerequisites

- Node.js 18+
- A Google AI API key (Gemini access)
- Existing OpsCentral admin running with Clerk + Convex configured

## 1. Get a Google AI API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with the Gmail account connected to Gemini
3. Click "Create API Key"
4. Copy the key

## 2. Add Environment Variable

Add to `.env.local`:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your-api-key-here
```

Optional — override the default model:

```bash
AI_MODEL=gemini-2.5-flash
```

## 3. Install Dependencies

From the project root:

```bash
npm install ai@^6.0.0 @ai-sdk/react@^3.0.0 @ai-sdk/google
```

## 4. Start Dev Server

```bash
npm run dev
```

The AI chat panel will appear as a floating button in the bottom-right corner of any dashboard page.

## Supported Models

The default model is `gemini-2.5-flash`. You can change it via the `AI_MODEL` env var. Any Gemini model supported by `@ai-sdk/google` works:

- `gemini-2.5-flash` (default — fast, good for tool use)
- `gemini-2.5-pro` (more capable, slower)
- `gemini-2.0-flash` (previous generation)

## Troubleshooting

### "Unauthorized" (401)
- Make sure you're signed in via Clerk
- Check that your Clerk session is valid

### "Forbidden" (403)
- Your user role must be `admin`, `property_ops`, or `manager`
- Cleaners cannot access the AI assistant

### No response / timeout
- Verify `GOOGLE_GENERATIVE_AI_API_KEY` is set in `.env.local`
- Check the terminal for API errors
- Ensure the Google API key has Gemini API access enabled

### Tool calls fail
- Verify `NEXT_PUBLIC_CONVEX_URL` is set and Convex is running
- Check Convex dashboard for query errors
