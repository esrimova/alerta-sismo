// src/services/despertador.js
//
// Permite cortar la espera del bucle de monitoreo desde fuera.
//
// Existe como modulo propio y no dentro del servicio en primer plano para
// evitar un ciclo de importaciones: el bucle ya importa el protocolo de
// emergencia, asi que el protocolo no puede importar el bucle. Ambos importan
// esto, que no importa nada.
//
// POR QUE HACE FALTA. El bucle espera entre vueltas, y esa espera puede ser
// larga: cinco minutos hibernando sin internet, quince con el protocolo de
// emergencia disparado. Hay momentos en que seguir dormido es lo peor que puede
// hacer, y el mas claro es este: el usuario acaba de pulsar "Estoy bien"
// despues de que venciera el plazo. En ese instante deja de estar incapacitado
// y vuelve a poder actuar sobre una alerta, pero el bucle seguiria en ritmo
// reducido hasta un cuarto de hora mas, justo mientras la secuencia sismica
// sigue viva.

let cortar = null;

/** Lo llama el bucle al empezar a esperar. */
export function registrarEspera(fn) {
  cortar = fn;
}

/** Lo llama el bucle al terminar de esperar por su cuenta. */
export function olvidarEspera() {
  cortar = null;
}

/**
 * Corta la espera en curso, si la hay. Seguro de llamar siempre: si el bucle no
 * esta esperando —o ni siquiera esta corriendo— no hace nada.
 */
export function despertarAhora() {
  const fn = cortar;
  cortar = null;
  if (fn) {
    try {
      fn();
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}
