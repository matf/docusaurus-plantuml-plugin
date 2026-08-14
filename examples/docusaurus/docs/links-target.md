---
sidebar_position: 11
title: Link target
---

# Link target

The landing page for the cross-page diagram links on [Links and deep links](./links.md).
Nodes on that page link here with `#graph?highlight-node=TARGET_NODE_7`, which the diagram
below contains.

```plantuml title="Landing diagram"
@startuml
component "Landing node" as TARGET_NODE_7
component "Neighbour" as NEIGHBOUR_1
TARGET_NODE_7 --> NEIGHBOUR_1
@enduml
```
