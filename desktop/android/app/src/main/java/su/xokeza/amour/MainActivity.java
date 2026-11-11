package su.xokeza.amour;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AmourSecureSessionPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
