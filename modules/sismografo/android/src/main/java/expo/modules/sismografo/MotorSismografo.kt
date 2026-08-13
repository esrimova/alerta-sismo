package expo.modules.sismografo

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * El motor de medida, separado del modulo de Expo.
 *
 * Vive aparte por una razon concreta: LA ALERTA DE GOOGLE TIENE QUE PODER
 * ARRANCARLO SIN PASAR POR JAVASCRIPT. El servicio que escucha las
 * notificaciones corre en su propio contexto y puede recibir la alerta con el
 * runtime de JS ocupado disparando la alarma, o directamente muerto. Rebotar
 * por JS para decidir medir costaria tiempo justo cuando la ventana entera es
 * de 23 a 58 segundos.
 *
 * Por eso es un singleton de proceso y no un metodo del modulo: al modulo se le
 * conecta un oyente cuando existe, y cuando no existe la medida se guarda para
 * que JS la recoja despues.
 *
 * DECISIONES DE MEDIDA
 *
 *  - La gravedad se quita con un paso alto de esquina ~0,15 Hz: por debajo de
 *    la banda sismica util (0,1-10 Hz) y por encima de la deriva DC. El filtro
 *    se SIEMBRA con la primera muestra; arrancarlo en cero produciria un falso
 *    pico de 9,8 m/s2 en el primer instante de cada ventana.
 *
 *  - El PGA es el pico de la MAGNITUD DEL VECTOR, no de un eje. No se sabe como
 *    esta acostado el telefono, y el vector es independiente de su orientacion.
 *
 *  - alpha se recalcula por muestra con el intervalo real entre eventos. El
 *    ritmo que entrega Android es orientativo, no garantizado, y un alpha fijo
 *    desplaza la esquina del filtro cuando el ritmo real se desvia.
 *
 *  - No se calcula PGV. Integrar la aceleracion de un telefono sin correccion
 *    de linea base acumula deriva y da un numero que parece dato y no lo es.
 *
 *  - El giroscopio NO mide la sacudida: mide rotacion, y un telefono apoyado
 *    durante un sismo se traslada, casi no rota. Sirve para lo contrario, para
 *    descartar falsos positivos: caminar con el telefono en el bolsillo produce
 *    aceleraciones parecidas a un sismo moderado, pero con una firma de rotacion
 *    que el suelo no tiene.
 *
 *  - Se sostiene un PARTIAL_WAKE_LOCK durante la ventana. Los sensores sin
 *    variante wake-up dejan de entregar muestras cuando el procesador suspende,
 *    asi que sin el una ventana con la pantalla apagada se quedaria a medias.
 */
object MotorSismografo {

  /** Esquina del paso alto que separa la sacudida de la gravedad, en Hz. */
  private const val ESQUINA_HZ = 0.15

  /**
   * Los primeros 200 ms no cuentan para el pico. Aunque el filtro se siembre,
   * queda un transitorio de asentamiento, y sin esto toda ventana registraria
   * un pico inicial que no ocurrio.
   */
  private const val ASENTAMIENTO_MS = 200L

  private const val G = 9.80665

  /**
   * Frontera entre medir un evento y vigilar durante horas.
   *
   * Por debajo se prioriza la fidelidad —procesador despierto, muestras al
   * instante—; por encima se prioriza la bateria. Cinco minutos deja del lado
   * corto cualquier ventana disparada por una alerta y del largo la vigilancia
   * de replicas, que es la unica que dura horas.
   */
  private const val VENTANA_CORTA_MAX_MS = 5 * 60 * 1000

  /**
   * Cuanto puede acumular el coprocesador antes de despertar al procesador.
   *
   * Un minuto de tanda significa que el procesador principal duerme casi todo
   * el rato mientras el sensor sigue midiendo. Si el equipo no soporta acumular,
   * Android lo ignora y entrega como siempre: se pierde el ahorro, no la medida.
   */
  private const val LATENCIA_TANDA_US = 60_000_000

  /**
   * A donde se mandan los eventos cuando hay alguien escuchando. Lo conecta el
   * modulo de Expo mientras vive; si es null, la medida se guarda en la cola.
   */
  @Volatile var oyente: ((String, Map<String, Any?>) -> Unit)? = null

  private var sensorManager: SensorManager? = null
  private var hilo: HandlerThread? = null
  private var handler: Handler? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var contextoApp: Context? = null

  @Volatile private var activa = false

  /**
   * Numero de ventana. Sube en cada arranque y sirve para que el cierre
   * programado de una ventana no mate a la siguiente: si una alerta de Google
   * reemplaza a la vigilancia de replicas, el postDelayed de la vigilancia
   * sigue pendiente y al dispararse encontraria activa=true creyendo que es
   * suya. Comparando el numero, sabe que ya no le toca y se retira.
   */
  @Volatile private var generacion = 0

  private var etiquetaActual: String = ""
  private var hz: Int = 100

  // Estado de la ventana en curso. Solo lo toca el hilo del sensor.
  private var gravedadX = 0f
  private var gravedadY = 0f
  private var gravedadZ = 0f
  private var sembrado = false
  private var tsAnteriorNs = 0L
  private var inicioMs = 0L
  private var muestras = 0
  private var pgaMs2 = 0.0
  private var giroPico = 0.0
  private var umbralMs2 = 0.02 * G
  private var msSobreUmbral = 0.0
  private var avisadoUmbral = false

  /**
   * Milisegundos desde el arranque de la ventana hasta el primer cruce del
   * umbral. Es el instante en que llego la sacudida, y sin el no se puede
   * calcular cuantos segundos de aviso previo hubo: el arranque de la ventana
   * es cuando aviso Google, no cuando llego la onda.
   */
  private var onsetMs: Long = -1

  private val escucha = object : SensorEventListener {
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    override fun onSensorChanged(e: SensorEvent) {
      if (!activa) return
      when (e.sensor.type) {
        Sensor.TYPE_ACCELEROMETER -> acelerometro(e)
        Sensor.TYPE_GYROSCOPE -> {
          val w = sqrt(
            (e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]).toDouble()
          )
          if (w > giroPico) giroPico = w
        }
      }
    }
  }

  private fun acelerometro(e: SensorEvent) {
    val x = e.values[0]
    val y = e.values[1]
    val z = e.values[2]

    if (!sembrado) {
      // Sembrar con la primera muestra: el telefono ya esta donde esta, y la
      // gravedad que soporta es exactamente esta.
      gravedadX = x; gravedadY = y; gravedadZ = z
      sembrado = true
      tsAnteriorNs = e.timestamp
      muestras++
      return
    }

    val dt = ((e.timestamp - tsAnteriorNs) / 1_000_000_000.0)
      .coerceIn(0.0005, 0.5)   // acota relojes que saltan o se congelan
    tsAnteriorNs = e.timestamp

    // Paso bajo que sigue a la gravedad; lo que sobra es la sacudida.
    val alpha = (1.0 - 2.0 * Math.PI * ESQUINA_HZ * dt).coerceIn(0.0, 0.9999).toFloat()
    gravedadX = alpha * gravedadX + (1 - alpha) * x
    gravedadY = alpha * gravedadY + (1 - alpha) * y
    gravedadZ = alpha * gravedadZ + (1 - alpha) * z

    val lx = x - gravedadX
    val ly = y - gravedadY
    val lz = z - gravedadZ
    val a = sqrt((lx * lx + ly * ly + lz * lz).toDouble())

    muestras++

    val transcurrido = System.currentTimeMillis() - inicioMs
    if (transcurrido < ASENTAMIENTO_MS) return

    if (a > pgaMs2) pgaMs2 = a
    if (a > umbralMs2) {
      msSobreUmbral += dt * 1000.0
      if (!avisadoUmbral) {
        avisadoUmbral = true
        onsetMs = transcurrido
        // Aviso inmediato: quien escucha puede actuar sin esperar a que la
        // ventana termine. En un sismo real la ventana dura 90 s y esperarla
        // entera desperdiciaria justo los segundos que importan.
        emitir("onUmbralSuperado", mapOf(
          "etiqueta" to etiquetaActual,
          "enMs" to transcurrido,
          "pgaG" to (pgaMs2 / G)
        ))
      }
    }
  }

  private fun emitir(nombre: String, datos: Map<String, Any?>) {
    try {
      oyente?.invoke(nombre, datos)
    } catch (e: Exception) {
      // Que falle quien escucha no puede tumbar la medida en curso.
    }
  }

  fun conectar(contexto: Context) {
    if (contextoApp == null) contextoApp = contexto.applicationContext
  }

  private fun obtenerSensorManager(): SensorManager? {
    if (sensorManager == null) {
      sensorManager = contextoApp?.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    }
    return sensorManager
  }

  fun disponibilidad(): Map<String, Any?> {
    val sm = obtenerSensorManager()
    return mapOf(
      "acelerometro" to (sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null),
      "giroscopio" to (sm?.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null),
      "midiendo" to activa,
      "etiqueta" to (if (activa) etiquetaActual else null)
    )
  }

  /**
   * Hilo propio para el muestreo. A 100 Hz el callback entra cada 10 ms, y
   * dejarlo en el hilo principal lo pondria a competir con la interfaz justo
   * cuando la app esta ocupada disparando la alarma.
   */
  private fun obtenerHandler(): Handler {
    if (handler == null) {
      val t = HandlerThread("sismografo")
      t.start()
      hilo = t
      handler = Handler(t.looper)
    }
    return handler!!
  }

  /**
   * Arranca una ventana de medida.
   *
   * hz es un parametro y no una constante porque la vigilancia de replicas
   * necesita un ritmo bajo y barato durante horas, mientras que una alerta
   * necesita el ritmo alto durante 90 s.
   */
  @Synchronized
  fun iniciar(ventanaMs: Int, hzPedido: Int, umbralG: Double, etiqueta: String): Map<String, Any?> {
    val sm = obtenerSensorManager()
      ?: return mapOf("ok" to false, "motivo" to "sin_sensores")
    val acel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
      ?: return mapOf("ok" to false, "motivo" to "sin_acelerometro")

    // Una ventana nueva manda sobre la que corra. El caso real es la vigilancia
    // de replicas a ritmo bajo cuando entra una alerta de Google: hay que
    // saltar a ritmo alto sin perder el evento.
    val previa = if (activa) cerrar("reemplazada") else null

    etiquetaActual = etiqueta
    hz = hzPedido.coerceIn(1, 200)
    umbralMs2 = umbralG * G
    gravedadX = 0f; gravedadY = 0f; gravedadZ = 0f
    sembrado = false
    tsAnteriorNs = 0L
    muestras = 0
    pgaMs2 = 0.0
    giroPico = 0.0
    msSobreUmbral = 0.0
    avisadoUmbral = false
    onsetMs = -1
    inicioMs = System.currentTimeMillis()
    generacion++
    val mia = generacion
    activa = true

    val h = obtenerHandler()
    val periodoUs = 1_000_000 / hz

    // DOS MODOS, y la diferencia entre ellos decide la bateria del telefono.
    //
    // Ventana CORTA (una alerta): se sostiene el procesador despierto y se
    // reciben las muestras al instante. Dura segundos y hay que medir bien.
    //
    // Ventana LARGA (vigilancia de replicas, horas): NI se sostiene el
    // procesador NI se reciben al instante. Se pide al coprocesador de sensores
    // que ACUMULE y entregue en tandas, que es como los pulsometros miden todo
    // el dia sin fundir la bateria. Un wake lock de seis horas arrasaria la
    // carga justo cuando es la ventana de rescate.
    //
    // El precio del modo largo es que el aviso de sacudida llega con retraso.
    // Se acepta: ahi se esta REGISTRANDO replicas, no avisando de ellas.
    val esLarga = ventanaMs > VENTANA_CORTA_MAX_MS
    val latenciaUs = if (esLarga) LATENCIA_TANDA_US else 0

    sm.registerListener(escucha, acel, periodoUs, latenciaUs, h)
    sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let {
      sm.registerListener(escucha, it, periodoUs, latenciaUs, h)
    }

    if (!esLarga) tomarWakeLock(ventanaMs.toLong())

    // El cierre se programa aqui: si el proceso sigue vivo, la ventana termina
    // sola aunque JS se haya quedado ocupado o muerto.
    h.postDelayed({
      val resumen = cerrar("completada", mia)
      if (resumen != null) entregar(resumen)
    }, ventanaMs.toLong())

    return mapOf(
      "ok" to true,
      "etiqueta" to etiqueta,
      "hz" to hz,
      "ventanaMs" to ventanaMs,
      "reemplazo" to previa
    )
  }

  fun detener(): Map<String, Any?> {
    if (!activa) return mapOf("ok" to false, "motivo" to "no_habia_ventana")
    val resumen = cerrar("detenida")
    return mapOf("ok" to true, "medicion" to resumen)
  }

  /**
   * Entrega la medida a quien escuche, y si no escucha nadie la guarda.
   *
   * Sin esto, una medida tomada con el runtime de JS muerto se perderia justo
   * en el caso que mas importa: el telefono midiendo un sismo real mientras la
   * app esta cerrada.
   */
  private fun entregar(resumen: Map<String, Any?>) {
    if (oyente != null) {
      emitir("onMedicion", resumen)
    } else {
      contextoApp?.let { ColaMediciones.guardar(it, resumen) }
    }
  }

  private fun tomarWakeLock(ms: Long) {
    try {
      soltarWakeLock()
      val pm = contextoApp?.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
      val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AlertaSismo:sismografo")
      // Con margen y con timeout propio: si algo falla al soltarlo, el sistema
      // lo suelta igual y no se queda drenando la bateria para siempre.
      wl.acquire(ms + 5_000L)
      wakeLock = wl
    } catch (e: Exception) {
      // Sin wake lock se mide igual mientras la pantalla este encendida.
    }
  }

  private fun soltarWakeLock() {
    try {
      wakeLock?.let { if (it.isHeld) it.release() }
    } catch (e: Exception) {
      // ignorado
    }
    wakeLock = null
  }

  /**
   * Cierra la ventana y arma el resumen. Devuelve null si no habia nada que
   * cerrar, o si quien pide el cierre ya no es el dueño de la ventana en curso.
   *
   * Va sincronizado porque lo llaman tres hilos distintos: el del sensor
   * (cierre programado), el de JS (detener, o arrancar otra encima) y el del
   * servicio de notificaciones. Sin esto, dos cierres simultaneos emitirian dos
   * mediciones de la misma ventana.
   *
   * A JS solo va este resumen, nunca las muestras: a 100 Hz durante 90 s son
   * 9000 muestras de tres ejes, y cruzar eso por el puente no aporta nada que
   * el resumen no diga.
   */
  @Synchronized
  fun cerrar(motivo: String, deGeneracion: Int? = null): Map<String, Any?>? {
    if (!activa) return null
    if (deGeneracion != null && deGeneracion != generacion) return null
    activa = false

    try {
      sensorManager?.unregisterListener(escucha)
    } catch (e: Exception) {
      // ignorado
    }
    soltarWakeLock()

    val duracionMs = System.currentTimeMillis() - inicioMs
    val pgaG = pgaMs2 / G

    return mapOf(
      "etiqueta" to etiquetaActual,
      "motivo" to motivo,
      "inicioEn" to inicioMs,
      "duracionMs" to duracionMs,
      "muestras" to muestras,
      "hz" to hz,
      // Ritmo REAL conseguido. Android no garantiza el pedido, y una medida
      // tomada a 30 Hz cuando se pidieron 100 hay que poder detectarla despues.
      "hzReal" to if (duracionMs > 0) muestras * 1000.0 / duracionMs else 0.0,
      "pgaMs2" to pgaMs2,
      "pgaG" to pgaG,
      "mmiEstimada" to mmiDesdePga(pgaMs2),
      "mmiEnRango" to enRangoWald(pgaMs2),
      // null si nunca hubo sacudida. Es el instante de llegada de la onda, y
      // lo que permite medir el aviso previo real cruzandolo con Google.
      "onsetMs" to (if (onsetMs >= 0) onsetMs else null),
      "duracionFuerteSeg" to msSobreUmbral / 1000.0,
      "umbralG" to umbralMs2 / G,
      "giroPicoRads" to giroPico,
      "veredicto" to veredicto(pgaMs2, giroPico),
      "completada" to (motivo == "completada")
    )
  }

  /**
   * PGA a intensidad Mercalli, con la relacion de Wald et al. (1999).
   *
   * Es una ESTIMACION y hay que rotularla como tal en todas partes. La relacion
   * se calibro con sismometros, no con telefonos, y un acelerometro de telefono
   * no esta calibrado ni se sabe como esta acoplado al suelo. Sirve para dar
   * una escala util, no para publicar un dato.
   */
  private fun mmiDesdePga(pga: Double): Double? {
    val cms2 = pga * 100.0
    if (cms2 <= 0.0) return null
    val mmi = 3.66 * log10(cms2) - 1.66
    return mmi.coerceIn(1.0, 12.0)
  }

  /** Wald solo es valida de MMI V a VIII (~18 a 650 cm/s2). Fuera, se avisa. */
  private fun enRangoWald(pga: Double): Boolean {
    val cms2 = pga * 100.0
    return cms2 in 18.0..650.0
  }

  /**
   * ¿Se movio el suelo o se movio el usuario?
   *
   * Los umbrales estan SIN CALIBRAR: se registran para poder ajustarlos con
   * datos reales, y por eso de momento esto no decide nada, solo describe.
   */
  private fun veredicto(pga: Double, giro: Double): String {
    if (pga < umbralMs2) return "sin_sacudida"
    if (giro > 1.0) return "manipulacion"     // ~57 grados/s: nadie apoya asi
    if (giro < 0.35) return "suelo"           // ~20 grados/s: apenas rota
    return "indeterminado"
  }
}
