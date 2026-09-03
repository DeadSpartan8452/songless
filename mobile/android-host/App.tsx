import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  NativeModules,
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

function App(): React.JSX.Element {
  const started = useRef(false);
  const webView = useRef<WebView>(null);
  const [adminUrl, setAdminUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const handleMessage = (payload: HostMessage) => {
      if (payload?.type === 'ready' && payload.url && LOCAL_URL.test(payload.url)) {
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
    return () => nodejs.channel.removeListener('message', handleMessage);
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

  if (adminUrl) {
    return (
      <SafeAreaView style={styles.webShell}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0810" />
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
      <StatusBar barStyle="light-content" backgroundColor="#0a0810" />
      <View style={styles.orbit} />
      <View style={styles.scanline} />
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>RÉGIE MOBILE · HÔTE LOCAL</Text>
        <Text style={styles.title}>SONGLESS</Text>
        <View style={styles.divider} />
        {error ? (
          <>
            <Text style={styles.errorTitle}>Démarrage interrompu</Text>
            <Text style={styles.detail}>{error}</Text>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color="#ffd85e" />
            <Text style={styles.bootTitle}>La régie se met en place</Text>
            <Text style={styles.detail}>
              Préparation du serveur privé, de la bibliothèque et de la session administrateur…
            </Text>
          </>
        )}
        <View style={styles.statusRow}>
          <View style={[styles.dot, error ? styles.dotError : styles.dotActive]} />
          <Text style={styles.statusText}>{error ? 'ACTION REQUISE' : 'INITIALISATION LOCALE'}</Text>
        </View>
      </View>
      <Text style={styles.footer}>Aucune musique n’est envoyée sur Internet</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {flex: 1, overflow: 'hidden', backgroundColor: '#0a0810', alignItems: 'center', justifyContent: 'center', padding: 24},
  webShell: {flex: 1, backgroundColor: '#0a0810'},
  webview: {flex: 1, backgroundColor: '#0a0810'},
  orbit: {position: 'absolute', width: 430, height: 430, borderRadius: 215, borderWidth: 1, borderColor: 'rgba(78, 224, 201, 0.22)', backgroundColor: 'rgba(35, 20, 52, 0.42)', transform: [{rotate: '-12deg'}]},
  scanline: {position: 'absolute', left: 0, right: 0, top: '28%', height: 1, backgroundColor: 'rgba(255, 216, 94, 0.35)'},
  panel: {width: '100%', maxWidth: 520, borderWidth: 1, borderColor: 'rgba(255, 216, 94, 0.42)', backgroundColor: 'rgba(14, 11, 22, 0.94)', paddingHorizontal: 28, paddingVertical: 34, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 28, elevation: 16},
  eyebrow: {color: '#4ee0c9', fontSize: 11, fontWeight: '800', letterSpacing: 2.4},
  title: {color: '#f7f0dd', fontSize: 48, fontWeight: '900', letterSpacing: -1.6, marginTop: 8},
  divider: {width: 76, height: 4, backgroundColor: '#ffd85e', marginTop: 16, marginBottom: 36},
  bootTitle: {color: '#f7f0dd', fontSize: 20, fontWeight: '700', marginTop: 24, textAlign: 'center'},
  errorTitle: {color: '#ff7f71', fontSize: 21, fontWeight: '800'},
  detail: {color: '#b7aec4', fontSize: 15, lineHeight: 23, marginTop: 12, textAlign: 'center'},
  statusRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 30},
  dot: {width: 7, height: 7, borderRadius: 4, marginRight: 9},
  dotActive: {backgroundColor: '#4ee0c9'},
  dotError: {backgroundColor: '#ff7f71'},
  statusText: {color: '#847a91', fontSize: 10, fontWeight: '800', letterSpacing: 1.6},
  footer: {position: 'absolute', bottom: 26, color: '#665f70', fontSize: 11, letterSpacing: 0.4},
});

export default App;
