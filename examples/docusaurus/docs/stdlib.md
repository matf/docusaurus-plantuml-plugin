---
sidebar_position: 8
title: Standard library
---

# PlantUML standard library

`!include <namespace/file>` resolves against the standard library namespaces the plugin
ships. Nothing is configured on this page: the plugin sees the include, loads the one
namespace it names, and renders.

## C4

```plantuml title="C4 container diagram"
@startuml
!include <C4/C4_Container>

Person(user, "Reader", "Reads the documentation")
System_Boundary(site, "Documentation site") {
  Container(browser, "Browser", "JavaScript", "Renders diagrams locally")
  Container(assets, "Static assets", "Files", "Engine and standard library")
}

Rel(user, browser, "Opens a page")
Rel(browser, assets, "Fetches on demand", "HTTP")
@enduml
```

The `.puml` suffix is accepted too, because C4-PlantUML's own documentation writes it that
way.

```plantuml title="Include spelled with the file extension"
@startuml
!include <C4/C4_Context.puml>

Person(reader, "Reader")
System(site, "Documentation site")
Rel(reader, site, "Reads")
@enduml
```

## A namespace that pulls in another

`k8s/Common` includes `<c4/…>` from inside the library. The dependency is resolved before the
engine ever sees the source, so the diagram does not have to know about it.

```plantuml title="Kubernetes sprites"
@startuml
!include <k8s/Common>
!include <k8s/OSS/KubernetesPod>
!include <k8s/OSS/KubernetesSvc>

KubernetesPod(pod, "web", "")
KubernetesSvc(svc, "web-svc", "")
svc --> pod
@enduml
```

## A namespace this site does not have

`aws` is not vendored with the plugin, so this fence reports what is missing instead of
failing inside the engine.

```plantuml title="Unavailable namespace"
@startuml
!include <aws/Common>
A -> B
@enduml
```
