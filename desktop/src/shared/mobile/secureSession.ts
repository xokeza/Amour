import { Capacitor, registerPlugin } from "@capacitor/core";
interface SecureSessionPlugin {
  read(): Promise<{ value: string | null }>;
  write(options: { value: string | null }): Promise<void>;
}
export const isNativeMobile = () => Capacitor.isNativePlatform();
export const SecureSession =
  registerPlugin<SecureSessionPlugin>("AmourSecureSession");
