import { NativeModule, requireNativeModule } from 'expo';

declare class EmergenciaModule extends NativeModule<{}> {}

export default requireNativeModule<EmergenciaModule>('Emergencia');
