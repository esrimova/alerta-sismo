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
 * adaptador Bluetooth a algo como "SOS Esteban 3003515616" y se emite un
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
 *    caracteres). No caben nombre, telefono y coordenadas a la vez, asi que
 *    se priorizan nombre y telefono del contacto: son los que permiten actuar
 *    a quien encuentre la baliza.
 *  - El nombre del adaptador es PERSISTENTE. Se guarda el original al empezar
 *    y se restaura al detener, para no dejar el telefono llamandose "SOS".
 */
class EmergenciaModule : Module() {

  private var advertiser: BluetoothLeAdvertiser? = null
  private var callback: AdvertiseCallback? = null
  private var nombreOriginal: String? = null

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
