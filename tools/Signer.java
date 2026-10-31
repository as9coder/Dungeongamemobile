import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;

/** Usage: Signer sign <ks.p12> <pass> <alias> <in.apk> <out.apk> | Signer verify <apk> */
public class Signer {
    public static void main(String[] a) throws Exception {
        if (a[0].equals("sign")) {
            KeyStore ks = KeyStore.getInstance("PKCS12");
            try (FileInputStream in = new FileInputStream(a[1])) { ks.load(in, a[2].toCharArray()); }
            PrivateKey key = (PrivateKey) ks.getKey(a[3], a[2].toCharArray());
            List<X509Certificate> certs = new ArrayList<X509Certificate>();
            for (Certificate c : ks.getCertificateChain(a[3])) certs.add((X509Certificate) c);
            ApkSigner.SignerConfig cfg = new ApkSigner.SignerConfig.Builder("CERT", key, certs).build();
            List<ApkSigner.SignerConfig> cfgs = new ArrayList<ApkSigner.SignerConfig>();
            cfgs.add(cfg);
            new ApkSigner.Builder(cfgs)
                .setInputApk(new File(a[4]))
                .setOutputApk(new File(a[5]))
                .setV1SigningEnabled(false)
                .setV2SigningEnabled(true)
                .build().sign();
            System.out.println("signed -> " + a[5]);
        } else {
            ApkVerifier.Result r = new ApkVerifier.Builder(new File(a[1])).build().verify();
            System.out.println("verified=" + r.isVerified() + " v1=" + r.isVerifiedUsingV1Scheme() + " v2=" + r.isVerifiedUsingV2Scheme());
            for (ApkVerifier.IssueWithParams i : r.getErrors()) System.out.println("ERROR " + i);
            for (ApkVerifier.IssueWithParams i : r.getWarnings()) System.out.println("WARN " + i);
            if (!r.isVerified()) System.exit(1);
        }
    }
}
