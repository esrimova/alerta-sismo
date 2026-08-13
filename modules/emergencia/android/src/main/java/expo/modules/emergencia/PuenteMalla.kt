package expo.modules.emergencia

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log

/**
 * Puente hacia el fork de bitchat.
 *
 * DOS APPS SEPARADAS QUE SE HABLAN POR IPC, no codigo de bitchat dentro de esta
 * app. Es a la vez lo tecnicamente limpio y lo legalmente obligatorio: la
 * licencia real de bitchat es GPL v3, e incorporar su codigo aqui arrastraria
 * toda Alerta Sismo a GPL. Un intent entre dos procesos no propaga la licencia.
 *
 * ALERTA SISMO ES EL DISPARADOR. bitchat no corre todo el tiempo: mantener la
 * malla viva gastaria bateria sin parar para cubrir un evento que puede no
 * ocurrir en años. Se enciende cuando vence el protocolo de emergencia y se
 * apaga cuando el usuario confirma que esta bien.
 *
 * Se usa startForegroundService y no startService por una razon concreta: desde
 * Android 12 una app en segundo plano no puede arrancar un servicio en primer
 * plano. Esta app si puede porque tiene su propio servicio de monitoreo
 * corriendo, y eso la pone en estado de primer plano a ojos del sistema. Ese
 * permiso se le transfiere al servicio que arranca, y por esa cadena bitchat
 * consigue levantar su malla.
 */
object PuenteMalla {

  private const val TAG = "PuenteMalla"

  const val PAQUETE_BITCHAT = "com.bitchat.droid"
  private const val SERVICIO = "com.bitchat.android.emergencia.ServicioEmergencia"

  private const val ACCION_ACTIVAR = "com.bitchat.droid.emergencia.ACTIVAR"
  private const val ACCION_DESACTIVAR = "com.bitchat.droid.emergencia.DESACTIVAR"

  /**
   * ¿Esta instalado el fork y expone el servicio?
   *
   * Distingue entre "no esta bitchat" y "esta bitchat pero no es el fork": son
   * situaciones distintas y el usuario tiene que poder saber cual le pasa. La
   * version de la tienda no expone ningun servicio, asi que resolver el
   * componente es lo que separa una de otra.
   */
  fun estado(contexto: Context): Map<String, Any?> {
    val pm = contexto.packageManager
    val instalado = try {
      pm.getPackageInfo(PAQUETE_BITCHAT, 0)
      true
    } catch (e: PackageManager.NameNotFoundException) {
      false
    }

    if (!instalado) {
      return mapOf("instalado" to false, "esFork" to false, "motivo" to "no_instalado")
    }

    val intent = Intent(ACCION_ACTIVAR).apply {
      component = ComponentName(PAQUETE_BITCHAT, SERVICIO)
    }
    val resuelve = try {
      pm.resolveService(intent, 0) != null
    } catch (e: Exception) {
      false
    }

    return mapOf(
      "instalado" to true,
      "esFork" to resuelve,
      "motivo" to if (resuelve) null else "version_sin_puente"
    )
  }

  /**
   * Enciende la malla y entrega la ficha.
   *
   * La ficha viaja en el intent y NO se guarda aqui: componerla es trabajo de
   * Alerta Sismo, que es la que sabe si el usuario esta en su casa y cuanta
   * bateria le queda. bitchat solo la reenvia tal cual.
   */
  fun activar(contexto: Context, ficha: String, apodo: String, episodio: String): Map<String, Any?> {
    if (ficha.isBlank()) {
      return mapOf("ok" to false, "motivo" to "ficha_vacia")
    }
    val intent = Intent(ACCION_ACTIVAR).apply {
      component = ComponentName(PAQUETE_BITCHAT, SERVICIO)
      putExtra("ficha", ficha)
      putExtra("apodo", apodo)
      putExtra("episodio", episodio)
    }
    return lanzar(contexto, intent, "activar")
  }

  /** Apaga la malla y borra la ficha del otro lado. */
  fun desactivar(contexto: Context): Map<String, Any?> {
    val intent = Intent(ACCION_DESACTIVAR).apply {
      component = ComponentName(PAQUETE_BITCHAT, SERVICIO)
    }
    return lanzar(contexto, intent, "desactivar")
  }

  private fun lanzar(contexto: Context, intent: Intent, que: String): Map<String, Any?> {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        contexto.startForegroundService(intent)
      } else {
        contexto.startService(intent)
      }
      mapOf("ok" to true)
    } catch (e: SecurityException) {
      // Casi siempre significa que las dos apps no comparten clave de firma: el
      // servicio del fork esta protegido con un permiso de nivel de firma.
      Log.e(TAG, "Sin permiso para $que la malla: ${e.message}")
      mapOf("ok" to false, "motivo" to "sin_permiso_firma")
    } catch (e: Exception) {
      Log.e(TAG, "No se pudo $que la malla: ${e.message}")
      mapOf("ok" to false, "motivo" to (e.message ?: "error_desconocido"))
    }
  }
}
