---
sidebar_position: 8
title: Graphviz (DOT)
---

# Graphviz diagrams

`dot`, `graphviz` and `gv` fences are laid out by Graphviz in the browser, using the same
engine PlantUML already uses for its own layout — so a site that renders PlantUML pays no
extra bytes for these.

## A plain DOT graph

```dot title="Build pipeline"
digraph {
  rankdir=LR;
  node [shape=box, style=rounded];

  src   -> build;
  build -> test;
  test  -> deploy;
  test  -> src [label="fix", style=dashed];
}
```

## Choosing a layout engine

Any fence can pick a different layout engine with `engine=`. The same graph laid out by
`neato` rather than `dot`:

```dot title="Undirected mesh" engine=neato
graph {
  layout=neato;
  a -- b;
  b -- c;
  c -- d;
  d -- a;
  a -- c;
}
```

And `circo`, which arranges nodes on a circle:

```dot title="Circular topology" engine=circo
digraph {
  north -> east -> south -> west -> north;
}
```

## Colours from the diagram source always win

The default black strokes and text follow the page's text colour, so the graph is readable in
both colour modes. Anything the DOT source colours explicitly is left exactly as authored —
toggle the theme and watch the red and blue nodes stay put.

```dot title="Authored colours survive the colour mode"
digraph {
  rankdir=LR;
  plain  [label="default"];
  red    [color=red, fontcolor=red];
  filled [style=filled, fillcolor=lightblue];

  plain -> red -> filled;
}
```

## Hyperlinks

DOT's `URL` attribute becomes a real link in the rendered SVG. It is sanitized like every
other piece of engine output, so a `javascript:` URL never survives.

The `hostile` node below deliberately carries a `javascript:` URL. It is here so the end-to-end
suite can prove that sanitization removes it from the rendered page — the node still draws, but
its link does not survive.

```dot title="Nodes that link somewhere"
digraph {
  rankdir=LR;
  docs    [URL="https://graphviz.org/doc/info/lang.html", fontcolor=blue];
  attrs   [URL="https://graphviz.org/doc/info/attrs.html", fontcolor=blue];
  hostile [URL="javascript:alert(1)", label="sanitized away"];
  docs -> attrs -> hostile;
}
```

## Zoom works the same as it does for PlantUML

```dot title="A wider graph worth zooming into"
digraph {
  rankdir=LR;
  node [shape=box];

  ingress -> gateway;
  gateway -> auth;
  gateway -> orders;
  gateway -> billing;
  gateway -> search;
  orders  -> primary;
  billing -> primary;
  search  -> replica;
  primary -> replica [label="replication"];
  orders  -> bus;
  billing -> bus;
  bus     -> notifier;
  notifier -> email;
  notifier -> push;
}
```

A fence can opt out of zoom exactly as a PlantUML fence can:

```dot title="No zoom controls" zoom=false
digraph {
  a -> b;
}
```

## An invalid diagram

Graphviz reports the offending line, and the plugin shows it rather than a generic failure.

```dot title="Deliberately broken"
digraph {
  a -> ;
}
```

## Ordinary code blocks are untouched

A fence in another language still renders as code, with highlighting intact:

```json
{"this": "is not a diagram"}
```

## Both engines on one page

```plantuml title="A PlantUML diagram beside the DOT ones"
@startuml
Alice -> Bob : Hello
Bob --> Alice : Hi
@enduml
```
