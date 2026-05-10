---
name: write-tests
description: Use when the user asks you to write or improve tests, asks "add coverage",
  "write unit tests for this", or wants you to write integration tests. Covers what
  to test, what NOT to test, and structure.
version: 1.0.0
---

# Write Tests Skill

When asked to write tests, follow these principles.

## 1. What to test

Test **behaviour**, not implementation.

Good test names:
- `"returns 404 when user not found"`
- `"refuses to delete the last admin account"`
- `"sums to zero for empty list"`

Bad test names (testing implementation):
- `"calls findById"`
- `"sets state.loading to true"`
- `"increments counter by 1"`

## 2. What NOT to test

- Don't test third-party libraries (`Date`, `Array.map`, `axios.get`).
- Don't test trivial getters/setters with no logic.
- Don't write tests that mirror the implementation 1:1 — they'll just lock the code in place.
- Don't test private methods directly. Test through the public API.

## 3. Structure: Arrange / Act / Assert

```js
test('does the thing', () => {
  // Arrange: set up the world
  const user = createUser({ admin: true });

  // Act: do one thing
  const result = service.deleteUser(user.id);

  // Assert: check outcome
  expect(result).toEqual({ ok: false, reason: 'last_admin' });
});
```

One assert-cluster per test. If you need multiple, write multiple tests with descriptive names.

## 4. Edge cases checklist

For any non-trivial function, ask:

- What if input is empty? null? undefined?
- What if input is the maximum allowed size?
- What if it's exactly 0 or exactly 1?
- What if called twice in a row? In parallel?
- What if a dependency throws?

Cover the obvious-but-fragile cases. Skip the absurdly unlikely ones.

## 5. Test isolation

- Each test must run independently and in any order.
- No shared mutable state between tests.
- Mock or stub external IO (network, filesystem, time, random).
- Use `beforeEach` for setup, `afterEach` for cleanup.

## 6. Output

Write the tests in the same language and test framework the project already uses. Match the project's existing test style and file layout. Don't introduce a new test runner unless the user asks for it.

If the user just asks "write tests", default to unit tests. If they ask for "integration tests", spin up real dependencies (database, HTTP server) and test through them.
