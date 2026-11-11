package su.xokeza.amour;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "AmourSecureSession")
public class AmourSecureSessionPlugin extends Plugin {
    private static final String ALIAS = "su.xokeza.amour.session.v1";
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("amour_secure_session", Context.MODE_PRIVATE);
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    @PluginMethod
    public synchronized void read(PluginCall call) {
        try {
            String encrypted = preferences().getString("ciphertext", null);
            JSObject result = new JSObject();
            if (encrypted == null) { result.put("value", org.json.JSONObject.NULL); call.resolve(result); return; }
            String[] parts = encrypted.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            result.put("value", new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) { call.reject("Could not read the protected session"); }
    }
    @PluginMethod
    public synchronized void write(PluginCall call) {
        try {
            String value = call.getString("value");
            if (value == null) {
                if (!preferences().edit().remove("ciphertext").commit()) throw new Exception();
            } else {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key());
                byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
                if (!preferences().edit().putString("ciphertext", stored).commit()) throw new Exception();
            }
            call.resolve();
        } catch (Exception error) { call.reject("Could not save the protected session"); }
    }
}
