package expo.modules.escuchaalertas

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Cara de JavaScript de la escucha de alertas de Google.
 *
 * No procesa notificaciones: eso lo hace EscuchaNotificaciones, que el sistema
 * vincula por su cuenta y que puede correr con JS muerto. Aqui solo se consulta
 * el estado, se abre la pantalla de permisos y se vacia el buzon.
 */
class EscuchaAlertasModule : Module() {

  private val contexto: Context
    get() = requireNotNull(appContext.reactContext)

  /**
   * ¿Concedio el usuario el acceso a notificaciones?
   *
   * Se lee de Settings.Secure porque es la unica fuente fiable: comprobar si el
   * servicio esta corriendo no sirve, ya que Android puede tenerlo autorizado
   * pero aun no vinculado.
   */
  private fun tienePermiso(): Boolean {
    return try {
      val activados = Settings.Secure.getString(
        contexto.contentResolver, "enabled_notification_listeners"
      ) ?: return false
      val propio = ComponentName(
        contexto.packageName, EscuchaNotificaciones::class.java.name
      )
      activados.split(":").any {
        val c = ComponentName.unflattenFromString(it)
        c != null && c.packageName == propio.packageName &&
          c.className == propio.className
      }
    } catch (e: Exception) {
      false
    }
  }

  override fun definition() = ModuleDefinition {
    Name("EscuchaAlertas")

    /**
     * Diagnostico completo para el semaforo de fuentes.
     *
     * Permiso y vinculacion son cosas DISTINTAS y hay que mostrarlas por
     * separado: en Android 14+ el servicio no se vincula hasta el primer
     * desbloqueo tras reiniciar el telefono, asi que se puede tener el permiso
     * concedido y aun asi no recibir nada.
     */
    Function("estado") {
      val ultimo = ColaAlertas.ultimoEstado(contexto)
      mapOf(
        "permiso" to tienePermiso(),
        "vinculado" to EscuchaNotificaciones.vinculado,
        "ultimoEstado" to ultimo["estado"],
        "ultimoEstadoEn" to ultimo["en"],
        "canalesQueDisparan" to EscuchaNotificaciones.CANALES_DISPARAN.toList()
      )
    }

    /** Abre los ajustes del sistema donde se concede el acceso a notificaciones. */
    Function("abrirAjustes") {
      try {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        contexto.startActivity(intent)
        mapOf("ok" to true)
      } catch (e: Exception) {
        mapOf("ok" to false, "motivo" to (e.message ?: "no_se_pudo_abrir"))
      }
    }

    /**
     * Recoge las alertas que llegaron con JavaScript dormido.
     *
     * Se llama al arrancar y en cada vuelta del bucle de monitoreo. Sin esto,
     * una alerta de madrugada con la app cerrada habria arrancado el sensor
     * correctamente y no habria dejado rastro en la bitacora.
     */
    Function("vaciarPendientes") {
      ColaAlertas.vaciar(contexto)
    }
  }
}
