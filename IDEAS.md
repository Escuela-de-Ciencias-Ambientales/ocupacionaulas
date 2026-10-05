# Ideas para implementar después

Actualizado: 5 de octubre de 2026, hora de Costa Rica.

Estas ideas son una lista de posibilidades, no compromisos ni autorización para implementarlas. Primero debe cerrarse la autorización GNSS y la carga del inventario en el sistema publicado.

| Idea | Origen | Beneficio esperado | Qué falta evaluar |
| --- | --- | --- | --- |
| Lectura individual con lector USB 2D | Chat «Crear sitio de préstamos de equipos» | Asignar y devolver unidades sin escribir códigos | Compatibilidad, identificación física y prueba operativa |
| DataMatrix grabado en equipos compatibles | Mismo chat; preocupación por lluvia, sudor, golpes y poco espacio | Identificación resistente a campo | Material, garantía, impermeabilidad, lectura DPM y ensayo real |
| Tags NFC industriales tipo llavero | El usuario indicó que podría ser una opción | Lectura deliberada de una unidad a corta distancia | Fijación, uso sobre metal, resistencia y prueba piloto; no hay compra aprobada |
| Identificación combinada: activo visible, código y tag | Síntesis de alternativas discutidas | Tener respaldo si falla un método | Evitar que el estuche identifique una unidad diferente de su contenido |
| RFID UHF para inventarios masivos | Alternativa discutida, sin selección definitiva | Revisar existencias de muchas unidades | Lecturas accidentales, costos, antenas y necesidad real |
| Fotografías de referencia y de incidencias por unidad | Requisitos históricos del prototipo local | Reconocer equipos y documentar daños | Confirmar qué existe ya en producción y permisos de almacenamiento |
| Comprobantes automáticos de devoluciones parciales | Requisitos históricos del prototipo local | Informar qué se devolvió y qué sigue pendiente | Confirmar cobertura del servicio actual y evitar envíos duplicados |
| Avisos de solicitudes GNSS pendientes de aprobar | Derivado del nuevo flujo | Reducir espera entre solicitud y aprobación | Canal, destinatarios y frecuencia; no enviar mensajes sin autorización |
| Conciliación de inventario desde el panel | Derivado de la carga corregida | Resolver códigos, cantidades y series ambiguas con historial | Diseño de revisión y permisos; conservar la fuente original |

## Para promover una idea a implementación

1. Confirmar la necesidad con el usuario.
2. Comprobar si ya existe en producción.
3. Registrar alcance y decisión en DECISIONES.md.
4. Crear una tarea concreta en PENDIENTES.md.
5. Implementar, probar y registrar el resultado en AVANCE.md.

No convertir recomendaciones históricas de hardware en selecciones de compra vigentes sin una evaluación actual.

## Seguimiento posterior al cambio GNSS

- Evaluar autenticación adicional de autoridades si la institución desea reforzar el proceso actual de cédula y firma.
- Añadir conciliación asistida de unidades agrupadas y los equipos anteriores cuando bodega confirme identificación física.
- Evaluar avisos de aprobación pendientes y filtros del historial si crece el volumen; requieren definir canal y destinatarios.

Estas propuestas no forman parte del alcance publicado ni habilitan envíos automáticos.

## Ideas posteriores para la tabla de inventario

- Evaluar guardar varias filas seleccionadas en una operación si el uso real lo requiere.
- Evaluar detección de cambios concurrentes entre operadores para evitar sobrescrituras de registros desactualizados.

Estas mejoras quedan propuestas; la implementación actual guarda explícitamente una fila por vez.
