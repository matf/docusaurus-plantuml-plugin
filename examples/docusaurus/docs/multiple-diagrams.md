---
sidebar_position: 3
title: Multiple diagrams
---

# Several diagrams on one page

Diagrams are rendered one at a time by a shared queue, so a page can hold as many as it
needs without the engine's shared state being corrupted.

## Sequence

```plantuml title="Order checkout"
@startuml
actor Customer
participant Cart
participant Payments

Customer -> Cart: Checkout
Cart -> Payments: Authorize
Payments --> Cart: Approved
Cart --> Customer: Receipt
@enduml
```

## Class diagram (Graphviz layout)

This one goes through the bundled Graphviz layout engine rather than PlantUML's built-in
sequence layout.

```plantuml title="Domain model"
@startuml
class OrderService {
  +placeOrder(cart)
  +cancel(id)
}
class OrderRepository {
  +findById(id)
  +save(order)
}
class Order {
  -id
  -total
}
interface Clock {
  +now()
}

OrderService --> OrderRepository
OrderService ..> Clock
OrderRepository --> Order
@enduml
```

## Component diagram

```plantuml title="Runtime components"
@startuml
package "Docusaurus site" {
  [MDXComponents/Code]
  [PlantUmlDiagram]
}
package "Browser runtime" {
  [viz-global.js]
  [plantuml.js]
}

[MDXComponents/Code] --> [PlantUmlDiagram]
[PlantUmlDiagram] --> [plantuml.js]
[plantuml.js] --> [viz-global.js]
@enduml
```
