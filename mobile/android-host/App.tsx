import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  NativeModules,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import nodejs from 'nodejs-mobile-react-native';
import {WebView} from 'react-native-webview';

type HostMessage = {
  type?: string;
  url?: string;
  detail?: string;
};

type FolderResult = {
  cancelled?: boolean;
  batchId?: string;
  files?: number;
  bytes?: number;
};

const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost):3000(?:\/|$)/i;
const REPOSITORY = 'DeadSpartan8452/songless';
const APK_ASSET = 'Songless-Android.apk';
const CHECKSUM_ASSET = 'Songless-SHA256SUMS.txt';

function App(): React.JSX.Element {
  const started = useRef(false);
  const webView = useRef<WebView>(null);
  const [adminUrl, setAdminUrl] = useState('');
  const [error, setError] = useState('');
  const [launched, setLaunched] = useState(false);
  const [version, setVersion] = useState('…');
  const [updateStatus, setUpdateStatus] = useState('Les mises à jour téléchargent uniquement le programme.');

  const updateFromGitHub = async () => {
    const updater = NativeModules.SonglessUpdater;
    if (!updater || typeof updater.installUpdate !== 'function') {
      setUpdateStatus('Le module de mise à jour Android est indisponible.');
      return;
    }
    setUpdateStatus('Recherche de la version publiée sur GitHub…');
    try {
      const response = await fetch(
        `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
        {headers: {Accept: 'application/vnd.github+json'}},
      );
      if (!response.ok) throw new Error(`GitHub répond HTTP ${response.status}.`);
      const release = await response.json();
      if (!release.tag_name || release.draft || release.prerelease) {
        throw new Error('Aucune version stable n’est publiée.');
      }
      const latest = String(release.tag_name).replace(/^v/i, '');
      if (latest === version.replace(/^v/i, '')) {
        setUpdateStatus(`Songless est déjà à jour (${release.tag_name}).`);
        return;
      }
      const apk = (release.assets || []).find((asset: any) => asset.name === APK_ASSET);
      const sums = (release.assets || []).find((asset: any) => asset.name === CHECKSUM_ASSET);
      if (!apk?.browser_download_url || !sums?.browser_download_url) {
        throw new Error('APK ou manifeste SHA-256 absent de la Release.');
      }
      const sumResponse = await fetch(sums.browser_download_url);
      if (!sumResponse.ok) throw new Error('Le manifeste SHA-256 GitHub est inaccessible.');
      const sumText = await sumResponse.text();
      const line = sumText.split(/\r?\n/).find((entry: string) =>
        new RegExp(`^([a-f0-9]{64})\\s+${APK_ASSET}$`, 'i').test(entry),
      );
      const expectedHash = line?.trim().split(/\s+/)[0];
      if (!expectedHash) throw new Error('Empreinte de l’APK absente du manifeste.');
      setUpdateStatus(`Téléchargement de Songless ${release.tag_name}…`);
      const result = await updater.installUpdate(
        apk.browser_download_url,
        expectedHash,
        release.tag_name,
      );
      setUpdateStatus(String(result || 'Confirme l’installation dans Android.'));
    } catch (updateError) {
      const detail = updateError instanceof Error
        ? updateError.message
        : 'La mise à jour Android a échoué.';
      setUpdateStatus(detail);
    }
  };

  useEffect(() => {
    const updater = NativeModules.SonglessUpdater;
    if (updater && typeof updater.getVersion === 'function') {
      updater.getVersion()
        .then((value: string) => setVersion(value))
        .catch(() => setVersion('inconnue'));
    } else {
      setVersion('inconnue');
    }
    let readyTimer: ReturnType<typeof setInterval> | undefined;
    const handleMessage = (payload: HostMessage) => {
      if (payload?.type === 'ready' && payload.url && LOCAL_URL.test(payload.url)) {
        if (readyTimer) clearInterval(readyTimer);
        setAdminUrl(payload.url);
        setError('');
      }
      if (payload?.type === 'error') {
        setError(payload.detail || 'Le moteur Songless n’a pas pu démarrer.');
      }
    };
    nodejs.channel.addListener('message', handleMessage);

    if (!started.current) {
      started.current = true;
      nodejs.start('main.js', {redirectOutputToLogcat: true});
    }
    readyTimer = setInterval(() => {
      nodejs.channel.send({type: 'request-ready'});
    }, 750);
    return () => {
      if (readyTimer) clearInterval(readyTimer);
      nodejs.channel.removeListener('message', handleMessage);
    };
  }, []);

  const sendFolderResult = (payload: Record<string, unknown>) => {
    const json = JSON.stringify(payload)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    webView.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent('songless-folder-result',{detail:${json}}));true;`,
    );
  };

  const handleWebMessage = async (event: {nativeEvent: {data: string}}) => {
    let message: {type?: string} = {};
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch (_) {
      return;
    }
    if (message.type !== 'choose-music-folder') return;
    const picker = NativeModules.SonglessFolderPicker;
    if (!picker || typeof picker.pickFolder !== 'function') {
      sendFolderResult({error: 'Le sélecteur de dossier Android est indisponible.'});
      return;
    }
    try {
      const result: FolderResult = await picker.pickFolder();
      sendFolderResult(result || {cancelled: true});
    } catch (pickerError) {
      const detail = pickerError instanceof Error
        ? pickerError.message
        : 'Android n’a pas pu lire ce dossier.';
      sendFolderResult({error: detail});
    }
  };

  if (adminUrl && launched) {
    return (
      <SafeAreaView style={styles.webShell}>
        <StatusBar barStyle="light-content" backgroundColor="#09090b" />
        <WebView
          ref={webView}
          source={{uri: adminUrl}}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          mixedContentMode="never"
          allowsBackForwardNavigationGestures
          onShouldStartLoadWithRequest={request => LOCAL_URL.test(request.url)}
          onMessage={handleWebMessage}
          onError={event => setError(event.nativeEvent.description)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />
      <View style={styles.orbit} />
      <View style={styles.scanline} />
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>HÔTE MOBILE · SESSION LOCALE</Text>
        <Text style={styles.title}>Songless</Text>
        <View style={styles.divider} />
        {error ? (
          <>
            <Text style={styles.errorTitle}>Démarrage interrompu</Text>
            <Text style={styles.detail}>{error}</Text>
          </>
        ) : !adminUrl ? (
          <>
            <ActivityIndicator size="large" color="#7c3aed" />
            <Text style={styles.bootTitle}>Songless démarre</Text>
            <Text style={styles.detail}>
              Préparation du serveur privé, de la bibliothèque et de la session administrateur…
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.bootTitle}>Songless est prêt</Text>
            <Text style={styles.detail}>
              Lance la version installée ou recherche une mise à jour.
            </Text>
          </>
        )}
        <View style={styles.statusRow}>
          <View style={[styles.dot, error ? styles.dotError : styles.dotActive]} />
          <Text style={styles.statusText}>
            {error ? 'ACTION REQUISE' : adminUrl ? 'PRÊT' : 'PRÉPARATION LOCALE'}
          </Text>
        </View>
      </View>
      <Text style={styles.version}>Version installée : {version}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={!adminUrl}
        onPress={() => setLaunched(true)}
        style={[styles.menuButton, !adminUrl && styles.menuButtonDisabled]}>
        <Text style={styles.menuButtonText}>Lancer la version actuelle</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={updateFromGitHub}
        style={[styles.menuButton, styles.updateButton]}>
        <Text style={styles.menuButtonText}>Mise à jour</Text>
      </Pressable>
      <Text style={styles.updateStatus}>{updateStatus}</Text>
      <Text style={styles.footer}>Les chansons locales ne viennent pas de GitHub.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {flex: 1, overflow: 'hidden', backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center', padding: 24},
  webShell: {flex: 1, backgroundColor: '#09090b'},
  webview: {flex: 1, backgroundColor: '#09090b'},
  orbit: {position: 'absolute', width: 430, height: 430, borderRadius: 215, borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.2)', backgroundColor: 'rgba(124, 58, 237, 0.1)', transform: [{rotate: '-12deg'}]},
  scanline: {position: 'absolute', left: 0, right: 0, top: '28%', height: 1, backgroundColor: '#27272a'},
  panel: {width: '100%', maxWidth: 520, borderWidth: 1, borderColor: '#27272a', borderRadius: 16, backgroundColor: 'rgba(17, 17, 21, 0.97)', paddingHorizontal: 28, paddingVertical: 34, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 28, elevation: 16},
  eyebrow: {color: '#d8b4fe', fontSize: 11, fontWeight: '800', letterSpacing: 2.1},
  title: {color: '#7c3aed', fontSize: 48, fontWeight: '900', letterSpacing: -1.6, marginTop: 8},
  divider: {width: 76, height: 4, borderRadius: 2, backgroundColor: '#7c3aed', marginTop: 16, marginBottom: 36},
  bootTitle: {color: '#f4f4f5', fontSize: 20, fontWeight: '700', marginTop: 24, textAlign: 'center'},
  errorTitle: {color: '#ff6b6b', fontSize: 21, fontWeight: '800'},
  detail: {color: '#a1a1aa', fontSize: 15, lineHeight: 23, marginTop: 12, textAlign: 'center'},
  version: {color: '#d4d4d8', fontSize: 12, marginTop: 18, textAlign: 'center'},
  menuButton: {width: '100%', minHeight: 48, borderRadius: 10, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingHorizontal: 12},
  updateButton: {backgroundColor: '#27272a', borderWidth: 1, borderColor: '#7c3aed'},
  menuButtonDisabled: {opacity: 0.45},
  menuButtonText: {color: '#fff', fontSize: 15, fontWeight: '800'},
  updateStatus: {color: '#a1a1aa', minHeight: 36, fontSize: 11, lineHeight: 16, marginTop: 8, textAlign: 'center'},
  statusRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 30},
  dot: {width: 7, height: 7, borderRadius: 4, marginRight: 9},
  dotActive: {backgroundColor: '#10b981'},
  dotError: {backgroundColor: '#ff6b6b'},
  statusText: {color: '#a1a1aa', fontSize: 10, fontWeight: '800', letterSpacing: 1.6},
  footer: {position: 'absolute', bottom: 26, color: '#71717a', fontSize: 11, letterSpacing: 0.4},
});

export default App;
