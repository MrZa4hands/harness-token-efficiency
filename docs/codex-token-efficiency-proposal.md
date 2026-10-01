---
date: 2026-09-30
status: research-reference
summary: Investigación de Jev, Glance, LifeOS y capacidades de Codex; antecedente de la especificación revisada del piloto.
analyzed_commit: 5e2f2e8
codex_cli_version: 0.159.2
read_when: Antes de modificar contexto, herramientas, hooks, delegación o selección de modelo y esfuerzo para reducir el consumo de tokens.
---

# Propuesta para reducir el consumo de tokens en Codex y LifeOS

La [especificación del piloto](codex-token-efficiency-spec.md) recoge el diseño revisado tras el brainstorming. Conserva la interfaz actual, sitúa código y documentación en el módulo independiente `codex-token-efficiency/` e incorpora Jev en observación desde el principio. Sus decisiones sustituyen las prioridades y el despliegue propuestos en esta investigación. El [AGENTS.md del módulo](../AGENTS.md) establece el flujo de trabajo obligatorio.

## Recomendación

Introducir una política ejecutable de gasto y contexto: reglas deterministas para los casos conocidos, hooks y herramientas que las apliquen, y Jev solo para decisiones ambiguas.

Empezar por reducir lecturas, resultados y reinyecciones; después automatizar modelo y esfuerzo. Una skill puede documentar cómo usar el mecanismo, pero el control automático debe vivir en código.

## Alcance y estado de la investigación

Se analizaron el checkout `5e2f2e8`, la configuración local y Codex CLI `0.159.2`, además del artículo y las fuentes oficiales enlazadas en este documento.

Codex es el objetivo principal. Se distinguen las piezas que LifeOS ejecuta mediante Claude Code. Si la ejecución depende de un orquestador cloud, debe comprobarse su contrato de integración: los hooks locales no se trasladan automáticamente a ese entorno.

Este documento conserva la propuesta de la investigación. Los mecanismos descritos están pendientes de implementación y evaluación. No se modificó código ni configuración durante el análisis, y no se midió ahorro real de tokens.

Las observaciones sobre configuración corresponden al momento de la investigación. Los valores por defecto pueden sobrescribirse por sesión. Las capacidades del harness deben verificarse de nuevo al implementar si cambia la versión instalada.

## Qué aporta el artículo sobre Jev y Glance

El artículo [How Jev Picks the Model and Effort for Every Prompt](https://danielmiessler.com/blog/glance-routes-model-and-effort), publicado el 24 de septiembre de 2026, describe este patrón:

- Glance entrega a Jev el prompt y parte de la respuesta anterior.
- Obtiene dieciocho probabilidades.
- Dos clasificadores pequeños seleccionan modelo y esfuerzo por separado.
- La evaluación usa prompts reales y separa conversaciones entre entrenamiento y prueba.

El 90,1 % publicado mide coincidencia con etiquetas consensuadas por otros modelos. La referencia «siempre permanecer en la conversación» obtiene 83,9 %; añadiendo la regla de profundidad, 85,1 %. En los casos que deberían delegarse, la selección de modelo alcanza 52,6 %; el esfuerzo, 70 %. El router permanece en *shadow*: aconseja, sin despachar automáticamente.

Conviene copiar las decisiones pequeñas, la evaluación con conversaciones reales y la activación gradual. Ese 90,1 % no representa un porcentaje de ahorro ni garantiza elegir el modelo más barato que resuelva correctamente la tarea.

Jev evita que el modelo conversacional haga la clasificación, pero sigue siendo inferencia probabilística externa. TypeSafe publica, en la fecha del análisis, un precio de entrada de 0,042 dólares por millón de tokens y salida gratuita. Sigue siendo necesario medir errores, latencia y coste del estado enviado. Fuente: [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

## Hallazgos en la copia local de LifeOS

La copia local contiene piezas aprovechables, pero no el router descrito en el artículo.

| Hallazgo comprobado | Consecuencia |
|---|---|
| No se encontraron `FrontDoor.ts`, `LaneQuestions.ts` ni `LaneTrain.ts`. El [router anterior está retirado](../../LifeOS/install/LIFEOS/DOCUMENTATION/Router/RouterSystem.md#L11). | No se puede trasladar directamente la implementación del artículo desde este checkout. |
| La [integración documentada con Codex](../../LifeOS/INSTALL.md#L90) no conecta los hooks automáticamente. El [detector de harnesses](../../LifeOS/Tools/InstallEngine.ts#L128) tampoco incluye Codex entre sus candidatos. | Hace falta un adaptador específico; copiar `settings.json` de Claude no resolvería la integración. |
| [models.ts](../../LifeOS/install/LIFEOS/TOOLS/models.ts#L43) separa modelo y esfuerzo, pero fija el esfuerzo de sus inferencias en `high`. | Existe el registro central; falta una política independiente de esfuerzo. |
| [AgentInvocation](../../LifeOS/install/hooks/AgentInvocation.hook.ts#L41) observa despachos y no modifica su modelo. | La selección sigue dependiendo del emisor o de la herencia de sesión. |
| [MemoryTurnStart](../../LifeOS/install/hooks/MemoryTurnStart.hook.ts#L41) evita repetir la memoria principal hasta que cambia o pasan veinte turnos. | Ya existe una estrategia de deduplicación reutilizable. |
| [MemoryRetriever](../../LifeOS/install/LIFEOS/TOOLS/MemoryRetriever.ts#L688) selecciona contexto mediante BM25. Su CLI, sin `--raw`, añade una [inferencia para resumir](../../LifeOS/install/LIFEOS/TOOLS/MemoryRetriever.ts#L489). | Se puede recuperar contexto sin pedir a otro modelo que lo comprima. Hay que distinguir ambos caminos. |
| [Cortex](../../LifeOS/install/LIFEOS/DOCUMENTATION/Memory/CortexContract.md#L57) devuelve primero tarjetas y permite recuperar después los registros elegidos; tiene [adaptador Codex](../../LifeOS/install/LIFEOS/TOOLS/CortexAdapter.ts#L3). | Es una buena base para lectura progresiva, sin introducir otra base vectorial. |
| [TokenXray](../../LifeOS/install/LIFEOS/TOOLS/TokenXray/README.md#L3) y [AgentTokenRollup](../../LifeOS/install/LIFEOS/TOOLS/AgentTokenRollup.ts) leen transcripciones de Claude. | No ofrecen actualmente una contabilidad completa de Codex. |
| [ForgeProgress](../../LifeOS/install/LIFEOS/TOOLS/ForgeProgress.ts#L164) ya lanza Codex con modelo y esfuerzo explícitos. | Conviene ampliar ese punto para trabajos delegados, conservando su supervisión. |

La configuración persistida observada selecciona `gpt-6.1-sol` con esfuerzo `max` y permite doce subagentes simultáneos. Son valores por defecto, potencialmente sobrescribibles por sesión; merecen evaluación antes de añadir un clasificador nuevo.

El payload contiene 56 skills de primer nivel y un prompt constitucional de unos 25 KB. Son superficies que conviene revisar. Esos tamaños no equivalen a tokens facturados ni demuestran que todo se cargue en una sesión concreta.

## Qué puede imponer Codex automáticamente

Las skills cargan sus instrucciones cuando se invocan. Sirven para documentar operaciones, contratos y excepciones, pero su selección implícita sigue involucrando al modelo. Fuente: [Skills de Codex](https://learn.chatgpt.com/docs/build-skills).

Codex instalado tiene hooks habilitados. El contrato consultado permite bloquear o reescribir argumentos de llamadas locales mediante `PreToolUse`, incluyendo shell, MCP y despachos. `UserPromptSubmit` añade contexto, pero no documenta una salida para cambiar modelo o esfuerzo. Las herramientas alojadas, como `WebSearch`, quedan fuera de esa cobertura. `updatedMCPToolOutput` todavía no está soportado. Los hooks locales tampoco se trasladan automáticamente a orquestación cloud. Fuente: [Hooks de Codex](https://learn.chatgpt.com/docs/hooks).

Cuando llega `PreToolUse`, el LLM ya ha elegido una llamada. Reescribirla puede ahorrar resultado, errores y pasos posteriores; no elimina el razonamiento ya gastado en elegirla. Para evitar ese gasto, la selección debe ocurrir antes del turno o dentro de una operación determinista que agrupe varias acciones.

## Flujo propuesto

```mermaid
flowchart LR
    A[Solicitud y estado de la tarea] --> B[Reglas deterministas]
    B --> C[Contexto y operaciones seleccionadas]
    B -->|Ambigüedad relevante| D[Jev opcional]
    D --> C
    C --> E[Inicio de Codex con modelo y esfuerzo]
    E --> F[Wrappers y hooks aplican límites]
    F --> G[Medición de consumo y resultado]
```

La interpretación de una solicitud abierta puede requerir juicio semántico. El programa debe fijar las decisiones que sí puede resolver con hechos: presupuesto, candidatos, recuperación, operaciones conocidas y límites. Los casos que no pueda resolver deben conservar el comportamiento de referencia.

## Medidas y prioridades

| Prioridad | Punto del proceso | Medida propuesta | Mecanismo |
|---|---|---|---|
| 1 | Entrada y contexto | Evitar información repetida o ajena a la tarea | Hashes, estado por sesión y carga selectiva |
| 1 | Lectura de código | Seleccionar archivos y fragmentos antes de leerlos | Git, `rg`, dependencias y ranking local |
| 1 | Resultados de herramientas | Devolver evidencia útil con tamaño acotado | Wrappers, paginación y límites |
| 1 | Razonamiento | Evaluar alternativas al `max` global | Esfuerzo explícito al iniciar el turno |
| 2 | Elección de herramientas | Resolver operaciones conocidas mediante código | Operaciones tipadas y reglas |
| 2 | Subagentes | Controlar contexto, esfuerzo y duplicación | Configuración y política de despacho |
| 2 | Ejecución repetitiva | Agrupar búsquedas, verificaciones y extracciones | Scripts y llamadas programáticas |
| 3 | Ambigüedad semántica | Clasificar únicamente cuando las reglas no basten | Jev con abstención y evaluación |

## 1. Selección automática de archivos y fragmentos

Para una revisión de código, el selector debería construir un paquete inicial con:

- Archivos modificados y sus diferencias.
- Funciones o símbolos afectados.
- Llamadores, dependencias directas y pruebas relacionadas.
- Instrucciones aplicables y configuración relevante.
- Ubicaciones y fragmentos exactos, ampliables cuando falte evidencia.

Puede empezar con Git y `rg`; usar AST o LSP si ya están disponibles. No añadir inicialmente embeddings ni una base vectorial.

La selección debe depender del trabajo. Un bug concreto comienza por su flujo y llamadores; una revisión de autenticación incluye sus controles aunque no estén modificados; un renombrado global necesita enumerar todas las coincidencias. El ranking ordena la exploración, pero no puede recortar una petición de exhaustividad.

Como experimento, probar un paquete inicial de 6.000–8.000 tokens, ampliable por necesidad comprobada. Es un presupuesto inicial propuesto, no un límite universal ni un ahorro medido.

Registrar también los fragmentos ya entregados con su hash. Una nueva lectura sin cambios podría devolver una referencia; tras modificaciones o compactación, volver a proporcionar el contenido necesario.

## 2. Reducir reinyecciones, memoria y documentación

Extender el control que ya tiene `MemoryTurnStart`:

- Emitir contexto cuando cambia, cuando entra un objetivo nuevo o cuando desaparece tras compactación.
- Deduplicar también los resultados recuperados por BM25.
- Mantener las instrucciones obligatorias siempre accesibles.
- Cargar documentación especializada únicamente cuando corresponda a la tarea.

La caché de `MemoryRetriever` es un `Map` en memoria: no persiste entre procesos de hook y tampoco evita por sí sola volver a insertar resultados iguales. Para ese problema basta un pequeño registro por sesión de contenido entregado y versión del corpus.

Preferir Cortex o fragmentos exactos para recuperar memoria. Reservar los resúmenes generados por otro modelo para documentos largos cuyo resumen vaya a reutilizarse. Resumir con IA cada resultado corto puede gastar más de lo que ahorra.

Revisar las superficies de contexto del payload sin confundir sus tamaños con consumo efectivo. El objetivo es cargar lo necesario, mantener las restricciones aplicables y evitar repetir información que sigue disponible.

## 3. Resultados compactos sin perder evidencia

Las operaciones deberían devolver por defecto:

- Estado o código de salida.
- Coincidencias relevantes, con archivo y línea.
- Fallos completos que expliquen el problema.
- Número de resultados omitidos.
- Ruta al resultado íntegro y forma de ampliarlo.

Para pruebas: resumen cuando pasan; errores suficientes para diagnosticar cuando fallan. Para búsquedas: páginas de coincidencias. Para APIs: campos necesarios mediante salida estructurada.

Probar límites de 2.000–3.000 tokens en resultados rutinarios, con ampliación disponible. Codex dispone de `tool_output_token_limit`, que limita lo conservado en el historial; el wrapper debe seleccionar la evidencia antes de alcanzar ese límite. Fuente: [Referencia de configuración](https://learn.chatgpt.com/docs/config-file/config-reference).

Hay una discrepancia concreta que revisar: [ContextReduction](../../LifeOS/install/hooks/ContextReduction.hook.sh#L18) advierte contra comprimir diffs usados como evidencia, pero su lista admite `git diff` y `git show`. No ampliar esa transformación sin resolverlo. La regla global de prefijar con RTK puede conservar lecturas exactas usando `rtk proxy`.

## 4. Automatizar modelo y esfuerzo por separado

Usar políticas distintas para:

| Trabajo identificado | Tratamiento inicial que evaluar |
|---|---|
| Extracción, conteo, búsqueda o validación conocida | Script; sin inferencia adicional |
| Transformación mecánica con comprobación clara | Modelo económico disponible; esfuerzo bajo o medio |
| Implementación o diagnóstico acotado | Modelo capaz; esfuerzo medio |
| Arquitectura, incertidumbre elevada o errores costosos | Modelo fuerte; esfuerzo alto |
| Profundidad solicitada explícitamente | Respetar el esfuerzo solicitado |

No clasificar dificultad por longitud del prompt ni cantidad de archivos. «Hazlo» debe conservar el objetivo y las restricciones anteriores.

El cambio automático del modelo principal necesita un punto anterior a la generación. App Server permite enviar `model` y `effort` en `turn/start`; ambos campos se comprobaron también en los esquemas generados por la CLI instalada. Sus valores pasan a ser los predeterminados posteriores, por lo que el controlador debe fijarlos deliberadamente en cada turno para evitar que una escalada permanezca activa. Fuente: [Codex App Server](https://learn.chatgpt.com/docs/app-server).

Para procesos delegados ya existe `ForgeProgress`. Para el chat estándar, empezar con configuración explícita y medición; añadir un cliente sobre App Server solo si se necesita selección automática por cada prompt.

Seleccionar modelos y esfuerzos entre los disponibles en el cliente y la cuenta reales. La política no debe asumir que las etiquetas del artículo son identificadores utilizables en otra instalación.

## 5. Elección automática de herramientas

Definir unas pocas operaciones reconocibles, por ejemplo:

- `select_code_context`: búsqueda, ranking y lectura de fragmentos.
- `run_project_checks`: detección de comandos existentes y ejecución.
- `get_repository_changes`: estado, diferencias y archivos afectados.
- `search_project_memory`: tarjetas de Cortex y recuperación acotada.

El programa elegiría las utilidades internas según hechos: tipo de operación, estado del repositorio, disponibilidad, frescura y permisos. Así el modelo invoca una operación útil y recibe su resultado; no decide cada comando intermedio.

Los hooks servirían como respaldo para llamadas que salgan de esas operaciones: ajustar argumentos conocidos, detectar duplicados y hacer cumplir límites. No construir un router universal que intente interpretar cualquier comando shell. Reescribir solo formas simples y reconocidas, conservando código de salida y semántica.

## 6. Subagentes, bucles y verificaciones

Un modelo económico con toda la conversación puede seguir siendo caro. Entregar a cada trabajador objetivo, archivos seleccionados, restricciones y comprobación esperada, evitando copiar contexto personal y trabajo ajeno.

Evaluar los controles nativos `default_subagent_model`, `default_subagent_reasoning_effort` y máximo de concurrencia. Ese máximo limita simultaneidad; hace falta además un contador para limitar despachos totales por tarea. Fuente: [Configuración de agentes](https://learn.chatgpt.com/docs/config-file/config-reference).

Reutilizar la lógica de [LoopDetector](../../LifeOS/install/hooks/LoopDetector.hook.ts), añadiendo claves que incorporen estado: repetir una consulta idéntica puede ser innecesario; repetirla después de una edición puede ser imprescindible.

Las secuencias conocidas —buscar símbolos, localizar llamadores, recoger pruebas— deberían ejecutarse en un script y devolver un agregado. Las llamadas programáticas pueden reducir resultados intermedios enviados al contexto, aunque requieren comparación con la ejecución directa. Fuente: [Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling).

Conservar las verificaciones de seguridad y corrección. El ahorro debe venir de evitar trabajo duplicado y ejecutar comprobaciones adecuadas, no de declarar éxito con menos evidencia.

## 7. Jev como segunda fase

Usarlo para preguntas que los metadatos no resuelven:

- ¿El mensaje continúa el objetivo actual o abre otro?
- ¿La tarea requiere juicio semántico o ejecución mecánica?
- ¿Una reducción de esfuerzo tiene riesgo de producir errores difíciles de detectar?
- ¿La petición exige cobertura exhaustiva?

Enviar únicamente el estado necesario: solicitud, objetivo vigente, restricciones y hechos resumidos. Nunca el repositorio completo para decidir cuánto repositorio leer.

La política de acción seguiría en código. Una probabilidad insuficiente, respuesta incompleta o fallo mantendría el comportamiento de referencia; no dispararía automáticamente otra clasificación con el modelo más caro.

Si el requisito es cero inferencia externa para evaluar decisiones, omitir esta fase. Las reglas pueden automatizar los casos conocidos y abstenerse en el resto.

## Implementación mínima

La implementación mínima tendría dos puntos de control, no un harness nuevo completo:

1. Un módulo de política en `LIFEOS/TOOLS` que reutilice los selectores, registros y utilidades existentes.
2. Un adaptador de hooks de Codex que conecte eventos, límites y telemetría.

La skill sería pequeña: operaciones disponibles, contratos y cómo ampliar contexto. El controlador de App Server sería una ampliación posterior, únicamente para automatizar modelo y esfuerzo del turno principal. Jev también quedaría fuera del primer piloto.

El adaptador de instalación debe distinguir los contratos de Codex y Claude Code. El registro existente de modelos y los componentes de recuperación deben reutilizarse antes de introducir alternativas.

## Medición y criterios de evaluación

Antes de activarlo, medir coste por tarea terminada correctamente.

| Consumo | Calidad |
|---|---|
| Entrada, caché, salida y razonamiento | Objetivo satisfecho |
| Tokens de trabajadores y clasificadores | Pruebas y verificaciones correctas |
| Contexto y resultados entregados | Archivos relevantes recuperados |
| Relecturas, reintentos y llamadas repetidas | Omisiones y correcciones del usuario |
| Latencia y coste según canal | Casos que necesitaron escalada |

App Server expone `thread/tokenUsage/updated`; los esquemas locales incluyen desglose de caché y razonamiento. Sumar también procesos delegados. No contar dos veces el razonamiento si forma parte del total de salida.

La caché merece tratamiento separado: menos tokens de contexto y menor coste facturado no son la misma métrica. Mantener prefijos estables puede favorecer su reutilización; cambios de modelo, esfuerzo o compactación deben evaluarse junto con ese efecto. Fuente: [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

La métrica principal sería coste por resultado correcto, contando clasificadores, trabajadores, reintentos y correcciones. La reducción de tokens debe evaluarse junto con calidad y latencia. No estimar ahorro a partir de precisión de clasificación ni aplicar precios de API como si fueran facturación marginal de una suscripción.

## Despliegue gradual

1. **Instrumentación:** medir sesiones representativas sin modificar decisiones.
2. **Piloto determinista:** selección de contexto, deduplicación y resultados acotados.
3. **Modelo y esfuerzo:** comparar configuraciones en tareas reales con comprobaciones.
4. **Jev en shadow:** evaluar sus recomendaciones sin ejecutarlas.
5. **Activación por operación:** automatizar solo donde mejore el coste manteniendo calidad; repetir evaluación cuando cambien política o modelo.

Incluir prompts en español, seguimientos cortos, repositorios grandes y tareas de riesgo. Separar conversaciones completas entre ajuste y evaluación.

El piloto debe conservar las instrucciones explícitas del usuario, las restricciones de seguridad y la cobertura requerida. Los presupuestos iniciales son parámetros de evaluación, no excusas para omitir evidencia o reducir el alcance solicitado.

## Verificación de la investigación

Se contrastaron documentación oficial, archivos del checkout, configuración local y esquemas de protocolo generados por Codex CLI `0.159.2`.

La investigación identifica puntos de integración y limitaciones. No demuestra todavía ahorro ni calidad de las políticas propuestas. Esos resultados deben salir del piloto.
