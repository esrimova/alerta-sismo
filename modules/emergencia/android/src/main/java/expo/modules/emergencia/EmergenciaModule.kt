package expo.modules.emergencia

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.provider.Settings
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Modulo de emergencia: baliza Bluetooth.
 *
 * BALIZA BLUETOOTH
 * Cuando el temporizador de "Estoy bien" vence, se cambia el nombre del
 * adaptador Bluetooth a algo como "SOS Ana ap715 bitchat" y se emite un
 * anuncio BLE que lo incluye. Cualquier persona cerca lo ve en la lista normal
 * de Bluetooth de su telefono, SIN necesidad de emparejar ni de tener una app.
 *
 * Limitaciones aceptadas a proposito:
 *  - La app NO puede encender el Bluetooth: BluetoothAdapter.enable() esta
 *    obsoleto desde Android 12. Si esta apagado, la baliza no arranca.
 *  - No se puede forzar la visibilidad del Bluetooth clasico: eso exige
 *    BLUETOOTH_PRIVILEGED, reservado a apps del sistema. Por eso se usa BLE,
 *    que solo necesita BLUETOOTH_ADVERTISE.
 *  - El paquete BLE son 31 bytes, asi que el nombre debe ser corto (~26
 *    caracteres). El telefono se retiro: si la red celular funciona, el
 *    afectado habria podido pedir ayuda el mismo, y si no funciona un numero
 *    es inutil. Esos caracteres rinden mas diciendo DONDE esta y por que canal
 *    se sabe el resto. El texto lo compone src/services/ficha.js.
 *  - El nombre del adaptador es PERSISTENTE. Se guarda el original al empezar
 *    y se restaura al detener, para no dejar el telefono llamandose "SOS".
 */
class EmergenciaModule : Module() {

  private var advertiser: BluetoothLeAdvertiser? = null
  private var callback: AdvertiseCallback? = null
  private var nombreOriginal: String? = null

  /** Volumen del sistema antes de subirlo para la baliza, para devolverlo. */
  private var volumenPrevio: Int? = null

  private val contexto: Context
    get() = requireNotNull(appContext.reactContext)

  private fun adaptador(): BluetoothAdapter? {
    val bm = contexto.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return bm?.adapter
  }

  private fun tienePermiso(permiso: String): Boolean =
    ContextCompat.checkSelfPermission(contexto, permiso) == PackageManager.PERMISSION_GRANTED

  private fun puedeAnunciar(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      tienePermiso(Manifest.permission.BLUETOOTH_ADVERTISE) &&
        tienePermiso(Manifest.permission.BLUETOOTH_CONNECT)
    } else true

  override fun definition() = ModuleDefinition {
    Name("Emergencia")

    /** Diagnostico para la interfaz: que se puede y que no, antes de la emergencia. */
    Function("estadoBluetooth") {
      val a = adaptador()
      mapOf(
        "soportado" to (a != null),
        "encendido" to (a?.isEnabled == true),
        "puedeAnunciar" to (a?.bluetoothLeAdvertiser != null && puedeAnunciar()),
        "permisos" to puedeAnunciar(),
        "nombreActual" to (try { a?.name } catch (e: SecurityException) { null })
      )
    }

    /**
     * Arranca la baliza. Devuelve un mapa con ok/motivo para que la interfaz
     * pueda explicar por que fallo, en vez de fallar en silencio.
     */
    Function("iniciarBaliza") { mensaje: String ->
      val a = adaptador()
        ?: return@Function mapOf("ok" to false, "motivo" to "sin_bluetooth")
      if (!a.isEnabled) {
        return@Function mapOf("ok" to false, "motivo" to "bluetooth_apagado")
      }
      if (!puedeAnunciar()) {
        return@Function mapOf("ok" to false, "motivo" to "sin_permisos")
      }

      val adv = a.bluetoothLeAdvertiser
        ?: return@Function mapOf("ok" to false, "motivo" to "sin_soporte_advertising")

      // 31 bytes de paquete: se recorta para que el anuncio no sea rechazado.
      val corto = if (mensaje.length > 26) mensaje.substring(0, 26) else mensaje

      try {
        if (nombreOriginal == null) nombreOriginal = a.name
        a.name = corto
      } catch (e: SecurityException) {
        return@Function mapOf("ok" to false, "motivo" to "sin_permiso_nombre")
      }

      detenerAnuncio()

      val settings = AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
        .setConnectable(true)
        .setTimeout(0) // 0 = indefinido, hasta que se detenga
        .build()

      val datos = AdvertiseData.Builder()
        .setIncludeDeviceName(true)
        .setIncludeTxPowerLevel(false)
        .build()

      val cb = object : AdvertiseCallback() {
        override fun onStartFailure(errorCode: Int) {
          android.util.Log.e("Emergencia", "Fallo el anuncio BLE: $errorCode")
        }
      }

      return@Function try {
        adv.startAdvertising(settings, datos, cb)
        advertiser = adv
        callback = cb
        mapOf("ok" to true, "motivo" to "activa", "nombre" to corto)
      } catch (e: SecurityException) {
        mapOf("ok" to false, "motivo" to "sin_permisos")
      } catch (e: Exception) {
        mapOf("ok" to false, "motivo" to (e.message ?: "error_desconocido"))
      }
    }

    /** Detiene la baliza y restaura el nombre original del telefono. */
    Function("detenerBaliza") {
      detenerAnuncio()
      try {
        val a = adaptador()
        val original = nombreOriginal
        if (a != null && original != null) {
          a.name = original
          nombreOriginal = null
        }
      } catch (e: SecurityException) {
        // Sin permiso no se puede restaurar; se informa igual.
      }
      mapOf("ok" to true)
    }

    /**
     * Sube el volumen del sistema al maximo para la baliza sonora.
     *
     * Poner el reproductor al 1.0 solo da el 100% DEL VOLUMEN DEL SISTEMA. Si el
     * telefono esta al 20% —lo normal de madrugada, que es cuando el usuario
     * tiene menos posibilidades de reaccionar— la baliza suena floja y se pierde
     * el unico mecanismo con el que de verdad se encuentra a alguien bajo
     * escombros.
     *
     * Se guarda el volumen previo para devolverlo al terminar: dejar el telefono
     * al maximo para siempre seria un efecto secundario que el usuario no pidio.
     */
    Function("subirVolumenBaliza") {
      return@Function try {
        val am = contexto.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
          ?: return@Function mapOf("ok" to false, "motivo" to "sin_audio")

        if (volumenPrevio == null) {
          volumenPrevio = am.getStreamVolume(AudioManager.STREAM_MUSIC)
        }
        val maximo = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, maximo, 0)
        mapOf("ok" to true, "previo" to volumenPrevio, "maximo" to maximo)
      } catch (e: SecurityException) {
        // Ocurre con "No molestar" activo sin permiso de politica de
        // notificaciones. Se suena igual, al volumen que hubiera.
        mapOf("ok" to false, "motivo" to "no_molestar")
      } catch (e: Exception) {
        mapOf("ok" to false, "motivo" to (e.message ?: "error_desconocido"))
      }
    }

    /** Devuelve el volumen que tenia el telefono antes de la emergencia. */
    Function("restaurarVolumen") {
      return@Function try {
        val previo = volumenPrevio ?: return@Function mapOf("ok" to true, "motivo" to "no_se_cambio")
        val am = contexto.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
          ?: return@Function mapOf("ok" to false, "motivo" to "sin_audio")
        am.setStreamVolume(AudioManager.STREAM_MUSIC, previo, 0)
        volumenPrevio = null
        mapOf("ok" to true)
      } catch (e: Exception) {
        mapOf("ok" to false, "motivo" to (e.message ?: "error_desconocido"))
      }
    }

    /** ¿Esta instalado el fork de bitchat con el puente de emergencia? */
    Function("estadoMalla") {
      PuenteMalla.estado(contexto)
    }

    /**
     * Enciende la malla de bitchat y le entrega la ficha.
     *
     * Alerta Sismo es el disparador: bitchat no corre todo el tiempo porque
     * mantener la malla viva gastaria bateria sin parar para cubrir un evento
     * que puede no ocurrir en años.
     */
    Function("activarMalla") { ficha: String, apodo: String, episodio: String, duracionMs: Double ->
      PuenteMalla.activar(contexto, ficha, apodo, episodio, duracionMs)
    }

    /** Apaga la malla y borra la ficha del otro lado. */
    Function("desactivarMalla") {
      PuenteMalla.desactivar(contexto)
    }

    /**
     * Carga restante del telefono.
     *
     * Es uno de los dos datos que un equipo de rescate no puede obtener de
     * ninguna otra forma: marca el plazo en que la señal va a dejar de existir.
     * Un 8% dice que quedan minutos para encontrar a esta persona por radio; un
     * 80% dice que hay tiempo. Sin el, quien recibe la ficha no puede priorizar.
     */
    Function("nivelBateria") {
      return@Function try {
        val bm = contexto.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val pct = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
        val estado = contexto.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val plug = estado?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        mapOf(
          "porcentaje" to (if (pct in 0..100) pct else null),
          "cargando" to (plug != 0)
        )
      } catch (e: Exception) {
        mapOf("porcentaje" to null, "cargando" to false)
      }
    }

    /**
     * ¿Puede la app encender la pantalla y mostrarse sobre el bloqueo?
     *
     * Android 14 restringio USE_FULL_SCREEN_INTENT a apps de llamadas y
     * alarmas. El resto debe conseguirlo del usuario a mano. Sin esto, una
     * alerta sismica de madrugada no enciende la pantalla y solo queda el
     * sonido.
     */
    Function("puedePantallaCompleta") {
      if (Build.VERSION.SDK_INT < 34) return@Function true
      val nm = contexto.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      return@Function try {
        nm?.canUseFullScreenIntent() ?: false
      } catch (e: Exception) {
        false
      }
    }

    /** Abre la pantalla de ajustes donde el usuario concede ese permiso. */
    Function("abrirAjustesPantallaCompleta") {
      return@Function try {
        val intent = if (Build.VERSION.SDK_INT >= 34) {
          Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
            data = Uri.parse("package:${contexto.packageName}")
          }
        } else {
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${contexto.packageName}")
          }
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        contexto.startActivity(intent)
        mapOf("ok" to true)
      } catch (e: Exception) {
        mapOf("ok" to false, "motivo" to (e.message ?: "no_se_pudo_abrir"))
      }
    }
  }

  private fun detenerAnuncio() {
    try {
      val a = advertiser
      val c = callback
      if (a != null && c != null) a.stopAdvertising(c)
    } catch (e: SecurityException) {
      // ignorado
    } catch (e: Exception) {
      // ignorado
    }
    advertiser = null
    callback = null
  }
}
