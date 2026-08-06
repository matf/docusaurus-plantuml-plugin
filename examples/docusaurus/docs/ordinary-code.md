---
sidebar_position: 5
title: Ordinary code blocks
---

# Ordinary code blocks are untouched

This page contains no PlantUML at all, so the PlantUML runtime is never downloaded.

```ts title="example.ts"
export function greet(name: string): string {
  return `Hello, ${name}`;
}
```

```js
const total = [1, 2, 3].reduce((sum, value) => sum + value, 0);
console.log(total);
```

```
A fence with no language at all.
```

Inline code such as `plantuml` is also left alone — only fenced blocks are converted.
