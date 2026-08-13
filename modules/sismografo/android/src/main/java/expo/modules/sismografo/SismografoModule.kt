package expo.modules.sismografo

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Cara de JavaScript del sismografo.
 *
 * Deliberadamente delgado: toda la medida vive en MotorSismografo, que es un
 * singleton de proceso. La razon es que la alerta de Google tiene que poder
 * arrancar una ventana sin que exista este modulo ni el runtime de JS —el
 * servicio de notificaciones puede recibirla con la app cerrada— y eso solo es
 * posible si el motor no depende del ciclo de vida del modulo.
 *
 * Aqui solo se hacen tres cosas: conectar y desconectar el oyente de eventos,
 * exponer las funciones a JS, y vaciar el buzon de mediciones que se tomaron
 * mientras no habia nadie escuchando.
 */
class SismografoModule : Module() {

  private val contexto: Context
    get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("Sismografo")

    Events("onMedicion", "onUmbralSuperado")

    OnCreate {
      MotorSismografo.conectar(contexto)
      // Mientras este modulo viva, los eventos van directos a JS.
      MotorSismografo.oyente = { nombre, datos -> sendEvent(nombre, datos) }
    }

    OnDestroy {
      // Al soltar el oyente, el motor vuelve a encolar en vez de emitir. Es lo
      // que evita perder una medida si la app se cierra a mitad de ventana.
      MotorSismografo.oyente = null
    }

    /**
     * Que sensores hay. Un telefono sin acelerometro no existe en la practica,
     * pero sin giroscopio si: en ese caso se mide igual y el veredicto queda
     * en 'indeterminado' en vez de mentir.
     */
    Function("disponibilidad") {
      MotorSismografo.conectar(contexto)
      MotorSismografo.disponibilidad()
    }

    Function("iniciarVentana") { ventanaMs: Int, hz: Int, umbralG: Double, etiqueta: String ->
      MotorSismografo.conectar(contexto)
      MotorSismografo.iniciar(ventanaMs, hz, umbralG, etiqueta)
    }

    /** Corta la ventana antes de tiempo y devuelve lo medido hasta ahora. */
    Function("detenerVentana") {
      MotorSismografo.detener()
    }

    /**
     * Recoge las medidas tomadas con JS muerto.
     *
     * Se llama al arrancar y en cada vuelta del bucle de monitoreo. Sin esto,
     * una ventana disparada por la alerta de Google con la app cerrada se
     * habria medido correctamente y no se habria enterado nadie.
     */
    Function("vaciarPendientes") {
      ColaMediciones.vaciar(contexto)
    }
  }
}
