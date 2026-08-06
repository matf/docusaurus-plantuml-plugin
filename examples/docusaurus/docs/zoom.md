---
sidebar_position: 7
title: Zoom and pan
---

# Zoom and pan

The first diagram is deliberately wide, so it is worth zooming into. The second opts out with
`zoom=false` on its fence and renders exactly as it did before the feature existed.

```plantuml title="Wide deployment topology"
@startuml
node "Edge cache" as edge
node "Load balancer" as lb
node "API gateway" as gw
node "Auth service" as auth
node "Orders service" as orders
node "Billing service" as billing
node "Search service" as search
node "Notification worker" as notify
database "Primary" as primary
database "Replica" as replica
queue "Event bus" as bus

edge --> lb
lb --> gw
gw --> auth
gw --> orders
gw --> billing
gw --> search
orders --> primary
billing --> primary
search --> replica
primary --> replica
orders --> bus
billing --> bus
bus --> notify
notify --> auth
@enduml
```

## Opted out

```plantuml title="Small sequence, no zoom" zoom=false
@startuml
Alice -> Bob : Hello
Bob --> Alice : Hi
@enduml
```
