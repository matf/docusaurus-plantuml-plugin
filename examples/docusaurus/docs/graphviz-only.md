---
sidebar_position: 9
title: Graphviz only
---

# A page with no PlantUML on it

This page exists to prove that a DOT-only page never downloads the PlantUML engine. It
contains exactly one diagram, and that diagram is Graphviz.

```dot title="The only diagram here"
digraph {
  rankdir=LR;
  request -> handler -> response;
}
```
