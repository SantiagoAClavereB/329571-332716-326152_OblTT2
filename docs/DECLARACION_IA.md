# Declaración de uso de Inteligencia Artificial Generativa

**Materia:** Taller de Tecnologías 2 · **Grupo:** M6C · **Obligatorio 2026: Blockchain**
**Repositorio:** `329571-332716-326152_OblTT2` · **Integrantes:** Romina Carsin, [completar], [completar]

Esta declaración sigue las condiciones generales del obligatorio: indicamos **qué herramientas** usamos y **en qué contexto**, qué revisamos y verificamos, y qué riesgos reconocemos. No consultamos pautas específicas de los docentes sobre el uso de IA: nos guiamos por lo que dice la letra.

## 1. Herramientas utilizadas

| Integrante | Herramienta | Para qué |
|---|---|---|
| Romina Carsin | **Claude Code** (Anthropic), con un modelo de la familia Claude, usado dentro de la aplicación de escritorio de Claude | Análisis de la letra, contratos, tests, scripts, documentación y apoyo con Git (detalle en la sección 2) |
| [completar] | [herramienta, o «no usó IA generativa»] | [contexto de uso] |
| [completar] | [herramienta, o «no usó IA generativa»] | [contexto de uso] |

> **Cada integrante tiene que completar su fila con lo que realmente hizo.** Las filas de los otros dos integrantes quedan vacías a propósito: quien redactó este borrador no puede saber qué herramientas usaron.

El plan de trabajo del grupo (fases, roles y las decisiones de diseño iniciales) también se registra como material elaborado con ayuda de IA, según lo que indica el propio plan.

## 2. Contexto de uso: Claude Code (Romina Carsin)

| Área | Qué hizo la herramienta | Qué decidimos nosotros |
|---|---|---|
| **Lectura de la letra** | Contrastó el plan y la interfaz contra las secciones 2 a 17 y detectó lo que faltaba: el flag `revocable`, el estado `Completed` y el error `NotRevocable`; y que los tests mínimos son 16 y no 17 | Aceptar y aplicar esos cambios |
| **Contratos** | Escribió `IVestingManager`, `VestingManager`, los tokens de prueba y las variantes de los desafíos opcionales (cliff, batch, Permit, UUPS) | Qué comportamiento debía tener cada parte (la letra y el plan) y qué desafíos hacer |
| **Tests** | Escribió los 111 tests: unitarios, fuzzing, invariantes y los contratos atacantes (`ReentrantToken`, `FeeToken`) | El criterio de qué cubrir (los 16 casos de la letra y el checklist de la clase 13) |
| **Scripts** | `Deploy.s.sol`, `DeployUpgradeable.s.sol`, `MeasureOps.s.sol` y `compare-costs.mjs` | — |
| **Integración** | Detectó que dos versiones de `getAgreements` eran incompatibles y adaptó el contrato a la que consumía la dApp | Cuál versión adoptar |
| **Verificación local** | Ejecutó scripts de Ethers contra Anvil, levantó redes locales y repitió los flujos con distintos tokens y decimales | Probar la interfaz con MetaMask (lo hizo una persona del grupo, no la herramienta) |
| **Documentación** | Redactó `DECISIONES_DEFENSA`, `DESAFIOS_OPCIONALES`, `DEPLOY_L2`, el documento de arquitectura, los diagramas y esta declaración; actualizó el README | Revisar el contenido y firmar lo que entregamos |
| **Git** | Ramas, commits y texto de los pull requests | Qué commitear y qué mergear; nadie mergea su propio código |

Antes de este repositorio, la misma herramienta se usó para armar una guía de trabajo y para explicar cómo avanzar paso a paso. Ese material quedó fuera del repositorio y **no forma parte de la entrega**.

La herramienta **no** tuvo acceso a billeteras reales ni se usaron claves privadas reales en las pruebas: todo se hizo con las cuentas públicas de Anvil.

## 3. Cómo revisamos y verificamos lo generado

- **Tests automáticos:** 111 tests con `forge test` y cobertura de líneas de 96,75 % (100 % en `VestingManager.sol`).
- **Pruebas de integración:** un recorrido completo del contrato desplegado en Anvil con las mismas definiciones de ABI que usa la dApp (creación, devengado, reclamos, cancelación a mitad de período, reclamo posterior, tercero sin permisos y errores).
- **Prueba manual con MetaMask** de las pantallas por parte de una persona del grupo.
- **Revisión por pares** de los pull requests antes de mergear.
- **Contraste con la letra:** cada requisito de las secciones 3 a 12 está asociado a una medida y a un test (documento de arquitectura, §0 y §7).

**Errores que encontramos en lo generado y corregimos.** Lo dejamos escrito porque muestra que no aceptamos el resultado sin revisarlo:

- El plan y la primera interfaz omitían el flag `revocable` y el estado `Completed`, que la letra exige.
- Dos personas agregaron `getAgreements` en paralelo con retornos distintos y el contrato dejó de compilar al unir las ramas.
- Afirmaciones de documentación que no estaban respaldadas por una prueba (el motivo de usar un struct para la firma de Permit y el comportamiento de la guarda de reentrancia detrás de un proxy): se agregó un test para la segunda y se reformuló la primera como decisión de legibilidad.
- En un borrador del documento de arquitectura había comparaciones sin medición (por ejemplo, la velocidad frente a Hardhat o cuántas veces es más caro un despliegue por acuerdo): se quitaron.
- Lo que **no** se pudo comprobar está dicho en el documento: el deploy en una L2 real y el campo `l1Fee` de los recibos.

## 4. Riesgos y límites que reconocemos

- **Alucinaciones y errores:** el código y los textos generados pueden ser incorrectos aunque suenen seguros. Por eso la verificación anterior es parte del trabajo, no un extra.
- **Privacidad:** no conviene pegar credenciales en el chat con una herramienta de IA. En las pruebas se usaron solo cuentas públicas de Anvil y la herramienta no recibió acceso a ninguna billetera.
- **Propiedad intelectual:** el contrato usa OpenZeppelin (licencia MIT) y Foundry/forge-std; el resto lo escribimos o lo generó la herramienta bajo nuestra revisión.
- **Autoría:** el trabajo presentado tiene que reflejar nuestra comprensión. Cada integrante debe poder explicar la arquitectura, el cálculo de vesting, la máquina de estados, la cancelación, el manejo del ERC-20, las decisiones de storage/memory/calldata, la seguridad y los tests, también las partes que no escribió. El documento de arquitectura y `docs/DECISIONES_DEFENSA.md` son nuestra guía de estudio para la defensa.
