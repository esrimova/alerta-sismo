// plugins/withFirmaPropia.js
//
// Firma las compilaciones de release con la clave propia del proyecto.
//
// POR QUE NO BASTA CON EDITAR android/app/build.gradle: esa carpeta la regenera
// `expo prebuild` y no esta versionada, asi que cualquier cambio hecho a mano
// desaparece en la siguiente generacion. Los config plugins son la unica forma
// de que un ajuste de Android sobreviva.
//
// POR QUE IMPORTA MAS DE LO NORMAL EN ESTE PROYECTO. Por defecto, la plantilla
// firma tambien el release con el keystore de depuracion que trae el toolchain,
// cuya clave privada es publica: viene en todos los proyectos que no la
// reemplazan. Aqui eso no es solo una mala practica de publicacion, es un
// agujero real: el servicio de emergencia del fork de bitchat esta protegido
// con un permiso de NIVEL DE FIRMA, y con una clave publica cualquiera podria
// firmar una app que lo invoque y provoque que la ficha medica y la ubicacion
// del usuario salgan por Bluetooth.
//
// Las credenciales viven en keystore.properties, que no se versiona. Si el
// archivo no existe se deja la firma por defecto y se avisa, para que quien
// clone el repositorio pueda compilar sin tener la clave.

const { withAppBuildGradle } = require('expo/config-plugins');

const MARCA = '// firma propia de Alerta Sismo';

const BLOQUE = `
${MARCA}
def propsFirma = new Properties()
def archivoFirma = rootProject.file('../keystore.properties')
if (archivoFirma.exists()) {
    archivoFirma.withInputStream { propsFirma.load(it) }
} else {
    logger.warn('AVISO: no hay keystore.properties. El release se firmara con la clave de depuracion, que es publica.')
}
`;

// rootProject.file y no file: este bloque vive en android/app/build.gradle, asi
// que file() resuelve contra android/app/ y no llegaria a la raiz del proyecto,
// donde esta el keystore.
const CONFIG = `
        propia {
            if (propsFirma['storeFile']) {
                storeFile rootProject.file(propsFirma['storeFile'])
                storePassword propsFirma['storePassword']
                keyAlias propsFirma['keyAlias']
                keyPassword propsFirma['keyPassword']
            }
        }`;

function aplicar(contenido) {
  if (contenido.includes(MARCA)) return contenido;

  // 1. Cargar las propiedades antes del bloque android.
  let salida = contenido.replace(/^android \{/m, `${BLOQUE}\nandroid {`);

  // 2. Añadir la configuracion de firma propia junto a la de depuracion.
  salida = salida.replace(
    /(signingConfigs \{)/,
    `$1${CONFIG}`
  );

  // 3. Que el release la use, pero solo si la clave existe: sin esto, quien
  //    clone el repositorio sin el keystore no podria compilar.
  salida = salida.replace(
    /(release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
    `$1signingConfig propsFirma['storeFile'] ? signingConfigs.propia : signingConfigs.debug`
  );

  return salida;
}

module.exports = function withFirmaPropia(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withFirmaPropia solo soporta build.gradle en Groovy');
    }
    cfg.modResults.contents = aplicar(cfg.modResults.contents);
    return cfg;
  });
};
