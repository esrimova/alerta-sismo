# Especificación funcional — Alerta Sismo

> **Cómo se usa este documento**
>
> Describe **lo que la app debe hacer**, no lo que se hizo ni cuándo se decidió.
>
> **Se actualiza sobrescribiendo.** Si una decisión cambia, se reemplaza el texto en su lugar. Nunca se añade una entrada nueva, ni una fecha de decisión, ni una sección de historial. El registro de lo que le ocurre a la app vive en la bitácora; el registro de cambios del código vive en git. Este documento no es ninguno de los dos, y convertirlo en uno de ellos lo vuelve inútil.
>
> Marcar el **estado** de cada función sí es correcto: es una foto del presente, no un historial.
>
> Si este documento y el código se contradicen, **manda el documento** y el código queda pendiente de ajustar.

Estados usados: **construido** · **decidido** (acordado, sin construir) · **abierto** (pendiente de decidir) · **descartado** (evaluado y rechazado; se conserva la línea para no volver a proponerlo).

---

## 1. Principio rector

**No competir con lo que el teléfono ya hace, salvo que se pueda garantizar hacerlo mejor.** Si no se puede garantizar, hay dos caminos válidos: complementar lo que existe, o aportar lo que no existe.

Toda función propuesta pasa por esta prueba antes de construirse.

| Función | ¿El teléfono ya lo hace? | Decisión |
|---|---|---|
| Aviso anticipado de sismo | **Sí** — Alertas de Google, ~18 s desde el origen | **No competir.** Detectar su notificación y complementarla |
| Instrucción "agáchate, cúbrete, agárrate" | **Sí** — la alerta de Google toma la pantalla | **No duplicar** |
| Confirmación posterior con datos del evento | No | **Aportar** — feed del USGS |
| Registro permanente de lo ocurrido | No | **Aportar** — bitácora |
| Protocolo si el usuario queda incapacitado | No | **Aportar** — hombre muerto + balizas |
| Guía de acción una vez pasó la sacudida | No | **Aportar** — fase 3 |
| Linterna encendida automáticamente | No | **Aportar** |
| Detección de sismo con el acelerómetro | **Sí** — Google lo hace con millones de teléfonos | **No competir** con su red. Un solo teléfono no puede igualarla |
| **Medición** de la sacudida en la dirección exacta del usuario | No — Google estima para una región entera | **Aportar** — es distinto de detectar (ver §3) |

---

## 2. Las tres fases

La app organiza toda emergencia en tres fases. **Las fases son lo invariante; el tipo de emergencia es el parámetro.** Añadir "incendio" debe consistir en llenar una columna, no en reescribir la arquitectura.

**Fase 1 · Monitoreo** — detectar que algo va a pasar o está pasando.

**Fase 2 · Durante** — qué hace la app mientras ocurre. Restricción dominante: **el usuario no puede operar el teléfono**. Todo debe ser automático o de un solo toque, sin leer.

**Fase 3 · Después** — qué hace mientras transcurre la emergencia y una vez pasa lo peor. *"Se me cayó la casa, ¿qué hago?"*, *"ya paró de temblar, ¿qué debo hacer?"*

---

## 3. Sismo

Única emergencia desarrollada.

### Fase 1 · Monitoreo

| Función | Estado |
|---|---|
| Consulta al feed del USGS cada 60 s mediante servicio en primer plano | **construido** |
| Hibernación sin internet y reanudación inmediata al volver la señal | **construido** |
| Vigilante que revive el monitoreo si el sistema operativo lo mata | **construido** |
| Bitácora permanente de alertas, protocolo, red y servicio | **construido** |
| Semáforo de estado del feed, distinguiendo "sin internet" de "servicio caído" | **construido** |
| Escucha de la alerta de Google mediante sus canales de notificación | **construido** |
| Semáforo por fuente: feed, sensor y alerta de Google, cada uno con su estado | **construido** |
| Episodio sísmico: las tres fuentes del mismo sismo en un solo registro | **construido** |
| Medida del aviso previo real, cruzando la hora de Google con la llegada de la onda | **construido** |
| Recalibración del motor de reglas (ver §5: la alerta naranja no puede dispararse) | **abierto** |
| Cálculo de intensidad estimada a partir de magnitud, distancia y profundidad | **abierto** |
| Fuente del Servicio Geológico Colombiano como complemento del USGS | **abierto** |
| Detección local con el acelerómetro, como sustituto de la red de Google | **descartado** |

**Detectar y medir no son lo mismo, y solo lo primero está descartado.** Detectar es
decir "está ocurriendo un sismo" sin que nadie lo haya dicho antes, y ahí un teléfono
solo no puede con la red de millones de Google. Medir es responder "cuánto se sacudió
*aquí*" cuando otra fuente ya dio el aviso. El acelerómetro nunca dispara nada por su
cuenta: solo abre una ventana de medida cuando Google, el feed o una prueba manual la
piden. Esa condición es lo que lo mantiene fuera del "no competir".

#### Fusión de fuentes

El mismo sismo llega tres veces y en momentos distintos. Sin cruzarlos serían tres
registros sueltos que no se saben hermanos, y se perdería lo único que solo existe al
compararlos.

| Fuente | Llega a | Aporta | Falla cuando |
|---|---|---|---|
| Alerta de Google | ~18 s | Aviso rápido y nivel esperado | Google se equivoca (§5, Turquía 2023) o no hay red |
| Acelerómetro propio | 23-58 s | Lo que ocurrió en la dirección exacta del usuario | El teléfono va en movimiento |
| Feed del USGS | 4-7 min | Magnitud revisada, profundidad, coordenadas | El servicio cae o no hay internet |

**El USGS no se degrada por llegar tarde: cambia de papel.** Deja de ser el disparador
para ser el **registro autoritativo**, que es lo que hace falta si hay catástrofe y
alguien necesita los datos del evento.

El episodio **se abre con la primera fuente que llegue**, sea cual sea; esperar al USGS
para abrirlo sería esperar los 4-7 minutos que esta capa existe para evitar. Las fuentes
se reconocen como el mismo sismo comparando la **hora de origen estimada** —cada una
resta su propia latencia— con un margen de 120 s. Cuando llega el USGS, que trae la hora
medida, todos los desfases se recalculan contra ella y dejan de ser aproximaciones.

**La alarma suena una sola vez por episodio.** Las fuentes posteriores enriquecen el
registro pero no repiten el sonido: avisar tres veces del mismo sismo es peor que avisar
una. Lo que **no** se calla es el protocolo: si el feed clasifica el sismo como fuerte y
cercano, la cuenta atrás de "Estoy bien" arranca aunque la alarma ya hubiera sonado por
Google. Que Google avisara antes no significa que el usuario esté bien; significa lo
contrario.

**Escucha de la alerta de Google: es el punto de entrada rápido de la app.** Google nunca publicó una API, pero su notificación se puede interceptar con `NotificationListenerService`. El filtro se hace **por identificador de canal**, no por texto: es robusto frente al idioma y a cómo Google redacte el mensaje.

**Qué datos da esa notificación, y cuáles no.** Es lo que condiciona cuánto se le puede
confiar:

| Dato | Disponibilidad |
|---|---|
| Canal, y con él el nivel de la alerta | **Fiable** — identificador estable |
| Instante de recepción (`postTime`) | **Fiable** — es el t₀ contra el que se mide todo lo demás |
| Magnitud estimada y distancia | **Frágil** — vienen en prosa dentro del texto, sujetas a idioma y redacción |
| Profundidad, coordenadas, identificador del evento | **No vienen** — Google no se los muestra al usuario |

El `contentIntent` es un `PendingIntent` opaco: los datos estructurados que Google pasa a
su propia pantalla de detalle no se pueden leer desde fuera. Por eso la app **vuelca los
extras crudos completos a la bitácora** en lugar de interpretarlos y descartarlos: la
redacción exacta en español para Colombia no se puede verificar sin una alerta real, y
no hay forma de forzar una de prueba. Guardando el texto tal cual, la primera alerta real
queda capturada entera y de ahí sale el intérprete. El parseo de magnitud y distancia es
**best-effort y la app nunca depende de que funcione**: con el canal y la hora ya alcanza
para abrir el episodio y arrancar la medida.

**La medida arranca en Kotlin, no en JavaScript.** El servicio de notificaciones enciende
el acelerómetro directamente al reconocer el canal. Rebotar por JavaScript costaría
tiempo y dependería de que ese hilo no estuviera ocupado, y la ventana completa son 23-58
segundos. Como el servicio puede recibir una alerta con el runtime de JavaScript muerto
—una alerta de madrugada con la app cerrada—, tanto la alerta como la medida resultante
se guardan en un buzón nativo que JavaScript vacía al despertar.

Toda la app corre en **un solo teléfono**. No hay diseño de dos equipos: se descartó usar un segundo celular como sensor porque Google ya resuelve la detección con millones de teléfonos, y uno solo no puede igualar esa red. El acelerómetro del propio teléfono sí se usa, pero para medir, no para detectar.

**Consecuencia que hay que asumir:** la **detección** rápida depende por completo de un sistema ajeno que **ya falló de forma grave** (ver §5, Turquía 2023). Eso no tiene remedio desde un solo teléfono. Lo que sí se puede hacer, y se hace, es no depender de él para lo demás:

- El **acelerómetro** mide la sacudida real sin importar lo que Google haya estimado. En Turquía habría medido un M7.8 aunque la alerta dijera M4.5. No adelanta el aviso, pero **desmiente al que se equivoca**.
- El **feed del USGS** confirma con datos revisados, mucho más lento pero sin compartir modo de fallo con ninguno de los otros dos.

Son tres capas que fallan por causas distintas: Google por error de estimación o falta de red, el sensor porque el teléfono iba en movimiento, el feed porque el servicio cayó o no hay internet. Ninguna cubre a las otras, y por eso conviven.

Canales de `com.google.android.gms`, grupo `Personal_Safety_Id`:

| Canal | Nombre visible | Tratamiento |
|---|---|---|
| `eew_alert_v2` | Alerta de sismo temprana | Dispara respuesta |
| `eew_notification_v2` | Notificación de alerta de sismo temprana | Dispara respuesta |
| `eew_update` | Actualizaciones de la alerta de sismo temprana | Solo se registra |

Si aparece un canal desconocido en un paquete vigilado, se registra y se avisa: es la señal de que Google cambió el formato.

Requisitos y límites de esta vía: exige el permiso de acceso a notificaciones, que es amplio (lee **todas** las notificaciones del teléfono); Android 14+ no vincula el servicio hasta el primer desbloqueo tras reiniciar; y requiere que el proceso de la app esté vivo, cosa que el servicio en primer plano ya garantiza mientras el monitoreo esté activo.

### Fase 2 · Durante

La fase más pobre y la más difícil. Google ya ocupa la pantalla con su instrucción, así que aquí solo cabe lo que él no hace.

| Función | Estado |
|---|---|
| Alarma sonora, destello de pantalla, linterna y vibración configurables por nivel | **construido** |
| Notificación a pantalla completa que enciende la pantalla sobre el bloqueo | **construido** |
| Medición de la intensidad real en la ubicación con el acelerómetro | **construido** |
| Giroscopio como discriminador: separa la sacudida del suelo del movimiento del usuario | **construido** |
| Encendido automático de linterna al detectar la alerta de Google | **abierto** |
| Pantalla de acción con una sola instrucción en letra grande, legible sin enfocar la vista | **abierto** |
| Calibración de los umbrales de sacudida y del veredicto del giroscopio con datos reales | **abierto** |
| Actualizar el texto de la notificación cuando el sensor confirma la sacudida | **abierto** |

**Sobre sonar encima de Google.** La alerta "Toma medidas" ya toma la pantalla y suena fuerte. Añadir un segundo sonido simultáneo confunde más de lo que aporta. La linterna y la cuenta atrás sí son ganancia limpia porque Google no hace ninguna de las dos.

**Sobre qué instrucción dar.** La recomendación de evacuar en los primeros 30 segundos aplica a pisos bajos y a lugares con alerta anticipada real. En un piso alto, la ventana disponible no alcanza para salir del edificio, y mandar a alguien a la escalera cuando llega la onda S es peor que no decir nada. La instrucción debe depender de la intensidad estimada y del piso del usuario, no solo de la magnitud.

**Qué mide el acelerómetro, y con qué reservas.** La intensidad sale del pico de
aceleración, tomado como magnitud del vector para no depender de cómo esté acostado el
teléfono, y se convierte a Mercalli con la relación de Wald (1999). Esa relación se
calibró con sismómetros, no con teléfonos, y un acelerómetro de teléfono no está
calibrado ni se sabe cómo está acoplado al suelo: **la intensidad se rotula "estimada"
en todas partes** y fuera del rango donde la relación es válida se dice explícitamente.
No se calcula velocidad pico: integrar la aceleración sin corrección de línea base
acumula deriva y produce un número que parece dato y no lo es.

**El giroscopio no mide la sacudida, la descarta.** Un teléfono apoyado durante un sismo
se traslada, casi no rota. Su utilidad es la inversa: caminar con el teléfono en el
bolsillo produce aceleraciones parecidas a un sismo moderado, pero con una firma de
rotación que el suelo no tiene. Sin él, cualquier umbral se dispara solo cuando el
usuario se mueve.

### Fase 3 · Después

Donde la app tiene más valor único y menos construido.

| Función | Estado |
|---|---|
| Protocolo de hombre muerto: cuenta atrás y botón "Estoy bien" | **construido** |
| Baliza Bluetooth visible sin emparejar, con texto editable | **construido** |
| Baliza sonora periódica para localización bajo escombros | **construido** |
| Vigilancia de réplicas con el acelerómetro tras una alerta roja | **construido**, pendiente verificar que HyperOS no la mate |
| Malla Bluetooth mediante fork de bitchat, encendida y apagada por esta app | **construido**, pendiente probar entre dos aparatos |
| Ficha de triaje automática por la malla | **construido**, pendiente probar entre dos aparatos |
| Apodo SOS visible en la lista de pares de la malla | **decidido** |
| Ventana de vigilancia de réplicas dimensionada con la ley de Omori | **abierto** |
| Detección de inmovilidad del teléfono como señal para el hombre muerto | **abierto** |
| Guía de acción según intensidad estimada y perfil de edificación | **abierto** |
| Lista de verificación offline: gas, estructura, evacuación, agua | **abierto** |
| Punto de encuentro y contactos de emergencia | **abierto** |
| Registro de daños observados | **abierto** |

**El envío automático de SMS fue retirado.** Android no concede `SEND_SMS` a esta app, así que el envío nunca llegaba a ocurrir y solo aportaba la ilusión de un aviso remoto inexistente. Los dos mecanismos que quedan son de alcance local y no dependen de red ni de permisos que el sistema niega.

**Las réplicas son el caso donde la latencia del feed no importa.** Una réplica ocurre horas o días después del evento principal, así que 4-7 minutos de retraso son irrelevantes. Es la función donde el feed del USGS rinde al máximo.

Tras una alerta roja el acelerómetro queda vigilando a ritmo bajo durante horas, y salta
a ritmo alto en cuanto la sacudida cruza el umbral. El ritmo bajo lo atiende el
coprocesador de sensores y cuesta muy poco; el alto solo ocurre en ventanas acotadas. Es
la única capa que ve una réplica con latencia cero, sin depender de que haya red.

#### Tres capas de alcance, no una

Cada capa llega a alguien distinto y ninguna reemplaza a las otras:

| Capa | A quién alcanza | Qué le exige |
|---|---|---|
| **Baliza sonora** | Quien está encima de los escombros | Nada |
| **Baliza Bluetooth** | Cualquiera con un celular, a 10-30 m | **Nada**: aparece en la lista normal de Bluetooth, sin app ni emparejamiento |
| **Malla bitchat** | Varios saltos de distancia, conversación real | Tener la app instalada |

**El teléfono en la baliza no aporta nada y se retiró.** Si la red celular funciona, el afectado habría podido pedir ayuda él mismo; si no funciona, un número es inútil. Sus 26 caracteres nunca iban a caber una ficha médica.

Con ese espacio libre la baliza lleva ahora **dónde está y por qué canal se sabe el resto**: `SOS Esteban ap715 bitchat`, 25 de 26 caracteres. El apartamento es lo accionable para quien está parado en el edificio y "bitchat" es el puntero al canal; se abrevian ambos antes que soltar uno. **El texto es editable**, porque el útil depende de dónde esté el usuario: "apartamento 715" no significa nada si le pasa algo en la calle. La interfaz muestra el contador y la vista previa de lo que realmente se va a emitir, o Android recortaría en silencio y el usuario se enteraría en plena emergencia.

**La baliza y el nodo de la malla son dos señales distintas.** La baliza cambia el nombre del adaptador Bluetooth y aparece en la lista normal de cualquier teléfono, sin apps. bitchat no escanea eso: tiene su propio protocolo y su propia lista. Quien instale bitchat no verá la baliza, y por eso el apodo SOS en la malla sigue pendiente.

#### Ficha de triaje

**Se envía al DESCUBRIR a alguien en la malla, no al recibir un mensaje suyo.** Quien encuentra al afectado acaba de instalar la app y no tiene por qué saber que debe escribirle; esperar a que lo haga sería perder el rescate por una convención de interfaz. También se responde a un mensaje entrante, por si el envío del descubrimiento se perdió.

El mensaje está escrito para quien lo lee, no para quien lo programó: abre con nombre completo y la petición directa de ayuda. Explicar el mecanismo —"no confirmé estar bien tras un sismo"— obliga a entender cómo funciona la app antes de entender que hay una persona en problemas.

Contiene: aviso de que es automático, nombre y apellidos, datos médicos, dónde está, **batería**, **tiempo transcurrido**, **si hay salida a internet**, contactos de emergencia y quién más vive en la casa.

Tres de esos datos no se pueden obtener de ninguna otra forma:

- La **batería** marca el plazo en que la señal dejará de existir.
- El **tiempo transcurrido** determina la prioridad frente a otros rescates.
- La **conexión a internet** dice por dónde seguir hablando, y algo más: si el teléfono tiene salida y aun así nadie responde, el silencio no es de la red sino de la persona. Con internet se ofrece el WhatsApp del usuario, porque esa vía aguanta lo que una malla Bluetooth de varios saltos no aguanta; sin internet se advierte que el canal depende de la distancia y se pide que dejen instrucciones igualmente.

**La dirección de casa solo se envía si el teléfono cree que el usuario está en ella**, y lo mismo con quién más vive allí. Mandar "apartamento 715" desde la calle no es información incompleta: es información falsa, y envía a quien busca al lugar equivocado. Como la app usa ubicación aproximada, solo puede descartar con certeza que esté cerca; dentro del radio es probable y el mensaje nunca lo afirma como un hecho. Cuando no se puede determinar, la dirección se ofrece marcada como no confirmada: ocultarla perdería el único dato que existe y afirmarla sería mentir.

#### Regla de privacidad, innegociable

**El auto-respondedor solo existe mientras el modo emergencia está activo.** Fuera de emergencia, el fork debe ser indistinguible de bitchat normal.

Un respondedor siempre activo convierte la app en una fuga de historia clínica y ubicación hacia cualquiera en rango de Bluetooth. La app se va a instalar en teléfonos de familiares y su código será público, así que esta regla se verifica explícitamente en ambos sentidos: con la emergencia apagada, nadie recibe nada.

Al terminar la emergencia se **borra** la ficha del lado del fork, y con ella lo que ese teléfono retuviera para terceros. Dejarlo guardado sería dejar datos de un episodio cerrado a merced de que un fallo posterior encendiera el modo por error.

Se insiste **como mucho tres veces por par y por episodio, separadas cinco minutos**. No es "una sola vez", y la diferencia importa: sin confirmación de entrega, dar por bueno el primer envío deja sin ficha a quien lo pierda —el proceso puede morir antes de enviar, o el mensaje caer en una caché volátil—. El tope existe para no convertir la malla en un bucle cuando el ancho de banda y la batería son lo que más escasea.

#### Arquitectura de la integración

Dos apps separadas que se comunican por IPC, **no** código de bitchat dentro de Alerta Sismo. Esto es a la vez lo técnicamente limpio y lo legalmente obligatorio (ver §5: la licencia real es GPL v3).

Puntos de enganche localizados en el código de bitchat:

| Necesidad | Ubicación |
|---|---|
| Recibir mensaje privado | `ui/PrivateChatManager.kt` → `handleIncomingPrivateMessage()` |
| Responder | `mesh/MeshService.kt` → `sendPrivateMessage(content, peerID, nickname, messageID)` |
| Estado persistente | `services/AppStateStore.kt` |
| Acceso a la malla desde fuera | `service/MeshServiceHolder.kt` |

Todo lo añadido es **lógica de aplicación**: no se toca el protocolo, ni la capa BLE, ni el cifrado. Esa es la condición para no perder compatibilidad con usuarios de bitchat original.

Hay que **añadir un servicio exportado** al fork, protegido con permiso de firma para que solo Alerta Sismo pueda invocarlo. Hoy bitchat no expone ninguno: `MeshForegroundService` y todos sus receptores son `exported="false"`, y `TransportBridgeService` no es un servicio de Android sino un objeto Kotlin que puentea BLE con Wi-Fi Aware internamente.

#### Quién manda sobre la malla

**Alerta Sismo la enciende y la apaga; bitchat no corre por su cuenta.** Mantener la malla viva permanentemente gastaría batería sin parar para cubrir un evento que puede no ocurrir en años.

Se enciende al vencer el protocolo de emergencia y se apaga al pulsar "Estoy bien", que además hace que el fork borre la ficha. Ese botón **termina la emergencia en el acto** y la app vuelve a su modo normal de monitoreo; la malla se corta en seco y es lo correcto: si el usuario ya dijo estar bien, no hay nada que seguir difundiendo.

El fork lleva además un **plazo máximo de encendido** (6 horas por defecto). Es un interruptor de seguridad, no una preferencia: si Alerta Sismo muriera sin llegar a dar la orden de apagado, bitchat se quedaría escaneando indefinidamente. Se programa con `AlarmManager` porque un plazo de horas tiene que sobrevivir justo al escenario del que protege.

**El fork no pide ubicación permanente.** Se retiraron la ubicación de segundo plano y la precisa, y se declara `neverForLocation` en el escaneo Bluetooth: desde Android 12 basta con afirmar que no se deduce la posición a partir de los resultados, que aquí es cierto porque solo se descubren dispositivos. Pedir seguimiento continuo para algo que vive minutos al año es pedir mucho más de lo que se devuelve.

**La cola de reenvío se persiste en disco**, apartándose del diseño original. bitchat la guarda solo en memoria, y para un chat es razonable: evita escribir a disco tráfico cifrado de terceros que va de paso. Aquí el cálculo es otro — si el usuario está inconsciente y alguien le escribió algo que puede cambiar el desenlace, perderlo porque el sistema mató el proceso no es aceptable. Se persiste **solo durante la emergencia** y se borra al terminarla.

Alcance de eso, para no prometer de más: protege lo que **este** teléfono retiene. Lo que otra persona guarda para el usuario vive en la cola de su teléfono, y si tiene el bitchat de la tienda seguirá siendo volátil.

#### Secuencia de trabajo, con puertas

El riesgo real no es programar: es invertir semanas y descubrir al final que la malla no atraviesa una losa de concreto.

1. **Verificar la malla entre dos aparatos** — sigue sin hacerse, y es lo único que puede confirmar que todo lo demás sirve.
2. Compilar el fork sin modificar — **hecho**.
3. Modo emergencia y servicio expuesto — **hecho**.
4. Auto-respondedor — **hecho**.
5. Integración desde `activarProtocolo()` y `confirmarEstoyBien()` — **hecho**.
6. Apodo SOS visible en la lista de pares de la malla — pendiente.
7. Resolver el conflicto de radio (ver §5).

**Renombrar el paquete dejó de hacer falta**: se desinstaló el bitchat de la tienda y el fork ocupa su lugar. Ambas apps se firman ahora con la **misma clave**, que es de lo que depende el permiso de nivel de firma que protege el servicio expuesto.

---

## 4. Otras emergencias

Estructura preparada, contenido pendiente. Se desarrollarán después del sismo.

| | Incendio | Inundación | Ataque / atentado |
|---|---|---|---|
| **Fase 1 · Monitoreo** | abierto | abierto | abierto |
| **Fase 2 · Durante** | abierto | abierto | abierto |
| **Fase 3 · Después** | abierto | abierto | abierto |

**Componentes ya reutilizables sin cambios**, por ser agnósticos al tipo de emergencia: protocolo de hombre muerto, baliza Bluetooth, baliza sonora, bitácora, ubicación guardada, contactos de emergencia y monitoreo de servicios. Buena parte del trabajo para estas emergencias ya está hecho.

**Diferencia clave a tener en cuenta:** el sismo no se puede predecir pero sí detectar a distancia. El incendio es lo contrario — es local, y la detección probablemente venga del propio usuario o de sensores del hogar, no de un feed. La fase 1 de cada emergencia se parecerá poco a las demás; las fases 2 y 3 se parecerán mucho.

---

## 5. Restricciones y hallazgos medidos

Datos duros que condicionan cualquier diseño. Las fechas indican cuándo se midió, porque la vigencia del dato depende de ello.

**Latencia del feed del USGS** *(medido 2026-08-12)*
Mediana de publicación 3,6 min; el evento más reciente presente en el feed tenía 4,9 min; piso práctico ~2 min. Sumando el sondeo de la app, el total real es de **4 a 7 minutos** desde que ocurre el sismo.

**Ventana física disponible en Medellín** *(calculado sobre 148 sismos M4.0+ de 12 meses)*
La onda S llega entre **23 y 58 segundos** en los sismos que importan. El M7.4 a 172 km y 110 km de profundidad dio 58 s. **La app llega entre 5 y 15 veces más tarde que el ancho completo de la ventana**, por lo que ninguna mejora sobre un feed HTTP la cierra. La única vía a los segundos es la alerta de Google.

Este número está **calculado, no medido**. La app ya está instrumentada para medirlo: en
cada sismo cruza la hora de la notificación de Google con el instante en que el
acelerómetro detecta la llegada de la onda, y guarda el resultado. Hasta que ocurra un
sismo real con alerta, sigue siendo un cálculo.

**La alerta naranja no puede dispararse** *(medido sobre 60 días de sismicidad colombiana, 37 eventos)*
La regla `mag ≥ 4.0 && profundidad < 10 km` se cumplió en **0 de 37** eventos: ninguno estuvo a menos de 10 km de profundidad. La sismicidad colombiana es de profundidad intermedia — 26 eventos entre 10-70 km y 11 entre 70-300 km. La regla de enjambre exige 3 sismos en 50 km y 30 min cuando la tasa real es de **uno cada 39 horas** en todo el país. Ambas condiciones son inalcanzables con esta fuente.

**Cobertura del USGS en Colombia** *(mismo periodo)*
No reportó **ningún** sismo colombiano bajo M4.0. La franja M3.5-3.9 de la regla amarilla no existe en esta fuente.

**Disponibilidad de intensidad** *(mismo periodo)*
`mmi` llegó en 3 de 37 eventos (**8%**); `cdi` y `felt` en 22 de 37 (59%). La función de intensidad percibida devuelve nulo el **41%** de las veces. Cualquier regla que dependa de intensidad medida falla en silencio casi la mitad del tiempo — de ahí la propuesta de calcularla.

**Sistema de Google**
Alerta solo desde **M4.5**. Su primera alerta en un M6.7 en Filipinas salió a los **18,3 s**. Ha fallado de forma grave: en el terremoto de Turquía de 2023 estimó M4.5-4.9 lo que era M7.8 y envió 469 alertas de nivel alto donde correspondían ~10 millones. **Es la vía más rápida disponible y a la vez no es suficiente por sí sola.**

**Cada componente corre solo cuando se le necesita** *(decisión de diseño, no medida)*
Nada queda encendido "por si acaso". El reparto es este:

| Componente | Cuándo corre |
|---|---|
| Sondeo del USGS | Cada 60 s con monitoreo activo. **Cada 15 min si el protocolo de emergencia se disparó**, y cada 5 min sin internet |
| Ventana de medida a 100 Hz | Solo tras un disparo, y acotada en segundos |
| Vigilancia de réplicas a 5 Hz | Solo tras una alerta roja, y con el sensor acumulando en tandas |
| Escucha de la alerta de Google | Siempre, pero la vincula el sistema y solo despierta cuando llega una notificación |
| Malla de bitchat | Solo durante la emergencia, con plazo máximo de encendido |
| Baliza Bluetooth | Solo durante la emergencia |
| Baliza sonora | Solo durante la emergencia, y espaciándose con el tiempo |
| Lectura del GPS | Solo al abrir la app, como mucho cada 12 h |

**Con el protocolo activado se espacia el sondeo del feed.** Si venció sin confirmación se asume que el usuario no puede responder, así que consultar cada minuto gasta radio y batería para producir un aviso que nadie va a leer. Y la batería es literalmente la ventana de rescate: la propia ficha le dice a quien busca que cuando se agote, la señal desaparece. No se apaga del todo porque el registro sísmico de esas horas —las réplicas sobre todo— tiene valor después.

**La baliza sonora suena al máximo del sistema y va espaciándose.** Subir el volumen del sistema no es un detalle: poner el reproductor al 100% solo da el 100% *de lo que tenga puesto el teléfono*, y de madrugada suele estar bajo — justo cuando el usuario menos puede reaccionar. Se guarda el volumen previo y se devuelve al terminar.

La cadencia no es fija porque el problema cambia con el tiempo: cada 30 s la primera hora, cada 5 min hasta la cuarta, y cada 30 min a partir de ahí. En la primera hora quien busca son vecinos que están al lado *ahora*. Pasado ese rato el rescate se mide en días y lo que decide si te encuentran deja de ser la frecuencia y pasa a ser cuánto dura la batería: una baliza que suena cada 30 s y muere en ocho horas pierde contra una que suena cada media hora durante tres días. En 24 horas son 196 emisiones en vez de 2880.

**El sensor tiene dos modos y la diferencia decide la batería.** En ventana corta sostiene el procesador despierto y recibe las muestras al instante, que es lo que exige medir un sismo. En la vigilancia de réplicas no lo sostiene: le pide al coprocesador de sensores que **acumule y entregue en tandas**, como hacen los pulsómetros para medir todo el día. Un wake lock de seis horas arrasaría la carga justo cuando más falta hace. El precio es que ahí el aviso llega con retraso, y se acepta: en ese modo se están *registrando* réplicas, no avisando de ellas.

**Entorno de referencia**
Redmi Note 13 Pro, Android 16 (SDK 36), HyperOS OS3.0, Play Services 26.29.32. La app apunta a `targetSdkVersion` 34 deliberadamente, para quedar fuera del límite de 6 horas que Android 15 impone a los servicios en primer plano de tipo `dataSync`.

**El acelerómetro del equipo de referencia rinde lo pedido** *(medido en el equipo)*
Un LSM6DSO de ST entrega **102 Hz reales cuando se piden 100**, así que el muestreo no
es un limitante. En reposo sobre una superficie el pico medido es de **0,003 g**; movido
a mano, **0,084 g**. La diferencia de casi treinta veces confirma que el filtro de
gravedad funciona: sin él la lectura en reposo sería de ~1 g constante.

**Los canales de alerta sísmica de Google existen y no están bloqueados** *(medido en el equipo)*
Los tres están presentes en `com.google.android.gms`, grupo `Personal_Safety_Id`, con
`mDeleted=false` e importancia 4. Dato nuevo que ayuda a distinguirlos: `eew_alert_v2`
tiene **vibración activada** y `eew_notification_v2` no, aunque ambos comparten el sonido
`be_aware_alert_sound`; `eew_update` no tiene sonido. Apunta a `eew_alert_v2` como el
más intrusivo, pero **no es concluyente**: el aviso fuerte de Google usa notificación a
pantalla completa con su propio sonido, no el del canal.

**El servicio de escucha sí se vincula bajo HyperOS** *(medido en el equipo)*
Aparece en `Live notification listeners` del sistema tras conceder el permiso. Queda
descartado que HyperOS lo bloquee, que era un riesgo abierto. Lo que **no** se pudo
verificar es el interruptor maestro de las Alertas de Terremotos de Google: sigue
guardado por Play Services en preferencias no legibles sin root.

**MIUI / HyperOS mata servicios en segundo plano de forma agresiva.** Para que el monitoreo sobreviva, la app requiere autoarranque activado, batería sin restricciones y estar fijada en la pantalla de recientes. Sin eso ninguna app de monitoreo sobrevive en un Xiaomi, y el vigilante solo puede reparar el daño después de producido.

### Hallazgos sobre bitchat

**La licencia real es GPL v3, no dominio público.** El README dice literalmente *"released into the public domain"* y enlaza a `LICENSE.md`, pero ese archivo son 674 líneas de GNU GPL v3. El repositorio se contradice a sí mismo. Ante la duda manda el archivo de licencia.

Consecuencia directa: **bifurcar y modificar está permitido**, pero un derivado distribuido debe publicarse bajo GPL v3. E **incorporar código de bitchat dentro de Alerta Sismo arrastraría toda la app a GPL v3**. La arquitectura de dos apps separadas comunicándose por IPC evita esa propagación, y por eso es la elegida.

**El código de `main` va por delante de la versión publicada.** Play Store distribuye la **1.7.4** (código 35); `main` compila la **2.0.1** (código 38). Entre ambas el protocolo pudo cambiar, así que **las pruebas de malla deben hacerse primero con la misma versión en ambos equipos**. Probar 2.0.1 contra 1.7.4 mide algo distinto —si el fork podrá hablar con quien tenga la versión de tienda— y también hace falta, pero por separado.

**El fork compila en Windows tras una corrección.** El proyecto fija los checksums de todas sus dependencias en `gradle/verification-metadata.xml` como defensa de cadena de suministro, y le falta el `aapt2` de Windows porque upstream no compila en esa plataforma. Se añadió su entrada tras contrastar el SHA-256 local contra el que Google publica por separado. **No se desactivó la verificación**, que habría anulado la protección para todas las dependencias. Es una corrección de tres líneas que conviene aportar a upstream.

**Conflicto de radio pendiente de medir.** `EmergenciaModule.kt` cambia el **nombre global del adaptador Bluetooth** al activar la baliza. Con la malla corriendo en el mismo teléfono hay que verificar si eso la afecta, y decidir cuál capa cede si interfiere.

---

## 6. Seguridad y privacidad

**Aplazada al final del desarrollo**, por decisión explícita. Se documenta ahora porque condiciona decisiones que se toman antes.

La app va a acumular permisos muy sensibles: acceso a **todas** las notificaciones del teléfono, ubicación, Bluetooth, cámara/linterna y ejecución permanente. Se instalará en teléfonos de familiares y el repositorio será público.

Puntos a resolver:

- **Qué datos salen del teléfono.** Hoy: ninguno. Hay que garantizarlo y hacerlo verificable, no solo afirmarlo.
- **Protección de la bitácora**, que contiene ubicación e historial de movimientos.
- **El acceso a notificaciones es la superficie más delicada**: una app con ese permiso en el teléfono de un familiar puede leer todo lo que le llega. Es opcional, se explica al pedirlo y la app funciona sin él —solo pierde los minutos de ventaja y se queda con el feed—. Queda por resolver cómo **demostrar** que solo se leen los canales de sismo, que hoy solo está garantizado por el código.
- **Integridad del APK distribuido**, para que nadie instale a un familiar una versión modificada.
- **Qué ocurre si alguien con acceso físico al teléfono desactiva el protocolo** sin que el usuario se entere.
- **Riesgo de fork malicioso** del repositorio público.

---

## 7. Pendientes abiertos

**Lo siguiente que hay que hacer, en orden:**

1. **Probar la malla.** Sigue siendo la puerta, y ahora bloquea código ya escrito en vez de código por escribir. Requiere **dos aparatos, como instrumental de prueba** — una malla no se puede verificar con un solo nodo. Instalar **la misma versión compilada** en ambos, probar en la misma habitación, luego con una losa de concreto de por medio, y **con datos y wifi apagados en los dos** — bitchat cae a Nostr por internet cuando la malla no alcanza, así que sin apagar la red se puede creer que funciona el Bluetooth cuando el mensaje viajó por el celular. Medir a qué distancia se pierde.
2. **Comprobar que la ficha llega sola**, sin que el segundo aparato escriba nada: es la premisa de todo el diseño y hoy no está verificada.
3. Probar por separado si la versión compilada habla con la de Play Store, que es el escenario de familiares y rescatistas.

**Al instalar el fork:** conserva el mismo `applicationId` (`com.bitchat.droid`), así que Android rechaza instalarlo encima del de Play Store y hay que desinstalar ese primero, perdiendo su identidad e historial. Ya está hecho en el equipo de referencia.

En Xiaomi la instalación por cable falla con `INSTALL_FAILED_USER_RESTRICTED` **si la pantalla está bloqueada**. No es un problema del paquete: basta con desbloquearla.

**Verificaciones en el equipo de referencia, pendientes:**

- **Que la ventana de medida sobreviva con la pantalla apagada.** Es lo que valida el
  `PARTIAL_WAKE_LOCK`: lanzar una medida, apagar la pantalla y comprobar que la ventana
  se completa en vez de quedarse a medias.
- **Que HyperOS no mate la vigilancia de réplicas.** Es la parte más expuesta, porque
  dura horas y §5 ya documenta lo agresivo que es ese sistema matando procesos. Que el
  servicio de escucha sí sobreviva no dice nada sobre esto: al de escucha lo sostiene el
  sistema, a la vigilancia no.
- **Calibrar el umbral de sacudida y los umbrales del giroscopio.** Hoy están puestos a
  ojo y por eso el veredicto se registra pero no decide nada. Ya hay una señal de que
  hacen falta: una prueba con el teléfono manipulado a mano dio veredicto "el suelo se
  movió", que es justo el falso positivo que el giroscopio debería descartar.

**Otros pendientes:**

- Cómo se activa la alerta sísmica propia de Xiaomi (`key_open_earthquake_warning`, hoy en 0) y si aporta algo sobre la de Google en Colombia.
- Confirmar que el interruptor maestro de las Alertas de Terremotos de Google está activo. Los canales existen y no están bloqueados (§5), pero el interruptor lo guarda Play Services en preferencias no legibles sin root.
- Zanjar cuál de `eew_alert_v2` y `eew_notification_v2` es "Toma medidas". La configuración de los canales apunta al primero (§5) pero no lo demuestra; solo una alerta real lo confirma, y la app ya guarda los extras crudos de cada una para resolverlo en cuanto ocurra.
- Ajustar el intérprete del texto de Google a su redacción real en español. Hasta que llegue una alerta real se trabaja a ciegas, y por eso nada depende de que funcione.
- Abrir un issue en bitchat pidiendo que aclaren la contradicción de licencia entre README y `LICENSE.md`. Hace falta certeza antes de publicar un derivado.
- **El `LICENSE` de este repo es el MIT que trae Expo por defecto, con copyright de "650 Industries, Inc. (aka Expo)".** No es el de este proyecto. Hay que reemplazarlo antes de publicar.
- Que el apodo del nodo en la malla pase a `SOS <nombre> ap<apto>` durante la emergencia. Sin eso, quien instale bitchat recibe la ficha automáticamente pero no ve ninguna señal de auxilio en su lista de pares.
- **"Instala bitchat" exige internet, justo lo que se cae tras un sismo.** Funciona para familia que ya lo tenga; no para un rescatista externo. Sin resolver.
- Mantener un fork tiene costo: si bitchat cambia el protocolo, el fork se cae de la red sin avisar. Conviene vigilar el repositorio de origen.
