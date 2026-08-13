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
import android.speech.tts.TextToSpeech
import java.util.Locale
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
  /**
   * Nombre Bluetooth y volumen previos, GUARDADOS EN DISCO.
   *
   * Vivian solo en memoria, y eso dejaba un rastro peor que el problema que
   * resolvian: si el sistema mataba la app entre activar la baliza y apagarla
   * —cosa que HyperOS hace de forma agresiva, ver ESPECIFICACION §5— el telefono
   * se quedaba llamandose "SOS <nombre> ap<apto>" para siempre, publicando el
   * nombre y el apartamento del usuario a cualquiera que escaneara Bluetooth. Y
   * el volumen, al maximo.
   *
   * Persistidos, se pueden deshacer en el siguiente arranque aunque nadie llegue
   * a llamar a detenerBaliza().
   */
  private val prefs
    get() = contexto.getSharedPreferences("alerta_sismo_emergencia_nativo", Context.MODE_PRIVATE)

  private var nombreOriginal: String?
    get() = prefs.getString("nombre_bt_previo", null)
    set(v) { prefs.edit().apply { if (v == null) remove("nombre_bt_previo") else putString("nombre_bt_previo", v) }.apply() }

  private var volumenPrevio: Int?
    get() = prefs.getInt("volumen_previo", -1).takeIf { it >= 0 }
    set(v) { prefs.edit().apply { if (v == null) remove("volumen_previo") else putInt("volumen_previo", v) }.apply() }

  private var tts: TextToSpeech? = null
  private var ttsListo = false

  /**
   * Sintetizador de voz, creado una sola vez y reutilizado.
   *
   * Arrancarlo cuesta cerca de un segundo, asi que crearlo en cada emision de la
   * baliza haria que la voz llegara tarde o se perdiera. Se deja vivo mientras
   * viva el modulo.
   *
   * Prefiere español latinoamericano; si el equipo no lo tiene, cae al español
   * que haya. Una voz en un idioma que el oyente no entiende no sirve de nada.
   */
  private fun obtenerTts(): TextToSpeech? {
    if (tts == null) {
      tts = TextToSpeech(contexto) { estado ->
        ttsListo = estado == TextToSpeech.SUCCESS
        if (ttsListo) {
          val preferidas = listOf(
            Locale("es", "MX"), Locale("es", "US"), Locale("es", "CO"), Locale("es")
          )
          for (l in preferidas) {
            val r = tts?.setLanguage(l)
            if (r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED) break
          }
          // Un poco mas lento y grave de lo normal: bajo escombros y a traves de
          // una losa, lo que llega son las frecuencias bajas y las silabas
          // separadas.
          tts?.setSpeechRate(0.85f)
          tts?.setPitch(0.9f)
        }
      }
    }
    return tts
  }

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

  /**
   * Deshace lo que quedara a medias de una emergencia anterior.
   *
   * Se ejecuta al crear el modulo, que es lo primero que pasa al abrir la app.
   * Si el telefono sigue llamandose "SOS ..." o con el volumen al maximo, es que
   * el proceso murio en plena emergencia y nadie llego a devolverlo.
   */
  private fun deshacerRastroPendiente() {
    try {
      val nombre = nombreOriginal
      if (nombre != null) {
        adaptador()?.name = nombre
        nombreOriginal = null
        android.util.Log.i("Emergencia", "Se restauro el nombre Bluetooth de una emergencia anterior")
      }
    } catch (e: Exception) {
      // Sin permiso no se puede; se reintentara en el siguiente arranque.
    }
    try {
      val vol = volumenPrevio
      if (vol != null) {
        val am = contexto.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        am?.setStreamVolume(AudioManager.STREAM_MUSIC, vol, 0)
        volumenPrevio = null
        android.util.Log.i("Emergencia", "Se restauro el volumen de una emergencia anterior")
      }
    } catch (e: Exception) {
      // ignorado
    }
  }

  override fun definition() = ModuleDefinition {
    Name("Emergencia")

    OnCreate {
      deshacerRastroPendiente()
    }

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

    /**
     * Dice una frase en voz alta.
     *
     * Se usa el sintetizador del propio Android en vez de un archivo de audio
     * grabado por tres razones: no engorda la app, no depende de internet, y
     * sobre todo permite cambiar la frase sin volver a grabar nada. Quien oye la
     * baliza bajo escombros necesita una INSTRUCCION, y cual sea la instruccion
     * util puede cambiar.
     *
     * Voz en español latinoamericano. Si el equipo no lo tiene instalado, se cae
     * al español que haya; una sirena sin voz sigue sirviendo, una voz en un
     * idioma que el oyente no entiende no.
     */
    Function("hablar") { texto: String ->
      return@Function try {
        val tts = obtenerTts()
          ?: return@Function mapOf("ok" to false, "motivo" to "sin_sintetizador")

        // El flujo de alarma ignora el modo silencio, que es justo lo que hace
        // falta si el telefono quedo en silencio antes del sismo.
        val params = android.os.Bundle().apply {
          putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC)
          putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f)
        }
        tts.speak(texto, TextToSpeech.QUEUE_ADD, params, "baliza")
        mapOf("ok" to true)
      } catch (e: Exception) {
        mapOf("ok" to false, "motivo" to (e.message ?: "error_desconocido"))
      }
    }

    /** ¿Puede este telefono hablar? Para avisar antes de la emergencia. */
    Function("puedeHablar") {
      mapOf("ok" to (obtenerTts() != null), "listo" to ttsListo)
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
    Function("activarMalla") { ficha: String, apodo: String, episodio: String ->
      PuenteMalla.activar(contexto, ficha, apodo, episodio)
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
