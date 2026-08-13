package expo.modules.sismografo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Puerta de entrada nativa al sismografo desde fuera de su modulo.
 *
 * La usa el servicio que escucha las alertas de Google, que vive en otro modulo
 * de Gradle y por tanto no puede llamar a MotorSismografo directamente. Un
 * intent explicito cruza esa frontera sin necesidad de que un modulo dependa
 * del otro, y sobre todo SIN PASAR POR JAVASCRIPT, que es la condicion para no
 * gastar segundos cuando la ventana entera dura de 23 a 58.
 *
 * El receptor no se exporta: solo puede accionarlo codigo de esta misma app.
 * Cualquier otra cosa seria dejar que una app ajena encienda los sensores.
 */
class ArranqueReceiver : BroadcastReceiver() {

  companion object {
    const val ACCION = "expo.modules.sismografo.INICIAR_VENTANA"
    const val EXTRA_VENTANA_MS = "ventanaMs"
    const val EXTRA_HZ = "hz"
    const val EXTRA_UMBRAL_G = "umbralG"
    const val EXTRA_ETIQUETA = "etiqueta"
  }

  override fun onReceive(contexto: Context, intent: Intent) {
    if (intent.action != ACCION) return
    try {
      MotorSismografo.conectar(contexto)
      MotorSismografo.iniciar(
        intent.getIntExtra(EXTRA_VENTANA_MS, 90_000),
        intent.getIntExtra(EXTRA_HZ, 100),
        intent.getDoubleExtra(EXTRA_UMBRAL_G, 0.02),
        intent.getStringExtra(EXTRA_ETIQUETA) ?: "externo"
      )
    } catch (e: Exception) {
      android.util.Log.e("Sismografo", "No se pudo arrancar la ventana: ${e.message}")
    }
  }
}
