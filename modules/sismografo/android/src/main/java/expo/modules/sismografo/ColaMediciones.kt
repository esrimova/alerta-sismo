package expo.modules.sismografo

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Mediciones tomadas sin nadie escuchando.
 *
 * El caso real: la alerta de Google llega, el servicio de notificaciones
 * arranca el sensor en nativo y la ventana se cierra 90 segundos despues, todo
 * con el runtime de JavaScript muerto porque la app estaba cerrada. Sin esta
 * cola, esa medida —justo la del sismo de verdad— se perderia sin dejar rastro.
 *
 * Se guarda en SharedPreferences y no en la bitacora porque la bitacora vive en
 * JavaScript: si JS estuviera vivo, no haria falta ninguna cola.
 *
 * El tope es bajo a proposito. Esto no es un registro —para eso esta la
 * bitacora, que no tiene limite— sino un buzon de paso que JS vacia en cuanto
 * despierta. Si se llenara, el problema seria que JS lleva horas muerto.
 */
object ColaMediciones {

  private const val PREFS = "alerta_sismo_sismografo"
  private const val CLAVE = "mediciones_pendientes"
  private const val TOPE = 50

  @Synchronized
  fun guardar(contexto: Context, medicion: Map<String, Any?>) {
    try {
      val prefs = contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val array = JSONArray(prefs.getString(CLAVE, "[]") ?: "[]")
      array.put(aJson(medicion))

      // Si desborda se tiran las MAS VIEJAS: ante un buzon lleno, la medida
      // reciente es la que todavia puede servir para algo.
      val recortado = if (array.length() > TOPE) {
        val nuevo = JSONArray()
        for (i in (array.length() - TOPE) until array.length()) nuevo.put(array.get(i))
        nuevo
      } else array

      prefs.edit().putString(CLAVE, recortado.toString()).apply()
    } catch (e: Exception) {
      // Un fallo al encolar no puede tumbar el cierre de una ventana.
    }
  }

  /** Devuelve lo pendiente y lo borra. Se llama desde JS al despertar. */
  @Synchronized
  fun vaciar(contexto: Context): List<Map<String, Any?>> {
    return try {
      val prefs = contexto.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val array = JSONArray(prefs.getString(CLAVE, "[]") ?: "[]")
      prefs.edit().remove(CLAVE).apply()
      (0 until array.length()).mapNotNull { i ->
        (array.opt(i) as? JSONObject)?.let { aMapa(it) }
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun aJson(m: Map<String, Any?>): JSONObject {
    val o = JSONObject()
    m.forEach { (k, v) -> o.put(k, v ?: JSONObject.NULL) }
    return o
  }

  private fun aMapa(o: JSONObject): Map<String, Any?> {
    val m = HashMap<String, Any?>()
    o.keys().forEach { k -> m[k] = if (o.isNull(k)) null else o.get(k) }
    return m
  }
}
