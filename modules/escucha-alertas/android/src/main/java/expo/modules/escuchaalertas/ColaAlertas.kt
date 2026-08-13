package expo.modules.escuchaalertas

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Buzon de alertas recibidas mientras JavaScript no estaba escuchando.
 *
 * El servicio de notificaciones lo vincula el sistema y puede entregar una
 * alerta con el runtime de JS muerto. Sin este buzon, la alerta que importa
 * —la que llega de madrugada con la app cerrada— se procesaria en nativo para
 * arrancar el sensor y despues se perderia sin llegar nunca a la bitacora.
 *
 * Es un buzon de paso, no un registro: JS lo vacia en cuanto despierta y lo
 * vuelca a la bitacora, que es la que si conserva todo sin limite.
 */
object ColaAlertas {

  private const val PREFS = "alerta_sismo_escucha"
  private const val CLAVE = "alertas_pendientes"
  private const val CLAVE_ESTADO = "ultimo_estado"
  private const val CLAVE_ESTADO_EN = "ultimo_estado_en"
  private const val TOPE = 50

  @Synchronized
  fun guardar(contexto: Context, datos: Map<String, Any?>) {
    try {
      val prefs = contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val array = JSONArray(prefs.getString(CLAVE, "[]") ?: "[]")

      val o = JSONObject()
      datos.forEach { (k, v) -> o.put(k, v ?: JSONObject.NULL) }
      array.put(o)

      // Si desborda se tiran las mas viejas: con el buzon lleno, lo reciente es
      // lo que todavia puede servir.
      val recortado = if (array.length() > TOPE) {
        val nuevo = JSONArray()
        for (i in (array.length() - TOPE) until array.length()) nuevo.put(array.get(i))
        nuevo
      } else array

      prefs.edit().putString(CLAVE, recortado.toString()).apply()
    } catch (e: Exception) {
      // Encolar no puede tumbar el arranque de la medida, que es lo urgente.
    }
  }

  /** Devuelve lo pendiente y lo borra. */
  @Synchronized
  fun vaciar(contexto: Context): List<Map<String, Any?>> {
    return try {
      val prefs = contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val array = JSONArray(prefs.getString(CLAVE, "[]") ?: "[]")
      prefs.edit().remove(CLAVE).apply()
      (0 until array.length()).mapNotNull { i ->
        (array.opt(i) as? JSONObject)?.let { o ->
          val m = HashMap<String, Any?>()
          o.keys().forEach { k -> m[k] = if (o.isNull(k)) null else o.get(k) }
          m
        }
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  /**
   * Ultima vez que el sistema vinculo o desvinculo el servicio.
   *
   * Es diagnostico, no adorno: en Android 14+ el servicio no se vincula hasta
   * el primer desbloqueo tras reiniciar, y saber cuando ocurrio es la unica
   * forma de explicar por que una alerta no llego.
   */
  fun registrarEstado(contexto: Context, estado: String) {
    try {
      contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(CLAVE_ESTADO, estado)
        .putLong(CLAVE_ESTADO_EN, System.currentTimeMillis())
        .apply()
    } catch (e: Exception) {
      // ignorado
    }
  }

  fun ultimoEstado(contexto: Context): Map<String, Any?> {
    return try {
      val prefs = contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      mapOf(
        "estado" to prefs.getString(CLAVE_ESTADO, null),
        "en" to prefs.getLong(CLAVE_ESTADO_EN, 0L).takeIf { it > 0L }
      )
    } catch (e: Exception) {
      mapOf("estado" to null, "en" to null)
    }
  }
}
