---
sidebar_position: 6
title: Mixed content
---

# A diagram next to ordinary code

```ts title="handler.ts"
export async function handleSignIn(request: Request): Promise<Response> {
  return new Response(null, {status: 204});
}
```

```PlantUML title="Uppercase fence language"
@startuml
Alice -> Bob : Case-insensitive fence
@enduml
```

```bash
npm install @matfsw/docusaurus-plantuml-plugin
```
