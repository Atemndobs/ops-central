# Mutation Safety Rules

**CRITICAL:** Convex mutation loops can exhaust the free tier quota within minutes.
A single infinite loop fires thousands of mutations, each counting against billing.

---

## The Dangerous Pattern

```tsx
// DANGEROUS - DO NOT DO THIS
const myMutation = useMutation(api.foo.bar);

useEffect(() => {
  void myMutation({ data: "value" });
}, [myMutation]); // myMutation changes identity every render = infinite loop
```

`useMutation()` returns a new function reference on every render.
Putting it in a dependency array causes useEffect/useCallback to re-fire endlessly.

---

## The Safe Pattern

```tsx
// SAFE - Always use this pattern
const myMutation = useMutation(api.foo.bar);
const myMutationRef = useRef(myMutation);
myMutationRef.current = myMutation;

useEffect(() => {
  void myMutationRef.current({ data: "value" });
}, [/* only real dependencies here, NOT myMutation */]);
```

### Rules

1. **NEVER** put a `useMutation` return value in a `useEffect` dependency array
2. **NEVER** put a `useMutation` return value in a `useCallback` dependency array
3. **ALWAYS** stabilize with `useRef` if the mutation is called inside `useEffect` or `useCallback`
4. **ALWAYS** use `mutationRef.current(...)` instead of `mutation(...)` inside hooks

### For event handlers (onClick, onSubmit)

Direct mutation calls in event handlers are SAFE because they're user-triggered, not render-triggered:

```tsx
// SAFE - onClick is user-triggered, not a render loop
const myMutation = useMutation(api.foo.bar);

<button onClick={() => void myMutation({ data: "value" })}>
  Submit
</button>
```

No ref needed here. The danger is only when mutations are called from `useEffect` or `useCallback` with the mutation in the dependency array.

---

## Automated Test

Run the guard test before every deploy:

```bash
node --test tests/mutation-loop-guard.test.mjs
```

This test scans ALL source files and fails if any `useMutation` return value appears in a `useEffect` or `useCallback` dependency array without a corresponding `useRef` stabilization.

---

## What Happens If You Violate This

1. Component renders
2. `useMutation()` returns a new function reference
3. `useEffect` sees a new dependency, fires the mutation
4. Mutation causes state change, component re-renders
5. Go to step 1 -- **infinite loop**
6. Convex WebSocket closes with `TooManyConcurrentMutations`
7. Reconnect, loop resumes, **billing explodes**

A single user hitting a page with this bug can generate **thousands of mutations per minute**.

---

## Checklist For Every PR

- [ ] No `useMutation` returns in `useEffect` deps
- [ ] No `useMutation` returns in `useCallback` deps (unless ref-stabilized)
- [ ] `node --test tests/mutation-loop-guard.test.mjs` passes
