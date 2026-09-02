---
sidebar_position: 12
title: Large diagram
---

# A diagram taller than the engine's original ceiling

`@plantuml/core` refuses to serialize a diagram wider or taller than 4096 points,
reporting `Diagram too large for browser rendering`. The plugin patches that ceiling up
to 32768 before serving the engine, so the chain below — roughly 6 400 points tall —
renders instead of failing.

```plantuml title="Sixty-step pipeline"
@startuml
class Step01
class Step02
class Step03
class Step04
class Step05
class Step06
class Step07
class Step08
class Step09
class Step10
class Step11
class Step12
class Step13
class Step14
class Step15
class Step16
class Step17
class Step18
class Step19
class Step20
class Step21
class Step22
class Step23
class Step24
class Step25
class Step26
class Step27
class Step28
class Step29
class Step30
class Step31
class Step32
class Step33
class Step34
class Step35
class Step36
class Step37
class Step38
class Step39
class Step40
class Step41
class Step42
class Step43
class Step44
class Step45
class Step46
class Step47
class Step48
class Step49
class Step50
class Step51
class Step52
class Step53
class Step54
class Step55
class Step56
class Step57
class Step58
class Step59
class Step60
Step01 --> Step02
Step02 --> Step03
Step03 --> Step04
Step04 --> Step05
Step05 --> Step06
Step06 --> Step07
Step07 --> Step08
Step08 --> Step09
Step09 --> Step10
Step10 --> Step11
Step11 --> Step12
Step12 --> Step13
Step13 --> Step14
Step14 --> Step15
Step15 --> Step16
Step16 --> Step17
Step17 --> Step18
Step18 --> Step19
Step19 --> Step20
Step20 --> Step21
Step21 --> Step22
Step22 --> Step23
Step23 --> Step24
Step24 --> Step25
Step25 --> Step26
Step26 --> Step27
Step27 --> Step28
Step28 --> Step29
Step29 --> Step30
Step30 --> Step31
Step31 --> Step32
Step32 --> Step33
Step33 --> Step34
Step34 --> Step35
Step35 --> Step36
Step36 --> Step37
Step37 --> Step38
Step38 --> Step39
Step39 --> Step40
Step40 --> Step41
Step41 --> Step42
Step42 --> Step43
Step43 --> Step44
Step44 --> Step45
Step45 --> Step46
Step46 --> Step47
Step47 --> Step48
Step48 --> Step49
Step49 --> Step50
Step50 --> Step51
Step51 --> Step52
Step52 --> Step53
Step53 --> Step54
Step54 --> Step55
Step55 --> Step56
Step56 --> Step57
Step57 --> Step58
Step58 --> Step59
Step59 --> Step60
@enduml
```
