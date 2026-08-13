# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Qué debe hacer esta app

@ESPECIFICACION.md es la fuente de verdad del comportamiento esperado: las tres fases,
qué está construido, qué falta y los datos medidos que condicionan el diseño. Léelo antes
de proponer o cambiar funcionalidad.

Cuando una decisión cambie, **sobrescribe** el texto correspondiente en ese documento.
No añadas entradas nuevas, fechas de decisión ni historial: el registro de cambios vive
en git y el de eventos de la app en su bitácora.

# Módulos nativos

Hay tres, en `modules/`, todos con la API de Expo Modules y enlazados por autolinking:
`emergencia` (baliza BLE), `sismografo` (medida de la sacudida) y `escucha-alertas`
(alerta sísmica de Google). Tocar Kotlin obliga a recompilar: `cd android && ./gradlew
assembleDebug`. Con solo cambiar JavaScript basta el bundle.

Dos invariantes que es fácil romper sin darse cuenta:

**El motor del sismógrafo no puede depender del ciclo de vida de JavaScript.** Vive en
`MotorSismografo`, un singleton de proceso, porque el servicio de notificaciones tiene
que poder arrancar una medida con el runtime de JS muerto —una alerta de madrugada con la
app cerrada— y porque rebotar por JS gastaría segundos cuando la ventana entera son 23-58.
Si no hay nadie escuchando, la medida se encola en nativo y JS la recoge al despertar. No
muevas esa lógica dentro del módulo de Expo.

**La alarma suena una vez por episodio; el protocolo no depende de que suene.** Si Google
ya avisó, el feed del USGS llega después y no vuelve a sonar. Pero la cuenta atrás de
"Estoy bien" arranca igual: que Google avisara antes no significa que el usuario esté
bien, significa lo contrario. Ver `ejecutarCiclo()` en `src/services/monitor.js`.
