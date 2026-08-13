// plugins/withSinCopiaDeSeguridad.js
//
// Deja fuera de las copias de seguridad de Android los datos de la app.
//
// POR QUE. Por defecto Android incluye el almacenamiento privado de una app en
// las copias del sistema —las de la nube y las que se sacan por cable—. Aqui ese
// almacenamiento contiene la bitacora, que es un historial de ubicaciones con
// fechas, y la ficha de emergencia, que son datos medicos.
//
// Una copia de seguridad se guarda en un sitio sobre el que esta app no manda
// nada, se puede restaurar en otro telefono y sobrevive a desinstalar la app.
// Para un historial de donde ha estado alguien, eso es demasiada superficie a
// cambio de una comodidad que aqui no hace falta: si el usuario cambia de
// telefono, reconfigurar la app son dos minutos y la bitacora vieja no le sirve
// de nada en el aparato nuevo.
//
// Se cierran las DOS vias, que Android trata por separado: allowBackup cubre la
// copia clasica y en la nube; dataExtractionRules cubre la transferencia directa
// entre dispositivos de Android 12 en adelante. Cerrar solo una deja la otra
// abierta.
//
// El precio, asumido: al cambiar de telefono se pierde la bitacora. Es coherente
// con que la bitacora sea el registro de lo que le paso a ESTE telefono.

const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NOMBRE_RECURSO = 'reglas_extraccion';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Generado por plugins/withSinCopiaDeSeguridad.js. No editar a mano: la carpeta
  android/ se regenera con prebuild.

  cloud-backup  -> copias de Google Drive
  device-transfer -> paso directo a un telefono nuevo

  Se excluye TODO en ambas. La app guarda historial de ubicacion y datos
  medicos, y ninguno de los dos deberia salir del telefono en el que se creo.
-->
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </device-transfer>
</data-extraction-rules>
`;

function withRecurso(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const destino = path.join(
        cfg.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'res', 'xml'
      );
      fs.mkdirSync(destino, { recursive: true });
      fs.writeFileSync(path.join(destino, `${NOMBRE_RECURSO}.xml`), XML, 'utf8');
      return cfg;
    },
  ]);
}

function withManifiesto(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    app.$['android:allowBackup'] = 'false';
    app.$['android:dataExtractionRules'] = `@xml/${NOMBRE_RECURSO}`;
    return cfg;
  });
}

module.exports = function withSinCopiaDeSeguridad(config) {
  return withManifiesto(withRecurso(config));
};
