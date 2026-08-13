# Alerta Sismo

App Android de apoyo ante emergencias sísmicas. Mide cuánto se sacudió donde estás, registra lo ocurrido cruzando varias fuentes y activa un protocolo de localización si quedas incapacitado.

Construida para uso personal y familiar en Colombia. El código es público por si le sirve a alguien más.

---

## ⚠️ Lee esto antes de instalarla

**Esta app no detecta sismos por sí sola, y nunca va a avisarte antes que tu propio teléfono.**

Detectar un sismo en segundos exige una red de miles de sensores. Google la tiene: usa los acelerómetros de millones de teléfonos Android. Un teléfono solo no puede igualar eso, y la app ni siquiera lo intenta.

**El aviso anticipado real ya lo tienes en tu teléfono.** Se llama Alertas de Terremotos de Android, viene incluido y avisa con segundos de antelación. Actívalo en:

> Ajustes → Seguridad y emergencias → Alertas de terremotos

Si solo vas a hacer una cosa por tu seguridad sísmica, que sea esa, no instalar esta app.

### Entonces, ¿de qué sirve esta app?

Para todo lo que viene **después** de que alguien dé el aviso, que es donde Google se detiene. Trabaja con tres fuentes, cada una con una velocidad y un modo de fallo distintos:

| Fuente | Cuándo llega | Qué aporta |
|---|---|---|
| **Alerta de Google** | ~18 s tras el sismo | La app se entera de que viene y empieza a medir. **El aviso es de Google, no de la app** |
| **Acelerómetro del teléfono** | 23-58 s (al llegar la onda) | Cuánto se sacudió **en tu dirección exacta**, que es lo único que nadie más puede decirte |
| **Feed del USGS** | 4-7 min | Magnitud revisada, profundidad y coordenadas: los datos que hacen falta si hubo catástrofe |

Las tres se cruzan en un solo registro por sismo, y de ahí sale lo que ninguna da por separado: **cuántos segundos de aviso hubo de verdad** y si las fuentes se contradicen.

**Sobre lo de engancharse a Google:** es opcional y requiere concederle a la app acceso a las notificaciones, que es un permiso amplio ([lee esto](#el-permiso-de-notificaciones-léelo-con-calma)). Sin ese permiso la app funciona igual, pero solo se entera por el feed, minutos después.

**Y sobre el feed del USGS:** publica los sismos entre 2 y 6 minutos después de ocurridos; sumando el ciclo de consulta, la app se entera **entre 4 y 7 minutos después**. Para entonces la sacudida ya pasó. Eso no lo hace inútil —es la fuente que trae los datos duros, y para vigilar réplicas su retraso da igual— pero no esperes que te avise de nada.

---

## Qué hace

**Monitoreo**
- Consulta sismos cada 60 segundos mediante un servicio permanente, aunque cierres la app
- Evalúa si el sismo te afecta según tu ubicación, la magnitud, la profundidad y la distancia
- Tres niveles de alerta con sonido, destello de pantalla, linterna y vibración configurables por nivel
- Alerta a pantalla completa que enciende la pantalla sobre el bloqueo
- Hiberna cuando no hay internet y **se reanuda sola** en cuanto vuelve la señal
- Se revive sola si el sistema operativo mata el servicio
- Semáforo con el estado de cada fuente por separado, porque fallan por motivos distintos

**Medida local de la sacudida**

Cuando algo dispara una alerta, el acelerómetro abre una ventana y mide lo que realmente pasó donde estás. Es el único dato que no puede darte ninguna otra fuente: la intensidad varía mucho con el suelo, el edificio y el piso, y Google estima para una región entera.

- Aceleración máxima e **intensidad Mercalli estimada** a partir de ella
- El giroscopio distingue "el suelo se movió" de "moviste el teléfono", que si no se separa dispara falsos positivos con solo caminar
- Botón de prueba de 10 segundos: agitas el teléfono y ves el número, sin esperar a que haya un sismo
- Tras un sismo fuerte queda vigilando réplicas a bajo consumo durante horas

La intensidad va **siempre rotulada como estimación**. La fórmula se calibró con sismómetros, no con teléfonos, y un acelerómetro de celular no está calibrado ni se sabe cómo está apoyado. Sirve para dar una escala, no para publicar un dato.

**Un solo registro por sismo**

El mismo sismo llega hasta tres veces y en momentos distintos. La app los reconoce como el mismo evento y los junta, en vez de dejar tres apuntes sueltos que nadie sabría relacionar. La alarma **suena una sola vez**: si Google ya avisó, el feed no vuelve a sonar cinco minutos después. Lo que sí ocurre igual es el protocolo de emergencia, porque que Google avisara antes no significa que estés bien.

**Protocolo de emergencia**

Tras un sismo fuerte y cercano arranca una cuenta atrás. Si no confirmas que estás bien antes de que venza, se asume que puedes estar incapacitado y se activan dos mecanismos de localización:

- **Baliza Bluetooth** — tu teléfono aparece en la lista de Bluetooth de cualquier celular cercano con un nombre tipo `SOS Esteban ap715 bitchat`, sin necesidad de emparejar ni de instalar nada. Alcanza a quien está cerca y **no necesita red**. Ya no lleva teléfono: si la red funciona habrías podido pedir ayuda tú mismo, y si no funciona un número no sirve.
- **Baliza sonora** — sirena y voz alternadas, que dicen en voz alta qué hacer para encontrarte. A las personas bajo escombros se las encuentra por sonido: es el mecanismo más probado. La frecuencia **se va espaciando** según el tiempo transcurrido y la batería que quede, porque una baliza que suena mucho y muere en ocho horas pierde contra una que aguanta tres días.
- **Malla Bluetooth** — con el fork de bitchat instalado, quien te encuentre recibe automáticamente una ficha con tus datos médicos, dónde estás y desde cuándo. Solo durante la emergencia.

**Bitácora**

Registro permanente y **solo-anexar** de todo lo que ocurre: cada alerta con sus parámetros completos, las activaciones del protocolo, los cortes de conexión y las caídas del servicio. Nada se sobrescribe ni se borra solo. Únicamente se elimina cuando tú lo pides.

Cada episodio sísmico guarda además:

- El texto de la alerta de Google **tal como llegó**, sin interpretar. Google nunca publicó una API y su redacción puede cambiar sin aviso; guardar el original es lo único que permite reconstruir después lo que dijo de verdad.
- La medida del acelerómetro, con el ritmo de muestreo realmente conseguido.
- **Los desfases entre fuentes**: cuánto avisó Google antes de la sacudida, cuánto tardó cada una y si sus magnitudes coinciden.

Ese último bloque es el que permite auditar si todo esto sirve. Es también lo que delataría un fallo como el de Turquía en 2023, donde Google estimó M4.5-4.9 lo que era un M7.8.

---

## Qué NO hace

- **No detecta sismos.** Solo mide cuando otra fuente ya dio el aviso. Ver la advertencia de arriba.
- **No envía SMS.** Se retiró: Android no concede el permiso a esta app, así que el envío nunca ocurría y solo daba la ilusión de un aviso remoto inexistente.
- **No manda tus datos a ningún servidor.** No hay backend. La ubicación, la bitácora y todo lo que lee de las notificaciones nunca salen del teléfono. La única conexión saliente es la consulta al feed público del USGS.
- **No reemplaza a las Alertas de Terremotos de Google.** Se apoya en ellas.
- **No mide la sacudida si vas caminando.** Detecta que el movimiento eres tú y lo marca como tal, en vez de reportar un sismo que no ocurrió.
- **No funciona en iOS.** El protocolo de emergencia y la medida dependen de módulos nativos de Android.

---

## Instalación

### Desde el código

Requiere Node.js, JDK 17 y el SDK de Android.

```bash
git clone https://github.com/esrimova/alerta-sismo.git
cd alerta-sismo
npm install
npx expo prebuild --platform android
npx expo run:android
```

La carpeta `android/` no está versionada: la genera `prebuild` a partir de `app.json` y los plugins de `plugins/`.

Para generar un APK instalable:

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

Queda en `android/app/build/outputs/apk/release/app-release.apk`.

> **Necesitas tu propia clave de firma.** El proyecto espera un `keystore.properties` en la raíz —que no está versionado— apuntando a tu keystore. Sin él compila igual, pero firmado con la clave de depuración del toolchain, cuya clave privada es pública; y con esa clave el puente con la malla de emergencia deja de estar protegido, porque depende de un permiso de nivel de firma.

### Después de instalar

**En Xiaomi/Redmi (MIUI o HyperOS) esto no es opcional.** El sistema mata los servicios en segundo plano de forma agresiva y sin ello el monitoreo no sobrevive:

- Ajustes → Aplicaciones → Alerta Sismo → **Autoarranque: activado**
- Ajustes → Aplicaciones → Alerta Sismo → Ahorro de batería → **Sin restricciones**
- En la pantalla de apps recientes, **fija la app** con el candado

Concede además el permiso de **notificaciones a pantalla completa** cuando la app te lo pida. Sin él, una alerta de madrugada suena pero no enciende la pantalla.

Y comprueba que el sensor funciona antes de necesitarlo: en la tarjeta **Medida local de sacudida**, pulsa *Probar sensor 10 s* y agita el teléfono. Debe marcar bastante más de cero; en reposo sobre una mesa, casi cero.

---

## Permisos y por qué

| Permiso | Para qué |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | Consultar el feed del USGS y detectar cuándo vuelve la conexión |
| `FOREGROUND_SERVICE`, `WAKE_LOCK` | Mantener el monitoreo vivo con la app cerrada |
| `POST_NOTIFICATIONS`, `USE_FULL_SCREEN_INTENT` | Emitir alertas y encender la pantalla al llegar una |
| `VIBRATE`, `CAMERA`, `FLASHLIGHT` | Vibración y linterna durante la alerta |
| `ACCESS_COARSE_LOCATION` | Saber si un sismo te afecta. **La ubicación nunca sale del teléfono** |
| `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` | Baliza de localización en emergencia |
| `RECEIVE_BOOT_COMPLETED` | Reanudar el monitoreo tras reiniciar |
| Acceso a notificaciones | Escuchar la alerta sísmica de Google. **Opcional** — lee la sección de abajo |

El acelerómetro y el giroscopio **no necesitan permiso**. Android solo lo exige por encima de 200 Hz de muestreo, y la app se queda en 100.

La app **bloquea explícitamente** `SEND_SMS`, `READ_PHONE_STATE`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION` y el acceso al almacenamiento, para que ninguna dependencia pueda introducirlos sin querer.

### El permiso de notificaciones, léelo con calma

Para engancharse a la alerta de Google hace falta concederle a la app **acceso a las notificaciones**. Android no ofrece una versión limitada de ese permiso: es todo o nada. Técnicamente, una app con él **puede leer todas las notificaciones del teléfono** — tus mensajes, tus correos, tu banco.

Qué hace esta app con él, concretamente:

- Ignora todo lo que no venga del paquete `com.google.android.gms`.
- De ese paquete, solo mira los canales que empiezan por `eew` (*early earthquake warning*).
- El filtro es **por identificador de canal, nunca por el texto**. El texto depende del idioma y de cómo Google lo redacte; el canal es estable.
- Lo que guarda de esas notificaciones se queda en la bitácora del teléfono y no sale a ninguna parte.

Y lo que tienes que saber para decidir:

- **Es opcional.** Sin él la app funciona; solo pierde los minutos de ventaja.
- **Puedes revocarlo** cuando quieras en Ajustes → Notificaciones → Acceso a notificaciones.
- **Que yo diga que solo leo esos canales no es una garantía, es una afirmación.** Lo que la respalda es que el código es público y puedes leerlo: está en `modules/escucha-alertas/`. Si vas a instalarle esto a un familiar, es tu responsabilidad tanto como la mía.
- En Android 14 y posteriores, tras reiniciar el teléfono el sistema **no activa la escucha hasta que lo desbloqueas por primera vez**. La app te lo indica en el semáforo en vez de fingir que está lista.

---

## Estado del proyecto

En desarrollo activo. El objetivo es convertirla en un centro de manejo de emergencias organizado en tres fases —monitoreo, acción durante y acción después— extensible a incendio, inundación y otras situaciones.

**[`ESPECIFICACION.md`](ESPECIFICACION.md) es la fuente de verdad** de lo que la app debe hacer, qué está construido y qué falta. Si vas a contribuir o a entender el diseño, empieza por ahí.

Limitaciones conocidas y documentadas:

- Con la fuente de datos actual, **la alerta naranja no puede dispararse** en Colombia. Sus reglas exigen sismos de menos de 10 km de profundidad, y en 60 días de sismicidad colombiana no hubo ninguno: la sismicidad del país es de profundidad intermedia. Está pendiente de recalibrar.
- **Los umbrales del sensor están puestos a ojo.** Hasta calibrarlos con sismos reales, el veredicto sobre el origen del movimiento se registra pero no decide nada.
- **La lectura del texto de la alerta de Google se escribió a ciegas.** No hay forma de forzar una alerta de prueba, así que la redacción real en español está sin verificar. Por eso la app guarda el texto crudo y nunca depende de haberlo entendido: le basta con el canal y la hora.

---

## Advertencia

Este software se ofrece sin garantía de ningún tipo. **No dependas de él como único medio de alerta o de auxilio en una emergencia real.** Sigue siempre las indicaciones de las autoridades de gestión del riesgo y ten activas las alertas oficiales de tu teléfono.

## Licencia

MIT — ver [`LICENSE`](LICENSE).

### Sobre bitchat

La malla de emergencia usa un **fork modificado de [bitchat for Android](https://github.com/permissionlesstech/bitchat-android)**, que se distribuye bajo **GNU GPL v3**. Ese fork es una **aplicación aparte**, con su propio repositorio y su propia licencia; Alerta Sismo se comunica con él por IPC y no incorpora nada de su código.

Esa separación no es casual: incorporar código GPL v3 dentro de esta app obligaría a publicarla entera bajo GPL v3. Dos aplicaciones que se hablan por intents no propagan la licencia.

Si distribuyes el fork, tiene que ir bajo GPL v3 y con aviso visible de que está modificado.

> **Pendiente:** el repositorio original de bitchat se contradice a sí mismo — su README dice *"released into the public domain"* mientras su `LICENSE.md` son 674 líneas de GNU GPL v3. Ante la duda manda el archivo de licencia, y por eso aquí se trata como GPL v3. Conviene pedirles que lo aclaren antes de publicar un derivado.
