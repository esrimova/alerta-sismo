package expo.modules.escuchaalertas

import android.app.Notification
import android.content.ComponentName
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Escucha la alerta sismica de Google.
 *
 * Es el punto de entrada rapido de la app: Google avisa a los ~18 s del origen,
 * cuando el feed del USGS todavia tardara de 4 a 7 minutos. Nunca publicaron
 * una API, pero su notificacion si se puede interceptar.
 *
 * EL FILTRO ES POR IDENTIFICADOR DE CANAL, NUNCA POR TEXTO. El canal es un
 * identificador estable; el texto depende del idioma del telefono y de como
 * Google decida redactarlo, y puede cambiar sin aviso en cualquier actualizacion
 * de Play Services. Un filtro por texto se rompe en silencio y nadie se entera
 * hasta que llega un sismo y no suena nada.
 *
 * QUE SE PUEDE SACAR DE AQUI, Y QUE NO:
 *
 *  - Fiable: el canal (que da el nivel: "toma medidas" o "ten en cuenta") y el
 *    postTime, que es el instante exacto en que este telefono recibio el aviso.
 *    Ese instante es el t0 de todo lo demas.
 *  - Fragil: magnitud y distancia, que vienen dentro del texto en prosa.
 *  - Imposible: profundidad, coordenadas del epicentro e identificador del
 *    evento. Google no los muestra al usuario, asi que no estan en la
 *    notificacion. El contentIntent es un PendingIntent opaco: los extras que
 *    Google le pasa a su propia pantalla de detalle no se pueden leer desde
 *    fuera.
 *
 * Por eso se vuelcan los extras CRUDOS y completos. No se puede verificar la
 * redaccion exacta en español para Colombia sin una alerta real, y no hay forma
 * de forzar una de prueba. Guardando el texto tal cual, la primera alerta que
 * llegue queda capturada entera y de ahi sale el parser, en vez de adivinarlo.
 *
 * LIMITES DE ESTA VIA, ASUMIDOS:
 *  - Exige permiso de acceso a notificaciones, que es amplisimo: lee TODAS las
 *    notificaciones del telefono. Por eso es opcional y la app funciona sin el.
 *  - Android 14+ no vincula el servicio hasta el primer desbloqueo tras
 *    reiniciar el telefono.
 *  - Requiere que el proceso de la app este vivo, cosa que el servicio en
 *    primer plano ya garantiza mientras el monitoreo este activo.
 */
class EscuchaNotificaciones : NotificationListenerService() {

  companion object {
    const val PAQUETE_GOOGLE = "com.google.android.gms"

    /** Canales de alerta sismica temprana, grupo Personal_Safety_Id. */
    const val CANAL_ALERTA = "eew_alert_v2"
    const val CANAL_NOTIFICACION = "eew_notification_v2"
    const val CANAL_ACTUALIZACION = "eew_update"

    /** Los que disparan respuesta. El de actualizacion solo se registra. */
    val CANALES_DISPARAN = setOf(CANAL_ALERTA, CANAL_NOTIFICACION)
    val CANALES_CONOCIDOS = CANALES_DISPARAN + CANAL_ACTUALIZACION

    /**
     * ¿Esta el servicio vinculado ahora mismo?
     *
     * El permiso concedido no basta: Android puede no haber vinculado todavia
     * (14+ espera al primer desbloqueo tras reiniciar). Sin distinguir las dos
     * cosas, la interfaz diria "todo listo" cuando en realidad no llegaria
     * ninguna alerta.
     */
    @Volatile var vinculado = false
      private set
  }

  override fun onListenerConnected() {
    vinculado = true
    ColaAlertas.registrarEstado(applicationContext, "vinculado")
  }

  override fun onListenerDisconnected() {
    vinculado = false
    ColaAlertas.registrarEstado(applicationContext, "desvinculado")
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      if (sbn.packageName != PAQUETE_GOOGLE) return

      val n = sbn.notification ?: return
      val canal = n.channelId ?: return

      // Solo interesan los canales de sismo. Play Services emite decenas de
      // notificaciones al dia por otros motivos.
      if (!canal.startsWith("eew")) return

      val extras = n.extras
      val datos = HashMap<String, Any?>()
      datos["canal"] = canal
      datos["recibidoEn"] = sbn.postTime
      datos["vistoEn"] = System.currentTimeMillis()
      datos["clave"] = sbn.key
      datos["titulo"] = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()
      datos["texto"] = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()
      datos["bigText"] = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
      datos["subText"] = extras?.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()
      datos["conocido"] = CANALES_CONOCIDOS.contains(canal)
      datos["dispara"] = CANALES_DISPARAN.contains(canal)

      // Un canal 'eew' que no esta en la lista significa que Google cambio el
      // formato. Se registra y se avisa: es la unica señal de que esta via se
      // esta quedando obsoleta antes de que falle una alerta real.
      ColaAlertas.guardar(applicationContext, datos)

      if (!CANALES_DISPARAN.contains(canal)) return

      // AQUI SE GANAN LOS SEGUNDOS. La medida arranca en nativo, ahora mismo,
      // sin esperar a que JavaScript despierte ni a que termine lo que este
      // haciendo. La onda S llega entre 23 y 58 segundos despues de esto.
      arrancarMedida()
    } catch (e: Exception) {
      android.util.Log.e("EscuchaAlertas", "Fallo procesando notificacion: ${e.message}")
    }
  }

  /**
   * Enciende el sismografo por intent explicito.
   *
   * Explicito y no implicito porque Android 8+ no entrega broadcasts implicitos
   * declarados en el manifiesto, y porque nombrar el componente evita que
   * cualquier otra app pueda responder a este intent.
   */
  private fun arrancarMedida() {
    try {
      val intent = Intent("expo.modules.sismografo.INICIAR_VENTANA").apply {
        component = ComponentName(packageName, "expo.modules.sismografo.ArranqueReceiver")
        putExtra("ventanaMs", 90_000)
        putExtra("hz", 100)
        putExtra("umbralG", 0.02)
        putExtra("etiqueta", "google")
      }
      sendBroadcast(intent)
    } catch (e: Exception) {
      android.util.Log.e("EscuchaAlertas", "No se pudo arrancar la medida: ${e.message}")
    }
  }
}
